/* Sessions (httpOnly cookie), role guards and login rate limiting. */
import { q } from "./db.js";
import { COOKIE, SESSION_DAYS, parseRoles, hasRole, isAgentAccount } from "./config.js";
import { token, keyHash } from "./crypto.js";
import { CSRF_COOKIE, csrfFor, setCsrfCookie, clearCsrfCookie, cookieSecure } from "./security.js";
import { AUTH_MODE, headerIdentity, headerPolicy, resolveExternalIdentity } from "./identity.js";

/* v1.66: role-derived capabilities decided on the server — the UI shows menus and actions by these flags instead of
   re-deriving them from the role list (per-object rights such as "may edit this table" stay in permissions.js, which
   both sides share, because they depend on the catalog document). */
export const capabilitiesOf = (u) => {
  const roles = Array.isArray(u.roles) ? u.roles : parseRoles(u);
  const has = (r) => u.role === r || roles.includes(r);
  const admin = has("admin");
  return { admin, steward: admin || has("steward"), pm: admin || has("pm"), ba: admin || has("ba"), ingestion: admin || has("ingestion"), dpd: admin || has("dpd"), agent: has("agent"),
    canEditStructure: admin, canImport: admin, canExport: !has("agent"), canDesignProducts: admin || has("pm"), canActInWorkflow: admin || has("ba") || has("ingestion") || has("dpd") || has("pm"),
    canDecideAccess: admin, canManageUsers: admin, canRunJobs: admin, canSeeAudit: admin || has("steward"), canUseMcp: admin || has("steward") };
};
export const safeUser = (u) => ({ capabilities: capabilitiesOf(u), passwordAuth: AUTH_MODE !== "header" && !u.sso_sub && !isAgentAccount(u), id: u.id, name: u.name, email: u.email, role: u.role, roles: Array.isArray(u.roles) ? u.roles : parseRoles(u), totpEnabled: !!u.totp_enabled || !!u.totpEnabled, sso: !!u.sso_sub, lang: u.lang || null, agentAccount: isAgentAccount(u) });
/* async handler. v1.68: an error that carries a status (domain code throws Object.assign(new Error(msg), { status, code? }))
   is answered with that status and its message — the former per-route try/catch wrappers are gone; anything else is an
   unexpected failure and becomes an opaque 500 (logged, message not exposed). */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => {
  if (e && Number.isInteger(e.status) && e.status >= 400 && e.status < 600) return res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
  console.error(e); res.status(500).json({ error: "Server error" });
});

/* resolves the session cookie to req.user; in AUTH_MODE=header a request without a (matching) session that carries
   the proxy's identity headers gets its account resolved — and a session cookie, so CSRF and the UI work unchanged */
export const sessionMiddleware = ah(async (req, res, next) => {
  const t = req.cookies?.[COOKIE];
  if (t) {
    const rows = await q("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?", [tokenHash(t), Date.now()]);
    if (rows.length) {
      req.user = rows[0]; req.user.roles = parseRoles(rows[0]);
      if (req.cookies?.[CSRF_COOKIE] !== csrfFor(t)) setCsrfCookie(res, t);   /* (re)issue the CSRF token cookie */
    }
  }
  if (AUTH_MODE === "header" && req.path !== "/mcp" && !req.headers.authorization) {
    const idn = await headerIdentity(req);
    if (idn && (!req.user || String(req.user.email).toLowerCase() !== idn.email)) {
      try {
        const { user } = await resolveExternalIdentity(idn, await headerPolicy());
        if (req.user) await endSession(req, res);
        await startSession(res, user, req);
        req.user = user; req.user.roles = parseRoles(user);
        req.csrfFresh = true;   /* the first request of a new header session cannot carry a CSRF token yet */
      } catch (e) { req.identityError = e.message; }
    }
  }
  next();
});
/* v1.67 (pentest L9): session, invitation and password-reset tokens are stored as SHA-256 hashes — a database read
   (SQL backup, DB console) no longer yields usable cookies or links. The browser keeps the plain token; lookups hash it. */
