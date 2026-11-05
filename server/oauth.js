/* OAuth 2.1 authorization server for MCP clients (v1.58, PLAN.md item 16).
   Implements what the MCP authorization spec needs: RFC 9728 protected-resource metadata, RFC 8414 authorization
   server metadata, RFC 7591 dynamic client registration, the authorization-code grant with PKCE (S256, mandatory),
   rotating refresh tokens and token revocation. Access tokens are opaque (`cxo_…`), stored hashed, and resolve to the
   HUMAN user who consented — the MCP server audits under that name and derives the scope from the user's role.
   Consent is given on a small server-rendered page by a signed-in browser session. */
import { safeEqual } from "./security.js";
import crypto from "crypto";
import { q } from "./db.js";
import { APP_URL, hasRole } from "./config.js";
import { keyHash } from "./crypto.js";
import { findUserWithRoles } from "./users.js";
import { sysAudit } from "./audit.js";

export const SCOPES = ["catalog:read", "catalog:write"];
const ACCESS_TTL = Number(process.env.OAUTH_ACCESS_TTL_S || 3600) * 1000;
const REFRESH_TTL = Number(process.env.OAUTH_REFRESH_TTL_D || 30) * 864e5;
const CODE_TTL = 10 * 60000;
const b64u = (n = 32) => crypto.randomBytes(n).toString("base64url");
const issuer = () => APP_URL;

export const metadata = () => ({
  issuer: issuer(),
  authorization_endpoint: `${issuer()}/oauth/authorize`,
  token_endpoint: `${issuer()}/oauth/token`,
  registration_endpoint: `${issuer()}/oauth/register`,
  revocation_endpoint: `${issuer()}/oauth/revoke`,
  scopes_supported: SCOPES,
  response_types_supported: ["code"],
  response_modes_supported: ["query"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
  revocation_endpoint_auth_methods_supported: ["none", "client_secret_post"],
  code_challenge_methods_supported: ["S256"],
});
export const resourceMetadata = () => ({
  resource: `${issuer()}/mcp`,
  authorization_servers: [issuer()],
  scopes_supported: SCOPES,
  bearer_methods_supported: ["header"],
  resource_name: "Alassio Data Catalog MCP",
});

/* ── clients (RFC 7591) ── */
/* v1.66.1: https, loopback http, or a private-use scheme with a dot (RFC 8252 §7.1, e.g. com.example.app:/cb) — nothing else */
const validRedirect = (u) => { try { const x = new URL(u); if (x.hash || u.length > 2048) return false; const loop = ["localhost", "127.0.0.1", "[::1]"].includes(x.hostname); return x.protocol === "https:" || (x.protocol === "http:" && loop) || (/^[a-z][a-z0-9+.-]*\.[a-z0-9.+-]*:$/i.test(x.protocol) && x.protocol !== "http:" && x.protocol !== "https:"); } catch { return false; } };
const REGISTER_PER_HOUR = Math.max(1, Number(process.env.OAUTH_REGISTER_PER_HOUR || 20));
const registerWindow = new Map();   /* ip → [ts…] (v1.66.1: throttled, capped registrations) */
export const registerClient = async (body, ip) => {
  const now = Date.now(), recent = (registerWindow.get(ip) || []).filter((t) => t > now - 3600000);
  if (recent.length >= REGISTER_PER_HOUR) throw Object.assign(new Error("Too many client registrations from this address — try again later"), { status: 429, code: "temporarily_unavailable" });
  registerWindow.set(ip, [...recent, now]); if (registerWindow.size > 5000) for (const [k, v] of registerWindow) if (!v.some((t) => t > now - 3600000)) registerWindow.delete(k);
  const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.slice(0, 10).map(String) : [];
  if (!uris.length || !uris.every(validRedirect)) throw Object.assign(new Error("redirect_uris must be https URLs, loopback URLs or private-use scheme URLs"), { status: 400, code: "invalid_redirect_uri" });
  const method = body.token_endpoint_auth_method === "client_secret_post" ? "client_secret_post" : "none";
  const id = "cxc_" + b64u(12);
  const secret = method === "none" ? null : "cxs_" + b64u(24);
  await q("INSERT INTO oauth_clients (id, name, secret_hash, redirect_uris, auth_method, client_uri, created_ts, created_ip) VALUES (?,?,?,?,?,?,?,?)",
    [id, String(body.client_name || "MCP client").slice(0, 200), secret ? keyHash(secret) : null, JSON.stringify(uris), method, body.client_uri ? String(body.client_uri).slice(0, 500) : null, now, ip || null]);
  return { client_id: id, ...(secret ? { client_secret: secret } : {}), client_name: String(body.client_name || "MCP client").slice(0, 200), redirect_uris: uris,
    token_endpoint_auth_method: method, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], client_id_issued_at: Math.floor(now / 1000) };
};
export const getClient = async (id) => { const r = await q("SELECT * FROM oauth_clients WHERE id = ?", [id]); return r.length ? { ...r[0], redirect_uris: JSON.parse(r[0].redirect_uris || "[]") } : null; };
const clientAuthOk = async (client, secret) => client.auth_method === "none" ? true : (!!secret && safeEqual(client.secret_hash, keyHash(secret)));

