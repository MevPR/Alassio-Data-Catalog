import { describe, it, expect, vi } from "vitest";

/* the OAuth module and the collab module import the DB pool — mock it so the pure helpers load without MariaDB */
vi.mock("../../server/db.js", async () => (await import("../helpers/server-mocks.js")).mockDb());
vi.mock("../../server/mail.js", () => ({ notifyI18n: vi.fn(async () => 1) }));
vi.mock("../../server/catalog-store.js", () => ({ assembleLite: vi.fn(async () => ({ catalog: null })) }));
vi.mock("../../server/audit.js", () => ({ sysAudit: vi.fn(async () => {}) }));

const { rateLimit, rateLimits, metadata, resourceMetadata, consentPage, SCOPES } = await import("../../server/oauth.js");
const { validateComment, validateStars, canEdit, canResolve, threadsOf, ratingSummary, ENTITY_TYPES } = await import("../../server/collab.js");
const { renderMessage } = await import("../../server/i18n.js");

describe("OAuth metadata and consent page", () => {
  it("advertises PKCE-only authorization code + refresh grants and the MCP resource", () => {
    const m = metadata();
    expect(m.code_challenge_methods_supported).toEqual(["S256"]);
    expect(m.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(m.authorization_endpoint.endsWith("/oauth/authorize")).toBe(true);
    expect(m.registration_endpoint.endsWith("/oauth/register")).toBe(true);
    expect(resourceMetadata().resource.endsWith("/mcp")).toBe(true);
    expect(resourceMetadata().authorization_servers).toEqual([m.issuer]);
    expect(SCOPES).toEqual(["catalog:read", "catalog:write"]);
  });
  it("renders a CSP-safe consent form that escapes client-supplied text", () => {
    const html = consentPage({ client: { id: "cxc_1", name: "<script>alert(1)</script>", client_uri: "https://c.example" }, user: { name: "Jane", email: "jane@x.de" }, scopes: ["catalog:read", "catalog:write"], state: "s\"t", redirect: "http://localhost:9/cb", challenge: "abc", csrf: "tok" });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('name="_csrf" value="tok"');
    expect(html).toContain('name="state" value="s&quot;t"');
    expect(html).toContain('value="deny"'); expect(html).toContain('value="allow"');
    expect(html).toMatch(/Read <b>and change<\/b>/);
    expect(html).not.toMatch(/<script/);   /* no inline scripts: works under script-src 'self' */
  });
});

describe("MCP rate limiting", () => {
  it("counts requests and write calls per credential in a sliding minute", () => {
    const { perMinute, writesPerMinute } = rateLimits();
    expect(perMinute).toBeGreaterThan(0); expect(writesPerMinute).toBeGreaterThan(0);
    const key = `unit-${Date.now()}`;
    let last;
    for (let i = 0; i < perMinute; i++) last = rateLimit(key, false);
    expect(last.limited).toBe(false); expect(last.remaining).toBe(0);
    const over = rateLimit(key, false);
    expect(over.limited).toBe(true); expect(over.kind).toBe("requests"); expect(over.retryAfter).toBeGreaterThanOrEqual(1); expect(over.retryAfter).toBeLessThanOrEqual(60);
    /* another credential is independent */
    expect(rateLimit(`${key}-b`, false).limited).toBe(false);
  });
  it("applies the tighter write limit only to mutating calls", () => {
    const { writesPerMinute } = rateLimits();
    const key = `unit-w-${Date.now()}`;
    for (let i = 0; i < writesPerMinute; i++) expect(rateLimit(key, true).limited).toBe(false);
    const over = rateLimit(key, true);
    expect(over.limited).toBe(true); expect(over.kind).toBe("write calls"); expect(over.limit).toBe(writesPerMinute);
    expect(rateLimit(key, false).limited).toBe(false, "reads still pass");
  });
});

describe("collaboration helpers", () => {
  const admin = { email: "root@x.de", roles: ["admin"] }, steward = { email: "stew@x.de", roles: ["steward"] }, guest = { email: "gus@x.de", roles: ["guest"] };
  it("validates comments, kinds and thread rules", () => {
    expect(validateComment({ body: "  hi  " })).toEqual({ body: "hi", kind: "comment", parentId: null });
    expect(validateComment({ body: "q?", kind: "question" }).kind).toBe("question");
    expect(validateComment({ body: "a", kind: "answer", parentId: "p1" })).toEqual({ body: "a", kind: "answer", parentId: "p1" });
    expect(validateComment({ body: "x", kind: "weird" }).kind).toBe("comment");
    expect(() => validateComment({ body: "" })).toThrow(/empty/);
    expect(() => validateComment({ body: "x".repeat(4001) })).toThrow(/4000/);
    expect(() => validateComment({ body: "a", kind: "answer" })).toThrow(/needs the question/);
    expect(() => validateComment({ body: "q", kind: "question", parentId: "p" })).toThrow(/thread of its own/);
    expect(validateStars(4.4)).toBe(4); expect(() => validateStars(0)).toThrow(); expect(() => validateStars("x")).toThrow(); expect(() => validateStars(6)).toThrow();
    expect(ENTITY_TYPES).toContain("table"); expect(ENTITY_TYPES).toContain("schema");
  });
  it("lets authors and admins edit, and askers / stewards / admins resolve", () => {
    const c = { by_email: "gus@x.de", kind: "question" };
    expect(canEdit(c, guest)).toBe(true); expect(canEdit(c, steward)).toBe(false); expect(canEdit(c, admin)).toBe(true); expect(canEdit(c, null)).toBe(false);
    expect(canResolve(c, guest)).toBe(true); expect(canResolve(c, steward)).toBe(true); expect(canResolve(c, { email: "o@x.de", roles: ["guest"] })).toBe(false);
  });
  it("threads flat rows and summarises ratings", () => {
    const rows = [{ id: "a", parentId: null, ts: 1 }, { id: "b", parentId: null, ts: 3 }, { id: "a1", parentId: "a", ts: 5 }, { id: "a0", parentId: "a", ts: 2 }];
    const th = threadsOf(rows);
    expect(th.map((t) => t.id)).toEqual(["b", "a"]);
    expect(th[1].replies.map((r) => r.id)).toEqual(["a0", "a1"]);
    const r = ratingSummary([{ by_email: "a@x", stars: 5 }, { by_email: "b@x", stars: 2 }, { by_email: "c@x", stars: 4 }], "B@x");
    expect(r).toEqual({ avg: 3.7, count: 3, mine: 2, histogram: [0, 1, 0, 1, 1] });
    expect(ratingSummary([])).toEqual({ avg: null, count: 0, mine: null, histogram: [0, 0, 0, 0, 0] });
  });
  it("has question notifications in all six languages", () => {
    for (const l of ["en", "de", "pl", "es", "fr", "it"]) {
      const a = renderMessage("question_asked", l, { path: "GOLD.claims.fct", asker: "Al", body: "Net or gross?" });
      const b = renderMessage("question_answered", l, { path: "GOLD.claims.fct", answerer: "Cora", body: "Net." });
      expect(a.subject).toContain("GOLD.claims.fct"); expect(a.body).toContain("Net or gross?"); expect(a.body).toContain("Al");
      expect(b.subject).toContain("GOLD.claims.fct"); expect(b.body).toContain("Cora"); expect(b.body).toContain("Net.");
    }
    expect(renderMessage("question_asked", "de", { path: "p", asker: "a", body: "b" }).subject).toBe("Frage zu p");
  });
});
