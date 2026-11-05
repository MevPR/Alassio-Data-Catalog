/* CSRF token handling for the browser. The server sets a readable cookie `dhc_csrf` next to the httpOnly session
   cookie; every state-changing same-origin request repeats it in the X-CSRF-Token header (fetch/XHR) or in the
   hidden `_csrf` field of a form post. See server/security.js. */
export const CSRF_COOKIE = "dhc_csrf";
export const CSRF_HEADER = "X-CSRF-Token";

export const readCookie = (name, cookieString = typeof document !== "undefined" ? document.cookie : "") => {
  for (const part of String(cookieString || "").split(";")) {
    const i = part.indexOf("="); const k = (i < 0 ? part : part.slice(0, i)).trim();
    if (k === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
};
export const csrfToken = () => readCookie(CSRF_COOKIE) || "";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
const isSameOrigin = (url, loc) => {
  try { return new URL(String(url), loc.href).origin === loc.origin; } catch { return false; }
};

/* adds the header to a fetch/XHR headers object; returns true when a token was available */
export const withCsrf = (headers) => { const tok = csrfToken(); if (tok) headers.set(CSRF_HEADER, tok); return !!tok; };

/* wraps window.fetch once: same-origin non-GET requests get the header. When the server rejects the token
   (403, code "csrf" — e.g. after a login in another tab rotated the session), the cookie is refreshed with a
   GET /auth/me and the request is retried once. */
export function installCsrfFetch(win = typeof window !== "undefined" ? window : null) {
  if (!win || win.__csrfFetchInstalled) return;
  const base = win.fetch.bind(win);
  win.fetch = async (input, init) => {
    const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = input instanceof Request ? input.url : input;
    if (SAFE.has(method) || !isSameOrigin(url, win.location)) return base(input, init);
    const send = () => {
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      withCsrf(headers);
      return base(input, { ...init, headers });
    };
    const r = await send();
    if (r.status !== 403) return r;
    const body = await r.clone().json().catch(() => null);
    if (body?.code !== "csrf") return r;
    await base("/auth/me", { credentials: "same-origin" }).catch(() => {});   /* re-issues the csrf cookie for the current session */
    return send();
  };
  win.__csrfFetchInstalled = true;
}
