/* v1.70 — server/users.js is the one place that reads and creates accounts; the routes, the identity layer and the
   OAuth server call it instead of repeating the SQL. */
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls = [];
let rows = [];
vi.mock("../../server/db.js", () => ({ q: vi.fn(async (sql, params) => { calls.push([sql, params]); return typeof rows === "function" ? rows(sql, params) : rows; }) }));

const users = await import("../../server/users.js");

beforeEach(() => { calls.length = 0; rows = []; });

describe("users repository", () => {
  it("createUser lower-cases the e-mail, defaults roles to [role] and stores the JSON column", async () => {
    const u = await users.createUser({ id: "u1", name: "Ada", email: "Ada@X.io", role: "admin", passwordHash: "h" });
    expect(u).toEqual({ id: "u1", name: "Ada", email: "ada@x.io", role: "admin", roles: ["admin"] });
    const [sql, params] = calls[0];
    expect(sql).toMatch(/^INSERT INTO users/); expect(params.slice(0, 6)).toEqual(["u1", "Ada", "ada@x.io", "admin", '["admin"]', "h"]); expect(params[7]).toBeNull();
    const v = await users.createUser({ name: "Bot", email: "b@agents.local", role: "agent", roles: ["agent"], passwordHash: "h", ssoSub: "sub-1" });
    expect(v.id).toMatch(/\w+/); expect(calls[1][1][7]).toBe("sub-1");
  });
  it("findUser / findByEmail / requireUser / emailTaken", async () => {
    rows = [{ id: "u1", email: "ada@x.io", roles: '["admin","pm"]' }];
    expect((await users.findUser("u1")).id).toBe("u1");
    expect((await users.findByEmail("ADA@x.io"))).toBeTruthy(); expect(calls.at(-1)[1]).toEqual(["ada@x.io"]);
    expect((await users.findUserWithRoles("u1")).roles).toEqual(["admin", "pm"]);
    expect(await users.emailTaken("ada@x.io")).toBe(true); expect(calls.at(-1)[0]).not.toMatch(/id <>/);
    expect(await users.emailTaken("ada@x.io", "u1")).toBe(true); expect(calls.at(-1)[0]).toMatch(/id <> \?/);
    rows = [];
    expect(await users.findUser("nope")).toBeNull();
    await expect(users.requireUser("nope")).rejects.toMatchObject({ status: 404, message: "User not found" });
  });
  it("countUsers, isLastAdmin, emailSet, findBySsoSubOrEmail", async () => {
    rows = [{ n: "1" }];
    expect(await users.countUsers()).toBe(1);
    expect(await users.isLastAdmin({ role: "admin" })).toBe(true); expect(await users.isLastAdmin({ role: "pm", roles: ["pm"] })).toBe(false);
    rows = [{ email: "A@x.io" }, { email: "b@x.io" }];
    expect([...(await users.emailSet())]).toEqual(["a@x.io", "b@x.io"]);
    rows = [{ id: "u2" }];
    await users.findBySsoSubOrEmail("sub", "a@x.io"); expect(calls.at(-1)).toEqual([expect.stringMatching(/sso_sub = \? OR email = \?/), ["sub", "a@x.io"]]);
    await users.findBySsoSubOrEmail(null, "a@x.io"); expect(calls.at(-1)).toEqual([expect.stringMatching(/WHERE email = \?$/), ["a@x.io"]]);
  });
});