export const tokenHash = keyHash;
const isHashed = (t) => /^[0-9a-f]{64}$/.test(String(t || ""));
export const hashStoredTokens = async () => {
  let n = 0;
  for (const tbl of ["sessions", "invites", "password_resets"]) {
    const rows = await q(`SELECT token FROM ${tbl}`);
    for (const r of rows) if (!isHashed(r.token)) { await q(`UPDATE ${tbl} SET token = ? WHERE token = ?`, [tokenHash(r.token), r.token]); n += 1; }
  }
  if (n) console.log(`Hashed ${n} stored session/invitation token(s) (v1.67)`);
  return n;
};
export const startSession = async (res, user, req = null) => {
  const s = { token: token(), userId: user.id, expires: Date.now() + SESSION_DAYS * 864e5 };
  await q("DELETE FROM sessions WHERE expires < ?", [Date.now()]);
  await q("INSERT INTO sessions (token,user_id,expires) VALUES (?,?,?)", [tokenHash(s.token), s.userId, s.expires]);
  res.cookie(COOKIE, s.token, { httpOnly: true, sameSite: "lax", maxAge: SESSION_DAYS * 864e5, secure: cookieSecure(req) });
  setCsrfCookie(res, s.token, req);
};
export const endSession = async (req, res) => {
  const t = req.cookies?.[COOKIE];
  if (t) await q("DELETE FROM sessions WHERE token = ?", [tokenHash(t)]);
  res.clearCookie(COOKIE);
  clearCsrfCookie(res);
};
/* ends the user's other sessions (password change) or all of them (password reset, account deletion) */
export const revokeSessions = async (userId, keepCookieToken = null) =>
  keepCookieToken ? q("DELETE FROM sessions WHERE user_id = ? AND token <> ?", [userId, tokenHash(keepCookieToken)]) : q("DELETE FROM sessions WHERE user_id = ?", [userId]);
export const requireAuth = (req, res, next) => req.user ? next() : res.status(401).json({ error: "Not signed in" });
export const requireRole = (...roles) => (req, res, next) =>
  !req.user ? res.status(401).json({ error: "Not signed in" })
  : roles.some((r) => hasRole(req.user, r)) ? next() : res.status(403).json({ error: "Insufficient role" });

/* login rate limiting: per client IP and per e-mail — after 3 failures each further attempt is delayed
   (2 s, 4 s, 8 s … up to 30 s); after 10 failures the pair is locked for 15 minutes (HTTP 429, Retry-After) */
const loginFails = new Map(); // key → { n, until, ts }
const failKey = (req, email) => [`ip:${req.ip}`, `mail:${String(email || "").toLowerCase()}`];
/* v1.66.1: the IP bucket is wider than the per-account bucket (shared NATs / a proxy that does not forward the client
   address would otherwise lock everyone out); the e-mail bucket keeps the strict limits */
const LIMIT = (k) => (k.startsWith("ip:") ? { delayAfter: 20, lockAfter: 60 } : { delayAfter: 3, lockAfter: 10 });
export const loginGate = async (req, res, email) => {
  const now = Date.now();
  for (const k of failKey(req, email)) {
    const f = loginFails.get(k); if (!f) continue;
    if (f.until > now) { res.setHeader("Retry-After", Math.ceil((f.until - now) / 1000)); res.status(429).json({ error: `Too many failed sign-in attempts — try again in ${Math.ceil((f.until - now) / 60000)} min`, retryAfter: Math.ceil((f.until - now) / 1000) }); return false; }
    if (f.n >= LIMIT(k).delayAfter) await new Promise((r) => setTimeout(r, Math.min(30000, 1000 * 2 ** Math.min(6, f.n - LIMIT(k).delayAfter + 1))));
  }
  return true;
};
export const loginFailed = (req, email) => { const now = Date.now(); for (const k of failKey(req, email)) { const f = loginFails.get(k) || { n: 0, until: 0, ts: now }; f.n += 1; f.ts = now; if (f.n >= LIMIT(k).lockAfter) { f.until = now + 15 * 60000; f.n = LIMIT(k).delayAfter; } loginFails.set(k, f); } };
export const loginOk = (req, email) => { for (const k of failKey(req, email)) loginFails.delete(k); };
/* eviction of stale throttle entries — started by server.js like the other schedulers (v1.68: no timer as an import side effect) */
let loginGc = null;
export const startLoginGc = () => { if (loginGc) return; loginGc = setInterval(() => { const now = Date.now(); for (const [k, f] of loginFails) if (f.until < now && (f.ts || 0) < now - 60 * 60000) loginFails.delete(k); }, 10 * 60000); loginGc.unref(); };
export const stopLoginGc = () => { if (loginGc) clearInterval(loginGc); loginGc = null; };
