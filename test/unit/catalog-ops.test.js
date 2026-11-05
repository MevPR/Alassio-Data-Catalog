import { describe, it, expect } from "vitest";
import { seed } from "../../src/lib/model.js";
import { makeLookups } from "../../src/lib/lookups.js";
import { buildSearchDocs, rankSearch } from "../../src/lib/search.js";
import { csvRows, csvRowsOf, CSV_COLUMNS } from "../../csv-export.js";
import { buildOkfBundle } from "../../okf.js";
import * as ops from "../../src/lib/catalog-ops.js";
import { mergeCsvRows } from "../../csv-import.js";
import { entriesForCreated, entriesForChanges, diffCatalogs } from "../../catalog-diff.js";

const doc = () => {
  const s = seed();
  s.hubs = [{ id: "h1", name: "Health", description: "", ownerId: null, stewardId: null, dataHubs: [{ name: "HEALTH_DE", description: "", bpoId: "p1" }] }];
  s.people = [{ id: "p1", name: "Anna Owner", email: "" }, { id: "p2", name: "Ben Steward", email: "" }];
  s.domains = [{ id: "dm1", name: "Claims", description: "", ownerId: "p1", stewardId: "p2" }];
  s.databases = [{ id: "d1", name: "GOLD", hubId: "h1", country: "HEALTH_DE", layer: "gold", domainId: "dm1", source: "manual" }, { id: "d2", name: "BRONZE", hubId: "h1", country: "HEALTH_DE", layer: "bronze", domainId: null, source: "manual" }];
  s.schemas = [{ id: "s1", databaseId: "d1", name: "claims_dp", description: "Claims data product" }, { id: "s2", databaseId: "d2", name: "raw", description: "" }];
  s.tables = [{ id: "t1", schemaId: "s1", name: "claim_fact", type: "TABLE", description: "Claims facts", businessDefinition: "One row per claim", stewardId: "p2", tags: "finance", kvTags: [{ key: "Project", value: "GenAI" }] },
    { id: "t2", schemaId: "s2", name: "claim_raw", type: "TABLE", description: "", businessDefinition: "", stewardId: null, tags: "" }];
  s.attributes = [{ id: "a1", tableId: "t1", name: "claim_id", dataType: "BIGINT", nullable: false, isPK: true, description: "Claim identifier", sensitivity: "Internal" },
    { id: "a2", tableId: "t1", name: "insured_name", dataType: "STRING", nullable: true, isPK: false, description: "", sensitivity: "PII", businessTerm: "Insured" },
    { id: "a3", tableId: "t2", name: "payload", dataType: "STRING", nullable: true, isPK: false, description: "", sensitivity: "Internal" }];
  s.lineage = [{ id: "e1", from: "t2", to: "t1", mappings: [] }];
  s.glossary = [];
  return s;
};

describe("lookups", () => {
  it("resolves layers, paths and data hubs", () => {
    const L = makeLookups(doc());
    expect(L.layerOf(L.table("t1"))).toBe("gold");
    expect(L.isDataProduct(L.schema("s1"))).toBe(true);
    expect(L.isDataProduct(L.schema("s2"))).toBe(false);
    expect(L.refLabel({ type: "attribute", id: "a2" })).toBe("GOLD.claims_dp.claim_fact.insured_name");
    expect(L.pathOf({ type: "table", id: "t1" }).map(([k]) => k)).toEqual(["hub", "country", "database", "schema", "table"]);
    expect(L.dataHubsOf(L.hub("h1")).map((x) => x.name)).toEqual(["HEALTH_DE"]);
    expect(L.upstreamOf("t1")).toHaveLength(1);
  });
  it("lists databases, schemas and tables alphabetically (natural order), attributes in column order", () => {
    const s = doc();
    s.tables.push({ id: "t10", schemaId: "s1", name: "table_10" }, { id: "t2", schemaId: "s1", name: "Table_2" }, { id: "ta", schemaId: "s1", name: "aardvark" });
    s.schemas.push({ id: "s0", databaseId: "d1", name: "Alpha" });
    const L = makeLookups(s);
    expect(L.tablesOf("s1").map((t) => t.name)).toEqual(["aardvark", "claim_fact", "Table_2", "table_10"]);
    expect(L.schemasOf("d1").map((x) => x.name)).toEqual(["Alpha", "claims_dp"]);
    expect(L.dbsOf("h1").map((x) => x.name)).toEqual(["BRONZE", "GOLD"]);
    expect(L.attrsOf("t1").map((a) => a.name)).toEqual(["claim_id", "insured_name"]);
  });
  it("uses server stats for attribute counts while lazy loading", () => {
    const L = makeLookups(doc(), { on: true, loaded: new Set(), stats: { perTable: { t1: 42 } } });
    expect(L.attrCount("t1")).toBe(42);
    expect(L.attrCount("t2")).toBe(0);
  });
});