/* ── authorization codes ── */
export const validateAuthorizeRequest = async (query) => {
  const client = query.client_id ? await getClient(String(query.client_id)) : null;
  if (!client) return { error: "invalid_client", description: "unknown client_id" };
  const redirect = String(query.redirect_uri || client.redirect_uris[0] || "");
  if (!client.redirect_uris.includes(redirect)) return { error: "invalid_request", description: "redirect_uri is not registered for this client" };
  if (query.response_type !== "code") return { error: "unsupported_response_type", redirect, state: query.state };
  if (!query.code_challenge || (query.code_challenge_method || "S256") !== "S256") return { error: "invalid_request", description: "PKCE with S256 is required", redirect, state: query.state };
  const scopes = String(query.scope || "catalog:read").split(/[\s+]+/).filter(Boolean);
  if (scopes.some((s) => !SCOPES.includes(s))) return { error: "invalid_scope", redirect, state: query.state };
  return { client, redirect, scopes, state: query.state ? String(query.state).slice(0, 500) : null, challenge: String(query.code_challenge), resource: query.resource ? String(query.resource) : null };
};
export const issueCode = async ({ client, user, redirect, scopes, challenge }) => {
  const code = "cxa_" + b64u(24);
  await q("INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, scope, code_challenge, expires) VALUES (?,?,?,?,?,?,?)",
    [keyHash(code), client.id, user.id, redirect, scopes.join(" "), challenge, Date.now() + CODE_TTL]);
  return code;
};

/* ── tokens ── */
const grantedScope = (user, requested) => {
  /* the token can never do more than the human: write needs an editing role */
  const canWrite = hasRole(user, "admin") || hasRole(user, "steward");
  return requested.filter((s) => s === "catalog:read" || (s === "catalog:write" && canWrite));
};
const issueTokens = async (client, user, scopes) => {
  const access = "cxo_" + b64u(32), refresh = "cxr_" + b64u(32);
  const now = Date.now();
  await q("INSERT INTO oauth_tokens (id, client_id, user_id, scope, access_hash, refresh_hash, access_expires, refresh_expires, created_ts) VALUES (?,?,?,?,?,?,?,?,?)",
    [crypto.randomUUID(), client.id, user.id, scopes.join(" "), keyHash(access), keyHash(refresh), now + ACCESS_TTL, now + REFRESH_TTL, now]);
  return { access_token: access, token_type: "Bearer", expires_in: Math.floor(ACCESS_TTL / 1000), refresh_token: refresh, scope: scopes.join(" ") };
};
const oauthError = (error, description, status = 400) => Object.assign(new Error(description || error), { status, code: error });

