// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readCookie, installCsrfFetch, CSRF_HEADER } from "../../src/lib/csrf.js";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/* a fake window with its own fetch and cookie so the wrapper can be tested in isolation */
const fakeWindow = (fetch) => ({ fetch, location: { href: "https://catalog.example/app", origin: "https://catalog.example" } });

describe("csrf: cookie reader", () => {
  it("reads a named cookie and ignores the others", () => {
    expect(readCookie("dhc_csrf", "a=1; dhc_csrf=tok%2B1; b=2")).toBe("tok+1");
    expect(readCookie("dhc_csrf", "dhc_csrf2=x")).toBeNull();
    expect(readCookie("dhc_csrf", "")).toBeNull();
  });
});

describe("csrf: fetch wrapper", () => {
  it("adds the header to same-origin state-changing requests only", async () => {
    document.cookie = "dhc_csrf=t0k3n";
    const base = vi.fn(async () => json(200, { ok: true }));
    const win = fakeWindow(base); installCsrfFetch(win);
    await win.fetch("/api/catalog", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(new Headers(base.mock.calls[0][1].headers).get(CSRF_HEADER)).toBe("t0k3n");
    expect(new Headers(base.mock.calls[0][1].headers).get("Content-Type")).toBe("application/json");
    await win.fetch("/api/catalog");
    expect(base.mock.calls[1][1]).toBeUndefined();
    await win.fetch("https://other.example/x", { method: "POST" });
    expect(base.mock.calls[2][1].headers).toBeUndefined();
  });

  it("refreshes the token and retries once when the server reports a CSRF failure", async () => {
    document.cookie = "dhc_csrf=old";
    const base = vi.fn(async (url) => {
      if (url === "/auth/me") { document.cookie = "dhc_csrf=fresh"; return json(200, { user: {} }); }
      return new Headers(base.mock.calls.at(-1)[1].headers).get(CSRF_HEADER) === "fresh" ? json(200, { ok: 1 }) : json(403, { code: "csrf", error: "invalid token" });
    });
    const win = fakeWindow(base); installCsrfFetch(win);
    const r = await win.fetch("/api/x", { method: "POST", body: "{}" });
    expect(r.status).toBe(200);
    expect(base.mock.calls.map((c) => c[0])).toEqual(["/api/x", "/auth/me", "/api/x"]);
  });

  it("passes other 403s through untouched and installs only once", async () => {
    const base = vi.fn(async () => json(403, { error: "forbidden" }));
    const win = fakeWindow(base); installCsrfFetch(win); installCsrfFetch(win);
    const r = await win.fetch("/api/x", { method: "DELETE" });
    expect(r.status).toBe(403); expect(base).toHaveBeenCalledTimes(1);
    expect((await r.json()).error).toBe("forbidden");
  });
});
