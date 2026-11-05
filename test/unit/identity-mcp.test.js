/* v1.61 — MCP behind an authenticating proxy (Databricks Apps): the forwarded identity acts as the human */
import { describe, it, expect, vi } from "vitest";

process.env.AUTH_MODE = "header";
vi.mock("../../server/db.js", async () => (await import("../helpers/server-mocks.js")).mockDb());
vi.mock("../../server/audit.js", () => ({ sysAudit: vi.fn(async () => {}) }));
vi.mock("../../server/settings.js", () => ({ getSetting: vi.fn(async () => ({ rules: [{ group: "DATA-STEWARDS", roles: ["steward"] }], syncRoles: false, unmatched: "deny" })), setSetting: vi.fn(async () => {}) }));

const { forwardedMcpIdentity, AUTH_MODE } = await import("../../server/identity.js");
const { q } = await import("../../server/db.js");
const users = (rows) => q.mockImplementation(async (sql, params = []) => {
  if (/COUNT\(\*\) AS n FROM users/i.test(sql)) return [{ n: /role = 'admin'/.test(sql) ? rows.filter((r) => r.role === "admin").length : rows.length }];
  if (/FROM users WHERE/i.test(sql)) return rows.filter((r) => params.some((p) => String(p).toLowerCase() === r.email));
  return [];
});

describe("forwarded MCP identity", () => {
  it("is null without identity headers", async () => {
    expect(AUTH_MODE).toBe("header");
    expect(await forwardedMcpIdentity({ headers: {} })).toBeNull();
    expect(await forwardedMcpIdentity({ headers: { "x-forwarded-email": "not-an-email" } })).toBeNull();
  });
  it("gives admins and stewards write scope, everyone else read", async () => {
    users([{ id: "u1", name: "Boss", email: "boss@proxy.example", role: "admin", roles: JSON.stringify(["admin"]) }]);
    expect(await forwardedMcpIdentity({ headers: { "x-forwarded-email": "Boss@proxy.example" } })).toMatchObject({ id: "u1", email: "boss@proxy.example", scope: "write", identity: "header" });
    users([{ id: "u2", name: "Gina", email: "gina@proxy.example", role: "guest", roles: JSON.stringify(["guest"]) }]);
    expect((await forwardedMcpIdentity({ headers: { "x-forwarded-email": "gina@proxy.example" } })).scope).toBe("read");
    users([{ id: "u3", name: "Sam", email: "sam@proxy.example", role: "steward", roles: JSON.stringify(["steward", "pm"]) }]);
    expect((await forwardedMcpIdentity({ headers: { "x-forwarded-email": "sam@proxy.example" } })).scope).toBe("write");
  });
  it("returns the denial as { error } when the group mapping rejects the caller", async () => {
    users([{ id: "u2", name: "Gina", email: "gina@proxy.example", role: "guest", roles: JSON.stringify(["guest"]) }]);
    const r = await forwardedMcpIdentity({ headers: { "x-forwarded-email": "nobody@proxy.example", "x-forwarded-groups": "Everyone" } });
    // nobody is unknown: with unmatched=deny and no matching group, provisioning is refused (an existing admin counts as "not first user")
    expect(r).toMatchObject({ error: expect.stringMatching(/no group that grants access/) });
  });
});