describe("search", () => {
  it("ranks name matches above description matches and applies facets", () => {
    const s = doc(); const L = makeLookups(s);
    const docs = buildSearchDocs(s, L);
    const res = rankSearch(docs, "claim");
    expect(res.slice(0, 3).every((r) => r.name.toLowerCase().startsWith("claim"))).toBe(true);
    expect(res.some((r) => r.type === "attribute" && r.name === "claim_id")).toBe(true);
    expect(rankSearch(docs, "identifier").map((r) => [r.id, r.match.field])).toEqual([["a1", "description"]]);
    expect(rankSearch(docs, "claim", { type: "", hub: "", layer: "", sensitivity: "PII" })).toHaveLength(0);
    expect(rankSearch(docs, "insured", { type: "attribute", hub: "", layer: "", sensitivity: "" }).map((r) => r.name)).toEqual(["insured_name"]);
    expect(rankSearch(docs, "")).toEqual([]);
  });
  it("prefers the server ranking when it matches the query", () => {
    const s = doc(); const docs = buildSearchDocs(s, makeLookups(s));
    const res = rankSearch(docs, "claim", undefined, { q: "claim", order: new Map([["a1", 0], ["t1", 1]]) });
    expect(res.map((r) => r.id)).toEqual(["a1", "t1"]);
  });
});

