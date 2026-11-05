/* v1.72 (F-S15): server/security.js — the CSRF middleware (exemptions, origin check, token check, form allow-list),
   requireCsrfBody and sendAttachment, with fake req/res objects (until now covered only by the E2E suite) */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/db.js", async () => (await import("../helpers/server-mocks.js")).mockDb());
vi.mock("../../server/settings.js", () => ({ getSetting: vi.fn(async () => null), setSetting: vi.fn(async () => {}) }));

const { csrfGuard, requireCsrfBody, csrfFor, CSRF_HEADER, sendAttachment, safeMime } = await import("../../server/security.js");
const { COOKIE } = await import("../../server/config.js");

const SESSION = "session-token-1";
const fakeReq = ({ method = "POST", path = "/api/catalog", user = { id: "u1" }, headers = {}, body = undefined, ...rest } = {}) =>
  ({ method, path, user, headers: { host: "catalog.example", ...headers }, cookies: { [COOKIE]: SESSION }, body, ...rest });
const fakeRes = () => {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  res.setHeader = vi.fn((k, v) => { res.headers[k.toLowerCase()] = v; });
  res.send = vi.fn((b) => { res.body = b; return res; });
  return res;
};
/* runs the middleware; returns "next" or the 403 reason */
const run = (req) => {
  const res = fakeRes(), next = vi.fn();
  csrfGuard(req, res, next);
  if (next.mock.calls.length) { expect(res.status).not.toHaveBeenCalled(); return "next"; }
  expect(res.statusCode).toBe(403); expect(res.body.code).toBe("csrf");
  return res.body.error.match(/^Request blocked \(CSRF\): (.*) — reload/)[1];
};
const token = csrfFor(SESSION);

describe("csrfGuard — exemptions", () => {
  it("safe methods pass without a token", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) expect(run(fakeReq({ method }))).toBe("next");
  });
  it("sessionless requests pass (bearer-authenticated callers carry no session cookie)", () => {
    expect(run(fakeReq({ user: null }))).toBe("next");
    expect(run(fakeReq({ user: null, headers: { origin: "https://evil.example" } }))).toBe("next");
  });
  it("/mcp and the public OAuth endpoints pass; the consent form does not", () => {
    expect(run(fakeReq({ path: "/mcp" }))).toBe("next");
    for (const path of ["/oauth/token", "/oauth/register", "/oauth/revoke"]) expect(run(fakeReq({ path }))).toBe("next");
    expect(run(fakeReq({ path: "/oauth/authorize" }))).toBe("missing token");
  });
  it("a header-auth session created by this very request passes once the origin is fine", () => {
    expect(run(fakeReq({ csrfFresh: true }))).toBe("next");
    expect(run(fakeReq({ csrfFresh: true, headers: { origin: "https://evil.example" } }))).toBe("origin mismatch");
  });
});

describe("csrfGuard — origin check", () => {
  const withToken = (headers) => fakeReq({ headers: { [CSRF_HEADER]: token, ...headers } });
  it("no Origin / Referer (same-origin fetch) is fine", () => expect(run(withToken({}))).toBe("next"));
  it("Origin must name the Host — or the first X-Forwarded-Host of a rewriting proxy", () => {
    expect(run(withToken({ origin: "https://catalog.example" }))).toBe("next");
    expect(run(withToken({ origin: "https://evil.example" }))).toBe("origin mismatch");
    expect(run(withToken({ host: "127.0.0.1:3000", origin: "https://catalog.example", "x-forwarded-host": "catalog.example, other" }))).toBe("next");
    expect(run(withToken({ host: "127.0.0.1:3000", origin: "https://catalog.example", "x-forwarded-host": "other, catalog.example" }))).toBe("origin mismatch");
  });
  it("falls back to the Referer's origin; malformed values fail closed", () => {
    expect(run(withToken({ referer: "https://catalog.example/some/page?x=1" }))).toBe("next");
    expect(run(withToken({ referer: "https://evil.example/page" }))).toBe("origin mismatch");
    expect(run(withToken({ origin: "not a url" }))).toBe("origin mismatch");
    expect(run(withToken({ referer: "::::" }))).toBe("next");   /* unparsable Referer counts as absent, like before */
  });
  it("the origin check runs before the token check", () => {
    expect(run(fakeReq({ headers: { origin: "https://evil.example", [CSRF_HEADER]: "wrong" } }))).toBe("origin mismatch");
  });
});

describe("csrfGuard — token", () => {
  it("accepts the HMAC of the session cookie and rejects anything else", () => {
    expect(run(fakeReq({ headers: { [CSRF_HEADER]: token } }))).toBe("next");
    expect(run(fakeReq({ headers: { [CSRF_HEADER]: csrfFor("another-session") } }))).toBe("invalid token");
    expect(run(fakeReq({ headers: { [CSRF_HEADER]: "x" } }))).toBe("invalid token");
    expect(run(fakeReq({}))).toBe("missing token");
    for (const method of ["PUT", "PATCH", "DELETE"]) expect(run(fakeReq({ method }))).toBe("missing token");
  });
});

describe("csrfGuard — form posts", () => {
  const form = (path, extra = {}) => fakeReq({ path, headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" }, ...extra });
  it("only the allow-listed form routes defer the check to the route (csrfPending)", () => {
    for (const path of ["/oauth/authorize", "/api/export/csv", "/api/export/okf", "/api/export/csv/"]) {
      const req = form(path);
      expect(run(req), path).toBe("next"); expect(req.csrfPending).toBe(true);
    }
    const other = form("/api/catalog");
    expect(run(other)).toBe("missing token"); expect(other.csrfPending).toBeUndefined();
    expect(run(fakeReq({ path: "/api/export/csv", headers: { "content-type": "application/json" } }))).toBe("missing token");
  });
  it("requireCsrfBody verifies the _csrf field of a deferred form post", () => {
    expect(requireCsrfBody(fakeReq({}), fakeRes())).toBe(true);   /* nothing deferred */
    expect(requireCsrfBody(fakeReq({ csrfPending: true, body: { _csrf: token } }), fakeRes())).toBe(true);
    for (const body of [{ _csrf: "nope" }, {}, undefined]) {
      const res = fakeRes();
      expect(requireCsrfBody(fakeReq({ csrfPending: true, body }), res)).toBe(false);
      expect(res.statusCode).toBe(403); expect(res.body.error).toMatch(/missing or invalid form token/);
    }
    expect(requireCsrfBody(fakeReq({ csrfPending: true, user: null, body: { _csrf: token } }), fakeRes())).toBe(false);
  });
});

describe("sendAttachment", () => {
  it("sends a sanitised MIME type, an attachment disposition and no-store caching", () => {
    const res = fakeRes();
    sendAttachment(res, { name: "Prüfbericht 2026.pdf", mime: "application/pdf", data: Buffer.from("x") });
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe("attachment; filename*=UTF-8''Pr%C3%BCfbericht%202026.pdf");
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.send).toHaveBeenCalledWith(Buffer.from("x"));
  });
  it("anything but a plain type/subtype becomes application/octet-stream", () => {
    for (const m of ["text/html; charset=utf-8", "text/html\r\nX-Evil: 1", "", null, undefined, "noslash", `a/${"b".repeat(120)}`]) expect(safeMime(m), String(m)).toBe("application/octet-stream");
    expect(safeMime("image/svg+xml")).toBe("image/svg+xml");
  });
});
