import { describe, it, expect } from "vitest";
import path from "path";
import { buildOkfBundle } from "../../okf.js";

const cat = {
  hubs: [{ id: "h1", name: "Health", ownerId: "p1" }, { id: "src", name: "SOURCE" }],
  people: [{ id: "p1", name: "Owen Owner" }], domains: [{ id: "dm1", name: "Claims", stewardId: "p1" }],
  databases: [{ id: "d1", name: "GOLD", hubId: "h1", country: "DE", layer: "gold", domainId: "dm1" }, { id: "d2", name: "legacy", hubId: "src", layer: "bronze" }],
  schemas: [{ id: "s1", databaseId: "d1", name: "partners" }, { id: "s2", databaseId: "d2", name: "CLAIMS" }],
  tables: [{ id: "t1", schemaId: "s1", name: "loss_ratio", kvTags: [{ key: "Data Product", value: "Health Gold.x (X)" }] }, { id: "t2", schemaId: "s2", name: "PAYMENT" }],
  attributes: [{ id: "a1", tableId: "t1", name: "lr|pct", dataType: "DECIMAL", isPK: true, nullable: false }],
  lineage: [{ id: "e1", from: "t2", to: "t1", mappings: [] }],
  glossary: [{ id: "g1", name: "Loss ratio", definition: "def", refs: [{ type: "table", id: "t1" }], urls: [{ name: "Wiki", url: "https://x" }] }],
};

const files = await buildOkfBundle(cat, { tableIds: null }, { version: "t", catalogVersion: 1 });
describe("OKF bundle", () => {
  it("has index, log, one concept per object, frontmatter with type", () => {
    expect(files["index.md"]).toContain('type: "catalog"');
    expect(files["log.md"]).toContain("glossary terms");
    expect(files["hubs/health/gold/partners/loss-ratio.md"]).toContain('type: "table"');
    expect(files["glossary/loss-ratio.md"]).toContain('type: "glossary_term"');
    for (const [p, s] of Object.entries(files)) if (p !== "log.md") expect(s.startsWith("---\n")).toBe(true);
  });
  it("resolves every relative link", () => {
    for (const [p, s] of Object.entries(files)) for (const m of s.matchAll(/\]\(([^)]+\.md)\)/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(p), m[1]));
      expect(files[target], `${p} -> ${m[1]}`).toBeDefined();
    }
  });
  it("escapes pipes in attribute tables and carries table tags", () => {
    const t = files["hubs/health/gold/partners/loss-ratio.md"];
    expect(t).toContain("lr\\|pct");
    expect(t).toContain("table_tags:");
  });
  it("honours the selection", async () => {
    const sel = await buildOkfBundle(cat, { tableIds: ["t2"], schemaIds: [], databaseIds: [] }, { version: "t" });
    expect(Object.keys(sel).some((f) => f.includes("/gold/"))).toBe(false);
    expect(sel["hubs/source/legacy/claims/payment.md"]).toBeDefined();
  });
});
