/* v1.66 — pure parts of the server-side imports and the capability flags */
import { describe, it, expect } from "vitest";
import { parseBundle } from "../../server/catalog-import.js";
import { capabilitiesOf } from "../../server/auth.js";

describe("server-side bundle parsing (v1.66)", () => {
  it("parses a dbt manifest into databases + lineage and reports unreadable files as 400", () => {
    const manifest = { metadata: { project_name: "p", dbt_version: "1.8" }, nodes: { "model.p.m": { resource_type: "model", name: "m", database: "D", schema: "S", description: "d", columns: { id: { name: "id" } }, depends_on: { nodes: ["source.p.s.raw"] } } }, sources: { "source.p.s.raw": { resource_type: "source", name: "raw", database: "D", schema: "S", columns: {} } } };
    const r = parseBundle({ kind: "dbt", manifest: JSON.stringify(manifest), fileName: "manifest.json" });
    expect(r.sourceType).toBe("dbt"); expect(r.databases[0].name).toBe("D"); expect(r.databases[0].schemas[0].tables.map((t) => t.name).sort()).toEqual(["m", "raw"]);
    expect(r.lineage).toEqual([["D.S.raw", "D.S.m"]]); expect(r.sourceRef).toMatchObject({ kind: "dbt", project: "p", file: "manifest.json", withCatalog: false });
    expect(() => parseBundle({ kind: "dbt", manifest: "{not json" })).toThrow(/Could not read the file/);
    try { parseBundle({ kind: "odcs", contracts: ["nothing: here"], fileName: "c.yaml" }); } catch (e) { expect(e.status).toBe(400); }
    expect(() => parseBundle({ kind: "zip" })).toThrow(/Unknown bundle kind/);
  });
});

describe("capabilities (v1.66)", () => {
  it("derives the role flags on the server", () => {
    expect(capabilitiesOf({ role: "admin", roles: ["admin"] })).toMatchObject({ admin: true, steward: true, canImport: true, canDesignProducts: true, canManageUsers: true, canExport: true });
    expect(capabilitiesOf({ role: "steward", roles: ["steward", "pm"] })).toMatchObject({ admin: false, steward: true, canImport: false, canDesignProducts: true, canActInWorkflow: true, canSeeAudit: true, canUseMcp: true });
    expect(capabilitiesOf({ role: "guest", roles: ["guest"] })).toMatchObject({ admin: false, steward: false, canDesignProducts: false, canActInWorkflow: false, canSeeAudit: false, canExport: true });
    expect(capabilitiesOf({ role: "agent", roles: ["agent"] })).toMatchObject({ agent: true, canExport: false });
  });
});
