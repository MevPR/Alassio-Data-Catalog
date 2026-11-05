import { describe, it, expect } from "vitest";
import { normCountry, guessLayer, csvHeader, migrate, seed, slugName, sourceLabel } from "../../src/lib/model.js";

describe("model helpers", () => {
  it("normalises data hub names (free text; empty → GLOBAL)", () => {
    expect(normCountry(" SALES_DE ")).toBe("SALES_DE");
    expect(normCountry("Source   SAP")).toBe("Source SAP");
    expect(normCountry("")).toBe("GLOBAL");
    expect(normCountry("x".repeat(80)).length).toBe(64);
  });
  it("migration derives each type's data hubs from its databases", () => {
    const s = migrate({ hubs: [{ id: "h", name: "Health" }], databases: [{ id: "d1", name: "BRONZE", hubId: "h", country: "SALES_DE" }, { id: "d2", name: "GOLD", hubId: "h", country: "SALES_DE" }], schemas: [], tables: [], attributes: [], domains: [], people: [] });
    expect(s.hubs[0].dataHubs.map((x) => x.name)).toEqual(["SALES_DE"]);
    const s2 = migrate({ hubs: [{ id: "h", name: "Health", ownerId: "owen" }], databases: [{ id: "d1", name: "BRONZE", hubId: "h", country: "DE" }], schemas: [], tables: [], attributes: [], domains: [], people: [] });
    expect(s2.hubs[0].ownerId).toBe(null);                                   // types have no owner any more
    expect(s2.hubs[0].dataHubs[0].bpoId).toBe("owen");                       // former type owner became the data hub's BPO
  });
  it("guesses medallion layers from names", () => {
    expect(guessLayer("GOLD")).toBe("gold");
    expect(guessLayer("bronze_raw")).toBe("bronze");
    expect(guessLayer("motor_prod")).toBe("other");
  });
  it("normalises CSV headers (BOM, case, spaces)", () => {
    expect(csvHeader("\ufeffData Hub")).toBe("data_hub");
    expect(csvHeader(" Table-Description ")).toBe("table_description");
  });
  it("seeds a new deployment with the SOURCE hub (v1.64.1)", () => {
    const s = seed();
    expect(s.hubs.at(-1)).toMatchObject({ id: "source", name: "SOURCE" }); expect(s.sourceHubInit).toBe(true);
    expect(migrate(structuredClone(s)).hubs.filter((h) => h.name === "SOURCE")).toHaveLength(1);
  });
  it("migrates legacy catalogs: country, layer, SOURCE hub, glossary", () => {
    const s = migrate({ hubs: [{ id: "h", name: "Health" }], databases: [{ id: "d", name: "GOLD", hubId: "h" }], schemas: [], tables: [{ id: "t", schemaId: "s", name: "x", layer: "gold" }], attributes: [], domains: [], people: [] });
    expect(s.databases[0].country).toBe("GLOBAL");
    expect(s.databases[0].layer).toBe("gold");
    expect(s.hubs.some((h) => h.name === "SOURCE")).toBe(true);
    expect(s.sourceHubInit).toBe(true);
    expect(Array.isArray(s.glossary)).toBe(true);
    expect(Array.isArray(s.lineage)).toBe(true);
  });
  it("labels remembered sources without leaking secrets", () => {
    expect(sourceLabel({ kind: "unity", host: "adb-1.azuredatabricks.net", catalog: "prod" })).toBe("Unity Catalog · adb-1.azuredatabricks.net / prod");
    expect(sourceLabel({ kind: "sqlalchemy", typeLabel: "PostgreSQL", host: "db", port: "5432", database: "x" })).toBe("PostgreSQL · db:5432/x");
    expect(sourceLabel({ kind: "sqlalchemy", url: "mysql+pymysql://u:secret@h/db" })).not.toContain("secret");
    expect(sourceLabel(null)).toBe("");
  });
  it("slugs data product names", () => {
    expect(slugName("Churn-List")).toBe("churnlist");
    expect(slugName("")).toBe("product");
  });
});