export const tokenGrant = async (body) => {
  const grant = body.grant_type;
  const client = body.client_id ? await getClient(String(body.client_id)) : null;
  if (!client) throw oauthError("invalid_client", "unknown client_id", 401);
  if (!(await clientAuthOk(client, body.client_secret))) throw oauthError("invalid_client", "client authentication failed", 401);
  if (grant === "authorization_code") {
    if (!body.code || !body.code_verifier) throw oauthError("invalid_request", "code and code_verifier are required");
    const rows = await q("SELECT * FROM oauth_codes WHERE code_hash = ?", [keyHash(String(body.code))]);
    await q("DELETE FROM oauth_codes WHERE code_hash = ? OR expires < ?", [keyHash(String(body.code)), Date.now()]);   /* single use */
    const c = rows[0];
    if (!c || Number(c.expires) < Date.now() || c.client_id !== client.id) throw oauthError("invalid_grant", "code is unknown, expired or belongs to another client");
    if (body.redirect_uri && body.redirect_uri !== c.redirect_uri) throw oauthError("invalid_grant", "redirect_uri mismatch");
    const expected = crypto.createHash("sha256").update(String(body.code_verifier)).digest("base64url");
    if (expected !== c.code_challenge) throw oauthError("invalid_grant", "PKCE verification failed");
    const u = await findUserWithRoles(c.user_id);
    if (!u) throw oauthError("invalid_grant", "user no longer exists");
    const scopes = grantedScope(u, c.scope.split(" "));
    return issueTokens(client, u, scopes);
  }
  if (grant === "refresh_token") {
    if (!body.refresh_token) throw oauthError("invalid_request", "refresh_token is required");
    const rows = await q("SELECT * FROM oauth_tokens WHERE refresh_hash = ? AND revoked_ts IS NULL", [keyHash(String(body.refresh_token))]);
    const t = rows[0];
    if (!t || Number(t.refresh_expires) < Date.now() || t.client_id !== client.id) throw oauthError("invalid_grant", "refresh token is unknown, expired or revoked");
    await q("UPDATE oauth_tokens SET revoked_ts = ?, revoked_reason = 'rotated' WHERE id = ?", [Date.now(), t.id]);   /* rotation: the old pair dies */
    const u = await findUserWithRoles(t.user_id);
    if (!u) throw oauthError("invalid_grant", "user no longer exists");
    return issueTokens(client, u, grantedScope(u, t.scope.split(" ")));
  }
  throw oauthError("unsupported_grant_type", `grant_type ${grant} is not supported`);
};

/* bearer → user (for /mcp): returns the account with `scope` read|write and `oauth` client info, or null */
export const resolveAccessToken = async (token) => {
  if (!token || !token.startsWith("cxo_")) return null;
  const rows = await q(`SELECT t.id AS token_id, t.scope AS token_scope, t.client_id, c.name AS client_name, u.* FROM oauth_tokens t JOIN users u ON u.id = t.user_id JOIN oauth_clients c ON c.id = t.client_id
    WHERE t.access_hash = ? AND t.revoked_ts IS NULL AND t.access_expires > ?`, [keyHash(token), Date.now()]);
  if (!rows.length) return null;
  const u = rows[0]; u.roles = JSON.parse(u.roles || "[]");
  u.scope = u.token_scope.split(" ").includes("catalog:write") ? "write" : "read";
  u.oauth = { tokenId: u.token_id, clientId: u.client_id, clientName: u.client_name };
  q("UPDATE oauth_tokens SET last_used_ts = ? WHERE id = ?", [Date.now(), u.token_id]).catch(() => {});
  return u;
};

export const revokeToken = async (body) => {
  const h = keyHash(String(body.token || ""));
  await q("UPDATE oauth_tokens SET revoked_ts = ?, revoked_reason = 'revoked' WHERE (access_hash = ? OR refresh_hash = ?) AND revoked_ts IS NULL", [Date.now(), h, h]);
};
/* connected apps of a user (or all, for admins): one row per client with active token counts */
export const connectedApps = async (userId = null) => {
  const rows = await q(`SELECT c.id, c.name, c.client_uri, c.created_ts, t.user_id, u.name AS user_name, u.email AS user_email, MAX(t.last_used_ts) AS last_used_ts, MIN(t.created_ts) AS first_ts, MAX(t.scope) AS scope,
      SUM(CASE WHEN t.revoked_ts IS NULL AND t.refresh_expires > ? THEN 1 ELSE 0 END) AS active
    FROM oauth_tokens t JOIN oauth_clients c ON c.id = t.client_id JOIN users u ON u.id = t.user_id ${userId ? "WHERE t.user_id = ?" : ""}
    GROUP BY c.id, c.name, c.client_uri, c.created_ts, t.user_id, u.name, u.email ORDER BY MAX(t.created_ts) DESC`, userId ? [Date.now(), userId] : [Date.now()]);
  return rows.map((r) => ({ clientId: r.id, clientName: r.name, clientUri: r.client_uri, userId: r.user_id, userName: r.user_name, userEmail: r.user_email, scope: r.scope, active: Number(r.active), firstTs: Number(r.first_ts), lastUsedTs: r.last_used_ts ? Number(r.last_used_ts) : null }));
};
export const revokeApp = async (clientId, userId, by) => {
  const r = await q("UPDATE oauth_tokens SET revoked_ts = ?, revoked_reason = 'user' WHERE client_id = ? AND user_id = ? AND revoked_ts IS NULL", [Date.now(), clientId, userId]);
  if (by) await sysAudit(by, "user", "updated", by.email, [{ field: "oauth", from: clientId, to: "revoked" }]);
  return r.affectedRows || 0;
};

