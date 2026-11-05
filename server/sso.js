/* Entra ID sign-in (OpenID Connect, authorization code flow with PKCE) — configuration, token verification and the two
   halves of the login (v1.70 — moved out of routes/sso.js so routes/auth.js no longer imports a route module and
   verifyIdToken is unit-testable). The routes in routes/sso.js only parse the request and redirect / answer. */
import crypto from "crypto";
import { sealSecret, openSecret, b64url } from "./crypto.js";
import { APP_URL, ROLES } from "./config.js";
import { sysAudit } from "./audit.js";
import { getSetting, setSetting } from "./settings.js";
import { resolveExternalIdentity, groupMapping, AUTH_MODE } from "./identity.js";

const SSO_DEFAULT = { enabled: false, tenantId: "", clientId: "", clientSecret: "", autoProvision: false, defaultRoles: ["guest"], buttonLabel: "Sign in with Microsoft", enforce: false, breakGlass: [] };
export const MASK = "••••••••";
export const ssoConfig = async () => { const c = { ...SSO_DEFAULT, ...(await getSetting("sso.entra", {})) }; return { ...c, clientSecret: openSecret(c.clientSecret || "") }; };
export const ssoPublic = (c) => ({ enabled: !!c.enabled && !!c.tenantId && !!c.clientId, buttonLabel: c.buttonLabel || SSO_DEFAULT.buttonLabel, enforce: !!c.enabled && !!c.tenantId && !!c.clientId && !!c.enforce, mode: AUTH_MODE });
const ssoStates = new Map(); // state → { verifier, nonce, ts }
export const redirectUri = () => `${APP_URL}/auth/sso/callback`;
export const oidcDiscovery = async (tenantId, { fetchImpl = fetch } = {}) => { const r = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/v2.0/.well-known/openid-configuration`); if (!r.ok) throw new Error(`Entra discovery failed (${r.status})`); return r.json(); };
export const verifyIdToken = async (idToken, meta, clientId, nonce, tenantId = "", { fetchImpl = fetch } = {}) => {
  const [h, p, sig] = String(idToken).split("."); if (!h || !p || !sig) throw new Error("Malformed id_token");
  const header = JSON.parse(Buffer.from(h, "base64url")); const payload = JSON.parse(Buffer.from(p, "base64url"));
  const jwks = await (await fetchImpl(meta.jwks_uri)).json();
  const jwk = (jwks.keys || []).find((k) => k.kid === header.kid); if (!jwk) throw new Error("Signing key not found");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, Buffer.from(sig, "base64url"), Buffer.from(`${h}.${p}`));
  if (!ok) throw new Error("id_token signature invalid");
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== clientId) throw new Error("id_token audience mismatch");
  if (payload.exp && payload.exp < now - 60) throw new Error("id_token expired");
  if (nonce && payload.nonce !== nonce) throw new Error("id_token nonce mismatch");
  if (meta.issuer && payload.iss !== meta.issuer && !String(payload.iss).startsWith("https://login.microsoftonline.com/")) throw new Error("id_token issuer mismatch");
  /* v1.66.1: a tenant-specific configuration accepts tokens of that tenant only (not of any Microsoft tenant) */
  if (tenantId && /^[0-9a-f-]{36}$/i.test(tenantId) && String(payload.tid || "").toLowerCase() !== tenantId.toLowerCase()) throw new Error("id_token tenant mismatch");
  if (payload.nbf && payload.nbf > now + 300) throw new Error("id_token not yet valid");
  return payload;
};

/* PUT /admin/sso — validates and stores the Entra settings; returns the stored configuration (secret sealed at rest) */
export const saveSsoConfig = async (b, user) => {
  const cur = await ssoConfig();
  const next = { enabled: !!b.enabled, tenantId: String(b.tenantId || "").trim(), clientId: String(b.clientId || "").trim(),
    clientSecret: b.clientSecret && b.clientSecret !== MASK ? String(b.clientSecret) : cur.clientSecret,
    autoProvision: !!b.autoProvision, defaultRoles: Array.isArray(b.defaultRoles) ? b.defaultRoles.filter((x) => ROLES.includes(x) && x !== "admin" && x !== "agent") : cur.defaultRoles,
    buttonLabel: String(b.buttonLabel || SSO_DEFAULT.buttonLabel).slice(0, 80),
    enforce: !!b.enforce, breakGlass: (Array.isArray(b.breakGlass) ? b.breakGlass : String(b.breakGlass || "").split(/[,;\s]+/)).map((e) => String(e).toLowerCase().trim()).filter((e) => e.includes("@")).slice(0, 20) };
  if (next.enforce && !next.breakGlass.length) next.breakGlass = [String(user.email).toLowerCase()];   /* never lock every admin out */
  if (next.enabled && (!next.tenantId || !next.clientId || !next.clientSecret)) throw Object.assign(new Error("Tenant ID, client ID and client secret are required to enable Entra sign-in"), { status: 400 });
  await setSetting("sso.entra", { ...next, clientSecret: sealSecret(next.clientSecret || "") }, user);   /* v1.66.1: sealed with SECRETS_KEY when set */
  await sysAudit(user, "user", "updated", "Entra ID sign-in", [{ field: "enabled", from: String(cur.enabled), to: String(next.enabled) }, { field: "enforce", from: String(!!cur.enforce), to: String(next.enforce) }]);
  return next;
};

/* GET /auth/sso/login — the authorization URL (PKCE S256, state + nonce kept for ten minutes) */
export const beginSsoLogin = async (c, { fetchImpl = fetch, now = Date.now() } = {}) => {
  const meta = await oidcDiscovery(c.tenantId, { fetchImpl });
  const state = b64url(crypto.randomBytes(24)), nonce = b64url(crypto.randomBytes(24)), verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  ssoStates.set(state, { verifier, nonce, ts: now });
  for (const [k, v] of ssoStates) if (v.ts < now - 10 * 60000) ssoStates.delete(k);
  const u = new URL(meta.authorization_endpoint);
  u.search = new URLSearchParams({ client_id: c.clientId, response_type: "code", redirect_uri: redirectUri(), response_mode: "query", scope: "openid profile email", state, nonce, code_challenge: challenge, code_challenge_method: "S256" }).toString();
  return u.toString();
};

/* GET /auth/sso/callback — exchanges the code, verifies the id_token and resolves the account; throws with a message
   the route turns into ?sso_error=… */
export const completeSsoLogin = async (c, { code, state }, { fetchImpl = fetch } = {}) => {
  const st = ssoStates.get(String(state)); ssoStates.delete(String(state));
  if (!st || !code) throw new Error("Invalid or expired sign-in state — please try again");
  const meta = await oidcDiscovery(c.tenantId, { fetchImpl });
  const tr = await fetchImpl(meta.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, grant_type: "authorization_code", code: String(code), redirect_uri: redirectUri(), code_verifier: st.verifier }) });
  const tok = await tr.json(); if (!tr.ok || !tok.id_token) throw new Error(tok.error_description || tok.error || "Token exchange failed");
  const claims = await verifyIdToken(tok.id_token, meta, c.clientId, st.nonce, c.tenantId, { fetchImpl });
  const email = String(claims.preferred_username || claims.email || claims.upn || "").toLowerCase();
  const sub = String(claims.sub || claims.oid || "");
  if (!email) throw new Error("Entra did not return an e-mail address");
  /* groups: the `groups` claim (object ids or names, when the app registration emits it) and app `roles` */
  const groups = [...(Array.isArray(claims.groups) ? claims.groups : []), ...(Array.isArray(claims.roles) ? claims.roles : [])].map(String);
  const { user } = await resolveExternalIdentity({ email, name: claims.name, sub, groups: groups.length || claims.groups ? groups : null, provider: "entra" },
    { autoProvision: c.autoProvision, defaultRoles: c.defaultRoles, mapping: await groupMapping() });
  return user;
};
