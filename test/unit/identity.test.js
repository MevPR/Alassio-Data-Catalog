import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/db.js", async () => (await import("../helpers/server-mocks.js")).mockDb());
vi.mock("../../server/audit.js", () => ({ sysAudit: vi.fn(async () => {}) }));
vi.mock("../../server/settings.js", () => ({ getSetting: vi.fn(async () => ({})), setSetting: vi.fn(async () => {}) }));

const { rolesForGroups, passwordLoginAllowed, AUTH_MODE, HEADER_CFG, identityInfo } = await import("../../server/identity.js");

describe("identity layer", () => {
  it("maps groups to roles case-insensitively and reports no match as null", () => {
    const mapping = { rules: [{ group: "DATA-STEWARDS", roles: ["steward"] }, { group: "a1b2-c3d4", roles: ["pm", "ba"] }, { group: "Admins", roles: ["admin"] }] };
    expect(rolesForGroups(mapping, ["Everyone", "data-stewards"])).toEqual(["steward"]);
    expect(rolesForGroups(mapping, ["A1B2-C3D4", "DATA-STEWARDS"]).sort()).toEqual(["ba", "pm", "steward"]);
    expect(rolesForGroups(mapping, ["Everyone"])).toBeNull();
    expect(rolesForGroups(mapping, [])).toBeNull();
    expect(rolesForGroups({ rules: [] }, ["Admins"])).toBeNull();
    expect(rolesForGroups(null, ["Admins"])).toBeNull();
  });
  it("allows password sign-in unless SSO is enforced, except for break-glass accounts", () => {
    expect(AUTH_MODE).toBe("local");
    expect(passwordLoginAllowed({ enabled: false, enforce: true }, "a@x.de")).toBe(true);
    expect(passwordLoginAllowed({ enabled: true, enforce: false }, "a@x.de")).toBe(true);
    expect(passwordLoginAllowed({ enabled: true, enforce: true, breakGlass: ["Boss@X.de"] }, "a@x.de")).toBe(false);
    expect(passwordLoginAllowed({ enabled: true, enforce: true, breakGlass: ["Boss@X.de"] }, "boss@x.de")).toBe(true);
    expect(passwordLoginAllowed(null, "a@x.de")).toBe(true);
  });
  it("describes the identity mode and default header names", () => {
    expect(identityInfo()).toEqual({ mode: "local", headers: null });
    expect(HEADER_CFG.email).toBe("x-forwarded-email"); expect(HEADER_CFG.token).toBe("x-forwarded-access-token");
  });
});