/* ── consent page (server-rendered, CSP-safe: no inline scripts) ── */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const consentPage = ({ client, user, scopes, state, redirect, challenge, csrf, error = null }) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize ${esc(client.name)} — Alassio Data Catalog</title>
<style>body{font-family:Inter,system-ui,sans-serif;background:#F5F5F5;color:#1D1D1B;margin:0;display:grid;place-items:center;min-height:100vh}.card{background:#fff;border-top:4px solid #2271B3;border-radius:14px;box-shadow:0 20px 60px rgba(29,29,27,.15);padding:28px;max-width:460px;width:calc(100% - 32px)}h1{font-size:20px;margin:0 0 6px}p{color:#6B6B68;font-size:14px}ul{padding-left:18px;font-size:14px}.btn{display:inline-block;border-radius:8px;padding:9px 16px;font:inherit;font-weight:600;cursor:pointer;border:1px solid #E2E2E0;background:#fff;color:#1D1D1B}.btn-primary{background:#2271B3;border-color:#2271B3;color:#fff}.row{display:flex;gap:8px;justify-content:flex-end;margin-top:18px}.err{background:#F9E5E2;color:#B03A2E;padding:10px;border-radius:8px;font-size:13px}.mono{font-family:ui-monospace,monospace;font-size:12px;color:#6B6B68}</style></head>
<body><form class="card" method="post" action="/oauth/authorize">
<h1>Allow <b>${esc(client.name)}</b> to use the catalog?</h1>
<p>Signed in as <b>${esc(user.name)}</b> (${esc(user.email)}). The application will act with your permissions through the MCP interface; every change is audited under your name.</p>
${error ? `<div class="err">${esc(error)}</div>` : ""}
<ul>${scopes.map((s) => `<li>${s === "catalog:write" ? "Read <b>and change</b> catalog metadata (catalog:write)" : "Read and search the catalog (catalog:read)"}</li>`).join("")}</ul>
<p class="mono">Redirect: ${esc(redirect)}${client.client_uri ? `<br>Client: ${esc(client.client_uri)}` : ""}</p>
<input type="hidden" name="client_id" value="${esc(client.id)}"><input type="hidden" name="redirect_uri" value="${esc(redirect)}"><input type="hidden" name="scope" value="${esc(scopes.join(" "))}">
<input type="hidden" name="state" value="${esc(state || "")}"><input type="hidden" name="code_challenge" value="${esc(challenge)}"><input type="hidden" name="_csrf" value="${esc(csrf)}">
<div class="row"><button class="btn" name="decision" value="deny">Deny</button><button class="btn btn-primary" name="decision" value="allow">Allow</button></div>
</form></body></html>`;

/* ── rate limiting for /mcp: sliding one-minute windows per credential (all calls and mutating calls) ── */
const RATE = Number(process.env.MCP_RATE_PER_MIN || 300), WRITE_RATE = Number(process.env.MCP_WRITE_RATE_PER_MIN || 60);
const windows = new Map();   /* key → { all: [ts…], write: [ts…] } */
export const rateLimit = (key, mutating = false) => {
  const now = Date.now(), from = now - 60000;
  const w = windows.get(key) || { all: [], write: [] };
  w.all = w.all.filter((t) => t > from); w.write = w.write.filter((t) => t > from);
  windows.set(key, w);
  if (w.all.length >= RATE) return { limited: true, retryAfter: Math.ceil((w.all[0] + 60000 - now) / 1000), limit: RATE, kind: "requests" };
  if (mutating && w.write.length >= WRITE_RATE) return { limited: true, retryAfter: Math.ceil((w.write[0] + 60000 - now) / 1000), limit: WRITE_RATE, kind: "write calls" };
  w.all.push(now); if (mutating) w.write.push(now);
  if (windows.size > 5000) for (const [k, v] of windows) if (!v.all.length) windows.delete(k);
  return { limited: false, remaining: RATE - w.all.length, limit: RATE };
};
export const rateLimits = () => ({ perMinute: RATE, writesPerMinute: WRITE_RATE });
