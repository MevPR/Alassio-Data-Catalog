/* v1.73 (F-S7): the two use cases behind PATCH /admin/users/:id — validation, persistence, audit, refusals (400) */
import { describe, it, expect, vi, beforeEach } from "vitest";
const sql = vi.hoisted(() => []);
const state = vi.hoisted(() => ({ taken: false, admins: 2 }));
vi.mock("../../server/db.js", () => ({ q: vi.fn(async (s, p = []) => { sql.push([s, p]); if (/^SELECT id FROM users WHERE email/.test(s)) return state.taken ? [{ id: "x" }] : []; if (/COUNT\(\*\) AS n FROM users WHERE role = 'admin'/.test(s)) return [{ n: state.admins }]; return { affectedRows: 1 }; }), pool: {}, sql: {} }));
vi.mock("../../server/audit.js", () => ({ sysAudit: vi.fn(async () => {}) }));
const { updateProfile, updateRoles, isRoleChange, cleanRoles } = await import("../../server/user-admin.js");
const { sysAudit } = await import("../../server/audit.js");

const admin = { id: "a", name: "Ada", email: "ada@x.io", role: "admin", roles: ["admin"] };
const sam = { id: "s", name: "Sam", email: "sam@x.io", role: "steward", roles: JSON.stringify(["steward"]) };
beforeEach(() => { sql.length = 0; state.taken = false; state.admins = 2; vi.clearAllMocks(); });

describe("user administration use cases", () => {
  it("dispatch: any role field is a role change", () => {
    expect(isRoleChange({ name: "x" })).toBe(false);
    expect(isRoleChange({ role: "guest" })).toBe(true);
    expect(isRoleChange({ roles: [] })).toBe(true);
    expect(cleanRoles({ roles: ["steward", "nope", "steward"] })).toEqual(["steward"]);
  });
  it("updateProfile normalises, refuses invalid or taken e-mails and audits only real changes", async () => {
    expect(await updateProfile(sam, { name: " Samuel ", email: "SAM2@x.io " }, admin)).toEqual({ name: "Samuel", email: "sam2@x.io" });
    expect(sql.at(-1)).toEqual(["UPDATE users SET name = ?, email = ? WHERE id = ?", ["Samuel", "sam2@x.io", "s"]]);
    expect(sysAudit).toHaveBeenCalledWith(admin, "user", "updated", "sam2@x.io", [{ field: "name", from: "Sam", to: "Samuel" }, { field: "email", from: "sam@x.io", to: "sam2@x.io" }]);
    vi.clearAllMocks();
    await updateProfile(sam, {}, admin);
    expect(sysAudit).not.toHaveBeenCalled();
    await expect(updateProfile(sam, { name: " " }, admin)).rejects.toMatchObject({ status: 400, message: "Name is required" });
    await expect(updateProfile(sam, { email: "nope" }, admin)).rejects.toMatchObject({ status: 400, message: "Valid e-mail required" });
    state.taken = true;
    await expect(updateProfile(sam, { email: "x@x.io" }, admin)).rejects.toMatchObject({ status: 400, message: "Another account already uses this e-mail" });
  });
  it("updateRoles: never one's own, at least one valid role, the last admin stays admin", async () => {
    expect(await updateRoles(sam, { roles: ["ba", "steward"] }, admin)).toEqual({ role: "steward", roles: ["ba", "steward"] });
    expect(sysAudit).toHaveBeenCalledWith(admin, "user", "updated", "sam@x.io", [{ field: "roles", from: "steward", to: "ba,steward" }]);
    await expect(updateRoles(admin, { role: "guest" }, admin)).rejects.toMatchObject({ status: 400, message: "You cannot change your own role" });
    await expect(updateRoles(sam, { roles: ["nope"] }, admin)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/^At least one valid role is required/) });
    state.admins = 1;
    await expect(updateRoles({ ...admin, id: "a2" }, { role: "guest" }, admin)).rejects.toMatchObject({ status: 400, message: "Cannot demote the last admin" });
  });
  it("v1.74 (F-S8): agent accounts and human accounts cannot be turned into each other by an edit", async () => {
    const bot = { id: "b", name: "Bot", email: "bot@agents.local", role: "agent", roles: JSON.stringify(["agent"]) };
    await expect(updateProfile(sam, { email: "sam@agents.local" }, admin)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/reserved for agent accounts/) });
    await expect(updateProfile(bot, { email: "bot@x.io" }, admin)).rejects.toMatchObject({ status: 400, message: "An agent account keeps its @agents.local address" });
    expect(await updateProfile(bot, { name: "Bot 2" }, admin)).toEqual({ name: "Bot 2", email: "bot@agents.local" });   /* renaming is fine */
    await expect(updateRoles(sam, { roles: ["agent", "steward"] }, admin)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/only for agent accounts/) });
    await expect(updateRoles(bot, { roles: ["guest"] }, admin)).rejects.toMatchObject({ status: 400, message: "An agent account keeps the agent role" });
    expect(await updateRoles(bot, { roles: ["agent", "guest"] }, admin)).toMatchObject({ roles: ["agent", "guest"] });
  });
});