describe("catalog ops", () => {
  it("deletes a schema with its tables, attributes and lineage", () => {
    const s = ops.removeEntity(doc(), "schema", "s2");
    expect(s.tables.map((t) => t.id)).toEqual(["t1"]);
    expect(s.attributes.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(s.lineage).toEqual([]);
  });
  it("removing a person clears every reference (incl. data hub BPO)", () => {
    const s = ops.removeEntity(doc(), "person", "p1");
    expect(s.domains[0].ownerId).toBeNull();
    expect(s.hubs[0].dataHubs[0].bpoId).toBeNull();
  });
  it("loads an external source into the SOURCE hub and remembers the connection", () => {
    const s = doc();
    ops.importExternal(s, { dbName: "claims", sourceType: "DuckDB", schemasPayload: [{ name: "main", tables: [{ name: "customer", columns: [{ name: "id", type_text: "INTEGER", nullable: false, isPK: true }] }] }], sourceRef: { kind: "duckdb", path: "/data/claims.duckdb" } });
    const hubS = s.hubs.find((h) => h.name === "SOURCE"); expect(hubS).toBeTruthy();
    const d = s.databases.find((x) => x.name === "claims"); expect(d.hubId).toBe(hubS.id); expect(d.layer).toBe("other"); expect(d.sourceRef.path).toBe("/data/claims.duckdb");
    const t = s.tables.find((x) => x.name === "customer"); expect(t.tags).toBe("duckdb");
    expect(s.attributes.find((a) => a.tableId === t.id).isPK).toBe(true);
  });
  it("imports a Unity catalog with lineage pairs and governance tags", () => {
    const s = doc();
    ops.importUnity(s, { catalogName: "uc", schemasPayload: [{ name: "a", tables: [{ name: "x", columns: [{ name: "c1", type_text: "INT" }] }, { name: "y", columns: [] }] }], hubId: "h1", lineagePairs: [["uc.a.x", "uc.a.y"]] });
    expect(s.lineage.some((e) => e.from && e.to)).toBe(true);
    ops.applyUnityTags(s, "uc", { catalogTags: { "Data Domain": "Sales", "Data Owner": "Dana Owner" }, tableTags: { "a.x": "Ben Steward" }, columnTags: { "a.x.c1": "PII" }, columnClass: { "a.x.c1": "c4" } });
    const d = s.databases.find((x) => x.name === "uc");
    expect(s.domains.find((dm) => dm.id === d.domainId).name).toBe("Sales");
    const at = s.attributes.find((a) => a.name === "c1"); expect(at.sensitivity).toBe("PII"); expect(at.classification).toBe("C4");
  });
  it("creates entities, links glossary terms, and edits keep ids", () => {
    const s = doc();
    const created = ops.saveEntity(s, { kind: "table", parentId: "s1" }, { name: "  new_tab ", type: "VIEW", description: "", businessTerm: "Premium" }, "t9");
    expect(created).toBe("Premium");
    expect(s.tables.find((t) => t.id === "t9").name).toBe("new_tab");
    expect(s.glossary[0].refs).toEqual([{ type: "table", id: "t9" }]);
    ops.saveEntity(s, { kind: "hub", edit: { id: "h1" } }, { id: "hacked", name: "Health 2", ownerId: "p1" });
    expect(s.hubs[0].id).toBe("h1"); expect(s.hubs[0].name).toBe("Health 2"); expect(s.hubs[0].stewardId).toBeNull();
    ops.saveEntity(s, { kind: "database", edit: { id: "d1" } }, { name: "GOLD", country: " health_de ", hubId: "h1" });
    expect(s.databases[0].country).toBe("health_de");
  });
  it("tags, data hubs and lineage mappings", () => {
    const s = doc();
    ops.addProjectTag(s, "table", "t2", " NextGen "); ops.addProjectTag(s, "table", "t2", "NextGen");
    expect(s.tables[1].kvTags).toEqual([{ key: "Project", value: "NextGen" }]);
    ops.removeProjectTag(s, "table", "t2", "NextGen"); expect(s.tables[1].kvTags).toEqual([]);
    ops.setKvTag(s, ["t1"], "Use Case", "Fraud"); ops.setKvTag(s, ["t1"], "Use Case", "Churn");
    expect(s.tables[0].kvTags.filter((k) => k.key === "Use Case")).toEqual([{ key: "Use Case", value: "Churn" }]);
    expect(ops.kvValuesOf(s, "Project")).toEqual(["GenAI"]);
    ops.saveDataHub(s, "h1", { name: "SALES_DE", description: "d", bpoId: "p1", leanixUrl: "https://x" }, "HEALTH_DE");
    expect(s.databases.every((d) => d.country === "SALES_DE")).toBe(true);
    ops.setDataHubBpo(s, "h1", "SALES_DE", "p2"); expect(s.hubs[0].dataHubs[0].bpoId).toBe("p2");
    expect(ops.addEdge(s, "t1", "t1")).toBe(false);
    ops.addEdgeMapping(s, "e1", "a3", "a1"); ops.addEdgeMapping(s, "e1", "a3", "a1");
    expect(s.lineage[0].mappings).toHaveLength(1);
    ops.removeEdgeMapping(s, "e1", s.lineage[0].mappings[0].id); expect(s.lineage[0].mappings).toEqual([]);
  });
  it("restores audit snapshots only when the parent exists", () => {
    const s = doc();
    expect(ops.restoreParentOk(s, { entityType: "attribute", action: "deleted", before: { id: "a9", tableId: "nope" } })).toBe(false);
    ops.restoreRecord(s, { entityType: "attribute", action: "deleted", before: { id: "a9", tableId: "t1", name: "back" } });
    expect(s.attributes.some((a) => a.id === "a9")).toBe(true);
  });
});

describe("csv export", () => {
  it("emits one row per attribute plus rows for empty containers, honouring a selection", async () => {
    const s = doc();
    const all = await csvRows(s);
    expect(all).toHaveLength(3);
    expect(all[0]).toMatchObject({ data_hub_type: "Health", data_hub: "HEALTH_DE", database: "GOLD", table: "claim_fact", attribute: "claim_id", primary_key: "true", project: "GenAI", layer: "gold", domain: "Claims", domain_owner: "Anna Owner" });
    const sel = await csvRows(s, { tableIds: ["t2"] });
    expect(sel.map((r) => r.database)).toEqual(["BRONZE"]);
    s.schemas.push({ id: "s3", databaseId: "d2", name: "empty", description: "" });
    expect(await csvRows(s, { tableIds: [], schemaIds: ["s3"] })).toEqual([expect.objectContaining({ schema: "empty", table: "", attribute: "" })]);
    expect(Object.keys(all[0]).every((k) => CSV_COLUMNS.includes(k))).toBe(true);
  });
  it("streams 100,000 attributes in linear time and the OKF builder emits files on the fly", async () => {
    const big = doc();
    for (let i = 0; i < 2000; i++) big.tables.push({ id: `bt${i}`, schemaId: i % 2 ? "s1" : "s2", name: `T${i}`, type: "TABLE" });
    for (let i = 0; i < 100000; i++) big.attributes.push({ id: `ba${i}`, tableId: `bt${i % 2000}`, name: `A${i}`, dataType: "STRING" });
    const t0 = Date.now();
    let n = 0; for await (const r of csvRowsOf(big)) { n++; if (r.attribute === "A5") expect(r.table).toBe("T5"); }
    expect(n).toBe(100003);
    let files = 0; const count = await buildOkfBundle(big, null, { version: "t" }, (path, content) => { files++; if (path.endsWith("/t5.md")) expect(content).toMatch(/\| A5 \|/); });
    expect(count).toBe(files); expect(files).toBeGreaterThan(2000);
    expect(Date.now() - t0).toBeLessThan(8000);
  });
});

describe("csv import merge (shared with the server)", () => {
  const rows = [{ data_hub_type: "Health", data_hub: "HEALTH_DE", database: "GOLD", schema: "claims_dp", table: "claim_fact", attribute: "new_col", data_type: "INT", nullable: "false", primary_key: "false", classification: "c2" },
    { data_hub_type: "Life", data_hub: "LIFE_PL", database: "SILVER", schema: "core", table: "policy", attribute: "policy_id", domain: "Policies", domain_owner: "Carl Owner" },
    { data_hub_type: "Life", data_hub: "LIFE_PL", database: "SILVER", schema: "core", table: "policy", attribute: "policy_id" }];
  it("merges rows into existing objects, creates missing ones, and is idempotent", () => {
    const s = doc();
    const { next, created, counts } = mergeCsvRows(s, rows);
    expect(counts).toMatchObject({ hubs: 1, databases: 1, schemas: 1, tables: 1, attributes: 2, domains: 1, people: 1, total: 8 });
    expect(next.attributes.find((a) => a.name === "new_col")).toMatchObject({ tableId: "t1", classification: "C2", nullable: false });
    expect(next.hubs.map((h) => h.name)).toEqual(["Health", "Life"]);
    expect(created.people[0].name).toBe("Carl Owner");
    expect(s.attributes).toHaveLength(3);                       // input untouched
    expect(next.lineage).toBe(s.lineage);                       // untouched collections are shared
    expect(mergeCsvRows(next, rows).counts.total).toBe(0);
  });
  it("handles 100,000 rows in linear time and yields audit entries without a full diff", () => {
    const big = [];
    for (let i = 0; i < 100000; i++) big.push({ data_hub_type: "Health", data_hub: "DE", database: `DB${i % 20}`, schema: `S${i % 200}`, table: `T${i % 5000}`, attribute: `A${i}`, data_type: "STRING" });
    const t0 = Date.now();
    const { next, created, counts } = mergeCsvRows(doc(), big);
    const entries = entriesForCreated(next, { id: "u", name: "u", email: "u@x" }, created);
    const ms = Date.now() - t0;
    expect(counts.attributes).toBe(100000);
    expect(entries.length).toBe(counts.total);
    expect(entries.find((e) => e.entityType === "attribute").context).toMatch(/^DB\d+\.S\d+\.T\d+$/);
    expect(ms).toBeLessThan(5000);
  });
  it("delta entries carry field changes and scope without cloning the catalog", () => {
    const s = doc();
    const after = { ...s.tables[0], description: "changed" };
    const entries = entriesForChanges({ ...s, tables: [after, s.tables[1]] }, { id: "u", name: "u", email: "u@x" }, [
      { entityType: "table", action: "updated", id: "t1", before: s.tables[0], after },
      { entityType: "table", action: "updated", id: "t2", before: s.tables[1], after: s.tables[1] },
      { entityType: "attribute", action: "deleted", id: "a3", before: s.attributes[2] },
    ]);
    expect(entries.map((e) => e.action)).toEqual(["updated", "deleted"]);
    expect(entries[0]).toMatchObject({ context: "GOLD.claims_dp", changes: [{ field: "description", from: "Claims facts", to: "changed" }] });
    expect(entries[0].scope).toEqual(["t1", "s1", "d1"]);
    const full = diffCatalogs(s, { ...s, tables: [after, s.tables[1]], attributes: s.attributes.slice(0, 2) }, { id: "u", name: "u", email: "u@x" });
    expect(full.map((e) => [e.action, e.entityId])).toEqual([["updated", "t1"], ["deleted", "a3"]]);
  });
});
