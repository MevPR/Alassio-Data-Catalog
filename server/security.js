/* Browser-facing security: response headers (CSP & co.) and CSRF protection for cookie sessions.
   CSRF uses a session-bound double-submit token: dhc_csrf = HMAC(secret, session token) is set as a readable
   cookie; every state-changing request with a session cookie must repeat it in the X-CSRF-Token header (or in
   the _csrf field of a form post). Token-authenticated clients (MCP bearer keys) are not affected. */
import crypto from "crypto";
import { COOKIE } from "./config.js";
import { getSetting, setSetting } from "./settings.js";

export const CSRF_COOKIE = "dhc_csrf";
export const CSRF_HEADER = "x-csrf-token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
let secret = process.env.CSRF_SECRET || null;

/* the HMAC secret is generated once and kept in the settings table, so tokens survive restarts */
export const initCsrf = async () => {
  if (secret) return;
  secret = await getSetting("security.csrfSecret");
  if (!secret) { secret = crypto.randomBytes(32).toString("base64url"); await setSetting("security.csrfSecret", secret, { email: "system" }); }
};
export const csrfFor = (sessionToken) => crypto.createHmac("sha256", String(secret || "boot")).update(String(sessionToken || "")).digest("base64url");
/* v1.66.1: cookies are Secure behind TLS even without COOKIE_SECURE=1 (x-forwarded-proto from the proxy) */
export const cookieSecure = (req) => process.env.COOKIE_SECURE === "1" || String(req?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim() === "https" || !!req?.secure;
const cookieOpts = (req) => ({ httpOnly: false, sameSite: "lax", secure: cookieSecure(req), path: "/" });
export const setCsrfCookie = (res, sessionToken, req = null) => res.cookie(CSRF_COOKIE, csrfFor(sessionToken), cookieOpts(req));
export const clearCsrfCookie = (res) => res.clearCookie(CSRF_COOKIE, { path: "/" });

export const safeEqual = (a, b) => { const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || "")); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };
const originOk = (req) => {
  const origin = req.headers.origin || (req.headers.referer ? (() => { try { return new URL(req.headers.referer).origin; } catch { return null; } })() : null);
  if (!origin) return true;                     /* same-origin fetches without Origin are fine; browsers send Origin on cross-site POSTs */
  try { const h = new URL(origin).host; return h === req.headers.host || h === String(req.headers["x-forwarded-host"] || "").split(",")[0].trim(); } catch { return false; }   /* proxies may rewrite Host */
};
export const csrfFail = (res, why) => res.status(403).json({ error: `Request blocked (CSRF): ${why} — reload the page and try again`, code: "csrf" });

/* checks a token value against the session of the request */
export const csrfValid = (req, token) => !!req.user && safeEqual(token, csrfFor(req.cookies?.[COOKIE]));

/* middleware: unsafe requests carrying a session cookie need the header. Form posts (urlencoded) are checked by the
   route after body parsing via requireCsrfBody(); bearer-authenticated requests (MCP) carry no session cookie. */
const FORM_ROUTES = new Set(["/oauth/authorize", "/api/export/csv", "/api/export/okf"]);
export const csrfGuard = (req, res, next) => {
  if (SAFE_METHODS.has(req.method) || !req.user || req.path === "/mcp") return next();
  if (req.path.startsWith("/oauth/") && req.path !== "/oauth/authorize") return next();   /* token/register/revoke: public OAuth endpoints, client-authenticated */
  if (!originOk(req)) return csrfFail(res, "origin mismatch");
  if (req.csrfFresh) return next();   /* header-auth session created by this very request: same-origin verified, no token issued yet */
  const header = req.headers[CSRF_HEADER];
  if (header) return csrfValid(req, header) ? next() : csrfFail(res, "invalid token");
  /* v1.66.1: form posts are accepted only where a route verifies the _csrf field (the OAuth consent form and the
     export forms) — everywhere else a token-less urlencoded POST is rejected like any other */
  if (String(req.headers["content-type"] || "").startsWith("application/x-www-form-urlencoded") && FORM_ROUTES.has(req.path.replace(/\/+$/, ""))) { req.csrfPending = true; return next(); }
  return csrfFail(res, "missing token");
};
export const requireCsrfBody = (req, res) => {
  if (!req.csrfPending) return true;
  if (csrfValid(req, req.body?._csrf)) return true;
  csrfFail(res, "missing or invalid form token"); return false;
};

/* stored files (request documents, glossary attachments) go out the same way (v1.72, F-S11): a MIME type that is not
   a plain type/subtype becomes application/octet-stream (rows stored before upload-side sanitising included), always
   as an attachment and never cached by shared caches */
export const SAFE_MIME = /^[\w.+-]+\/[\w.+-]+$/;
export const safeMime = (mime) => (SAFE_MIME.test(String(mime || "")) && String(mime).length <= 100 ? String(mime) : "application/octet-stream");
export const sendAttachment = (res, { name, mime, data }) => {
  res.setHeader("Content-Type", safeMime(mime));
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(String(name || "download"))}`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(data);
};

/* security headers for every response (nginx repeats them for the static UI — see deploy/nginx-datahub-catalog.conf) */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",   /* the UI injects its stylesheet and uses inline style attributes */
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",                                        /* QR codes for 2FA are data URLs */
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");
export const securityHeaders = (req, res, next) => {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (process.env.COOKIE_SECURE === "1" || req.headers["x-forwarded-proto"] === "https") res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
};
