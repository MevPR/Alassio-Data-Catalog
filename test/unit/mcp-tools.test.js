/* v1.71 (code-quality review F-T3): every MCP tool's run() exercised over an in-memory catalog document — happy path and
   one readable error per tool. `mutate` mirrors the real one in miniature: it snapshots the audited collections, runs the
   tool's change function and records the change list (changesBetween) so the audit consequences of a tool can be
   asserted. Arguments pass through validateArgs first, exactly as handle() does, so schema-level rejections (bad enum,
   negative limit) are covered here as well. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildTools, validateArgs } from "../../mcp.js";
import { AUDIT_COLL, changesBetween } from "../../catalog-diff.js";
import { assertUniqueName, sameName, iso, tablePathById, closePeople } from "../../mcp/lookups.js";
import { findOrCreatePerson } from "../../src/lib/catalog-ops.js";

const doc = () => ({
  hubs: [
    { id: "h1", name: "Health", description: "Health hub", ownerId: null, stewardId: null, dataHubs: [] },
    { id: "h2", name: "P&C", description: "", ownerId: null, stewardId: null, dataHubs: [] },
    { id: "hs", name: "SOURCE", description: "", ownerId: null, stewardId: null, dataHubs: [] },
  ],
  people: [{ id: "p1", name: "Anna Owner", email: "anna@x.de" }, { id: "p2", name: "Ben Steward", email: "" }],
  domains: [{ id: "dm1", name: "Claims", description: "", ownerId: "p1", stewardId: "p2" }],
  databases: [
    { id: "d1", name: "GOLD", hubId: "h1", country: "HEALTH_DE", layer: "gold", domainId: "dm1", source: "manual", description: "Gold layer" },
    { id: "d2", name: "BRONZE", hubId: "h1", country: "GLOBAL", layer: "bronze", domainId: null, source: "manual", description: "" },
    { id: "d3", name: "uc_cat", hubId: "h2", country: "DE", layer: "silver", domainId: null, source: "unity", description: "" },
    { id: "d4", name: "pc_gold", hubId: "h2", country: "DE", layer: "gold", domainId: null, source: "manual", description: "" },
  ],
  schemas: [
    { id: "s1", databaseId: "d1", name: "claims_dp", description: "Claims data product" },
    { id: "s2", databaseId: "d2", name: "raw", description: "" },
    { id: "s3", databaseId: "d3", name: "uc", description: "" },
    { id: "s4", databaseId: "d4", name: "pc", description: "" },
  ],
  tables: [
    { id: "t1", schemaId: "s1", name: "claim_fact", type: "TABLE", description: "Claims facts", businessDefinition: "One row per claim", stewardId: "p2", ownerId: "p1", tags: "finance", reviewCycleDays: 90, lastReviewedAt: Date.now() - 100 * 864e5, lastReviewedBy: "Old Reviewer", lastReviewNote: "old note" },
    { id: "t2", schemaId: "s2", name: "claim_raw", type: "TABLE", description: "", businessDefinition: "", stewardId: null, tags: "" },
    { id: "t3", schemaId: "s3", name: "uc_table", type: "TABLE", description: "", businessDefinition: "", stewardId: null, tags: "unity-catalog" },
    { id: "t4", schemaId: "s4", name: "pc_fact", type: "TABLE", description: "", businessDefinition: "", stewardId: null, tags: "", certStatus: "deprecated", certifiedBy: "Someone", certifiedAt: 1, certNote: "use claim_fact", successorId: "t1" },
  ],
  attributes: [
    { id: "a1", tableId: "t1", name: "claim_id", dataType: "BIGINT", nullable: false, isPK: true, description: "Claim identifier", sensitivity: "Internal", classification: "C2" },
    { id: "a2", tableId: "t1", name: "insured_name", dataType: "STRING", nullable: true, isPK: false, description: "", sensitivity: "PII", businessTerm: "Insured" },
    { id: "a3", tableId: "t2", name: "payload", dataType: "STRING", nullable: true, isPK: false, description: "", sensitivity: "Internal" },
    { id: "a4", tableId: "t3", name: "uc_col", dataType: "STRING", nullable: true, isPK: false, description: "", sensitivity: "Internal" },
  ],
  lineage: [{ id: "e1", from: "t2", to: "t1", mappings: [{ id: "m1", from: "a3", to: "a2" }] }, { id: "e2", from: "t3", to: "t2" }],
  glossary: [{ id: "g1", name: "Insured", definition: "The insured person", refs: [{ type: "attribute", id: "a2" }, { type: "table", id: "t1" }], urls: [{ name: "wiki", url: "https://wiki.example/insured" }] }],
});

const STEWARD = { id: "u1", name: "Sam Steward", email: "sam@x.de", role: "steward", scope: "write" };
let cat, changes, user, tools;
const snapshot = (c) => Object.fromEntries(AUDIT_COLL.map(([, key]) => [key, structuredClone(c[key] || [])]));
const mutate = vi.fn(async (fn) => { const before = snapshot(cat); const msg = await fn(cat); changes = changesBetween(before, cat); return msg; });
const queryAudit = vi.fn(async (limit, query) => [{ limit, query }]);
const searchRows = vi.fn(async () => []);
const collab = {
  of: vi.fn(async () => ({ rating: { avg: 4, count: 2 }, usage: { views: 7 }, openQuestions: 1, comments: [{ id: "c1", kind: "question", by: { name: "Q" }, ts: 1, body: "why?", resolvedTs: null, replies: [{ id: "c2", by: { name: "A" }, ts: 2, body: "because" }] }] })),
  add: vi.fn(async (type, id, u, input) => ({ id: "c9", kind: input.kind, ts: 3 })),
  open: vi.fn(async (limit) => [{ id: "c1", entityType: "table", path: "GOLD.claims_dp.claim_fact", body: "why?", by: { name: "Q" }, ts: 1, limit }]),
  notifyQuestion: vi.fn(async () => {}),
};
const build = (over = {}) => buildTools({ readCatalog: async () => ({ catalog: cat, version: 1 }), mutate, queryAudit, searchRows, collab, currentUser: () => user,
  isPrivileged: (u) => ["admin", "steward"].includes(u.role), appVersion: () => "test", ...over });
const tool = (name) => { const t = tools.find((x) => x.name === name); if (!t) throw new Error(`no tool ${name}`); return t; };
/* like handle(): validate against the schema, then run */
const call = async (name, args = {}) => { const t = tool(name); const bad = validateArgs(t.inputSchema, args); if (bad) throw new Error(`Invalid params: ${bad}`); return t.run(args); };
const tb = (id) => cat.tables.find((t) => t.id === id);
const changed = (type, action) => changes.filter((ch) => ch.entityType === type && ch.action === action);

beforeEach(() => { cat = doc(); changes = null; user = { ...STEWARD }; tools = build(); vi.clearAllMocks(); });

describe("read tools", () => {
  it("get_overview counts the objects and data products", async () => {
    expect(await call("get_overview")).toEqual({ hubs: ["Health", "P&C", "SOURCE"], databases: 4, schemas: 4, tables: 4, attributes: 4, data_products: 2, lineage_links: 2 });
  });
  it("get_overview uses the server stats of a lazy document", async () => {
    cat.$stats = { attributes: 4242 };
    expect((await call("get_overview")).attributes).toBe(4242);
  });
  it("list_hubs lists hubs with database counts", async () => {
    expect(await call("list_hubs")).toEqual([{ name: "Health", description: "Health hub", databases: 2 }, { name: "P&C", description: "", databases: 2 }, { name: "SOURCE", description: "", databases: 0 }]);
  });
  it("list_databases filters by hub and country and rejects an unknown hub", async () => {
    expect((await call("list_databases")).map((d) => d.database)).toEqual(["GOLD", "BRONZE", "uc_cat", "pc_gold"]);
    expect((await call("list_databases", { hub: "health" })).map((d) => `${d.hub}/${d.database}`)).toEqual(["Health/GOLD", "Health/BRONZE"]);
    expect((await call("list_databases", { country: "DE" })).map((d) => d.database)).toEqual(["uc_cat", "pc_gold"]);
    expect((await call("list_databases", { hub: "Health" }))[0]).toMatchObject({ layer: "gold", source: "manual", description: "Gold layer", schemas: 1 });
    await expect(call("list_databases", { hub: "Nope" })).rejects.toThrow(/Data hub "Nope" not found\. Available: Health, P&C, SOURCE/);
  });
  it("list_schemas resolves hub/name, reports ambiguity and unknown databases", async () => {
    expect(await call("list_schemas", { database: "Health/GOLD" })).toEqual([{ path: "GOLD.claims_dp", description: "Claims data product", is_data_product: true, tables: 1 }]);
    expect(await call("list_schemas", { database: "bronze" })).toEqual([{ path: "BRONZE.raw", description: "", is_data_product: false, tables: 1 }]);
    cat.databases.push({ id: "d9", name: "gold", hubId: "h2", country: "DE", layer: "gold", source: "manual" });
    await expect(call("list_schemas", { database: "GOLD" })).rejects.toThrow(/ambiguous — qualify it as hub\/database: Health\/GOLD, P&C\/gold/);
    expect(await call("list_schemas", { database: "P&C/gold" })).toEqual([]);
    await expect(call("list_schemas", { database: "nope" })).rejects.toThrow(/Database "nope" not found/);
    await expect(call("list_schemas", {})).rejects.toThrow(/arguments\.database is required/);
  });
  it("list_tables works per schema or per database and needs one of them", async () => {
    expect(await call("list_tables", { schema: "Health/GOLD.claims_dp" })).toEqual([{ path: "GOLD.claims_dp.claim_fact", type: "TABLE", description: "Claims facts", attributes: 2 }]);
    expect((await call("list_tables", { database: "BRONZE" })).map((t) => t.path)).toEqual(["BRONZE.raw.claim_raw"]);
    await expect(call("list_tables", {})).rejects.toThrow(/Provide schema or database/);
    await expect(call("list_tables", { schema: "BRONZE.nope" })).rejects.toThrow(/Schema "BRONZE.nope" not found\. Schemas in BRONZE: raw/);
    await expect(call("list_tables", { schema: "BRONZE" })).rejects.toThrow(/Schema reference must be "database.schema"/);
  });
  it("get_table returns the full detail incl. attributes, lineage, stewardship and collaboration", async () => {
    const d = await call("get_table", { table: "BRONZE.raw.claim_raw" });
    expect(d).toMatchObject({ path: "BRONZE.raw.claim_raw", layer: "bronze", data_domain: null, steward: null, certification: { status: "none", by: null, successor: null }, review: { cycle_days: 0, status: "none" },
      attributes: [{ name: "payload", data_type: "STRING", nullable: true, is_pk: false, sensitivity: "Internal", classification: "" }],
      upstream: [{ table: "uc_cat.uc.uc_table", attribute_mappings: 0 }], downstream: [{ table: "GOLD.claims_dp.claim_fact", attribute_mappings: 1 }], rating: { avg: 4, count: 2 }, openQuestions: 1 });
    const g = await call("get_table", { table: "Health/GOLD.claims_dp.claim_fact" });
    expect(g).toMatchObject({ data_domain: "Claims", steward: "Ben Steward", owner: "Anna Owner", review: { cycle_days: 90, status: "overdue", last_reviewed_by: "Old Reviewer" } });
    expect(collab.of).toHaveBeenCalledWith("table", "t1");
    const dep = await call("get_table", { table: "P&C/pc_gold.pc.pc_fact" });
    expect(dep.certification).toMatchObject({ status: "deprecated", by: "Someone", note: "use claim_fact", successor: "GOLD.claims_dp.claim_fact" });
    await expect(call("get_table", { table: "BRONZE.raw.nope" })).rejects.toThrow(/Table "BRONZE.raw.nope" not found\. Tables in BRONZE.raw: claim_raw/);
    await expect(call("get_table", { table: "BRONZE.raw" })).rejects.toThrow(/Table reference must be "database.schema.table"/);
  });
  it("get_table loads attributes on demand on a lazy document", async () => {
    cat.$load = vi.fn(async () => {});
    await call("get_table", { table: "BRONZE.raw.claim_raw" });
    expect(cat.$load).toHaveBeenCalledWith(["t2"]);
  });
  it("list_data_products lists gold schemas with the domain's / hub's owner and steward", async () => {
    expect(await call("list_data_products")).toEqual([
      { path: "GOLD.claims_dp", hub: "Health", country: "HEALTH_DE", owner: "Anna Owner", steward: "Ben Steward", tables: 1 },
      { path: "pc_gold.pc", hub: "P&C", country: "DE", owner: null, steward: null, tables: 1 }]);
  });
  it("get_lineage walks the chain transitively and rejects an unknown table", async () => {
    expect(await call("get_lineage", { table: "GOLD.claims_dp.claim_fact" })).toEqual({ table: "GOLD.claims_dp.claim_fact", upstream_chain: ["BRONZE.raw.claim_raw", "uc_cat.uc.uc_table"], downstream_chain: [] });
    expect((await call("get_lineage", { table: "uc_cat.uc.uc_table" })).downstream_chain).toEqual(["BRONZE.raw.claim_raw", "GOLD.claims_dp.claim_fact"]);
    await expect(call("get_lineage", { table: "GOLD.claims_dp.x" })).rejects.toThrow(/Table "GOLD.claims_dp.x" not found/);
  });
  it("search_catalog scans the document, prefers server rows for long terms and reports no matches", async () => {
    expect(await call("search_catalog", { query: "claim" })).toEqual([{ type: "schema", path: "GOLD.claims_dp" }, { type: "table", path: "GOLD.claims_dp.claim_fact" }, { type: "table", path: "BRONZE.raw.claim_raw" }, { type: "attribute", path: "GOLD.claims_dp.claim_fact.claim_id" }]);
    expect(await call("search_catalog", { query: "claim", limit: 1 })).toHaveLength(1);
    expect(await call("search_catalog", { query: "zzz" })).toBe("No matches.");
    searchRows.mockResolvedValueOnce([{ type: "attribute", record: cat.attributes[2] }, { type: "schema", record: cat.schemas[1] }, { type: "hub", record: cat.hubs[0] }]);
    expect(await call("search_catalog", { query: "payload" })).toEqual([{ type: "attribute", path: "BRONZE.raw.claim_raw.payload" }, { type: "schema", path: "BRONZE.raw" }, { type: "hub", path: "Health" }]);
    expect(searchRows).toHaveBeenCalledWith("payload", 20);
    searchRows.mockClear();
    await call("search_catalog", { query: "ab" });   /* short terms never reach the server index */
    expect(searchRows).not.toHaveBeenCalled();
    await expect(call("search_catalog", {})).rejects.toThrow(/query is required/);
  });
  it("search_catalog does not scan attributes of a lazy document unless all are loaded (v1.73 F-M8: the scan silently saw an empty list)", async () => {
    cat.$load = vi.fn(async () => {});
    expect(await call("search_catalog", { query: "id" })).toBe("No matches.");   /* "claim_id" is an attribute only */
    expect(cat.$load).not.toHaveBeenCalled();   /* never loads 400k attributes for a scan */
    Object.defineProperty(cat, "$loaded", { value: new Set(["*"]) });
    expect(await call("search_catalog", { query: "id" })).toEqual([{ type: "attribute", path: "GOLD.claims_dp.claim_fact.claim_id" }]);
    expect(tool("search_catalog").description).toMatch(/shorter terms .* fall back to a scan of hubs, databases, schemas and tables only/);
  });
  it("get_audit is limited to 100 entries and to privileged callers", async () => {
    expect(await call("get_audit", {})).toEqual([{ limit: 25, query: null }]);
    expect(await call("get_audit", { limit: 100, query: "claim" })).toEqual([{ limit: 100, query: "claim" }]);
    user = { ...STEWARD, role: "guest" };
    await expect(call("get_audit", {})).rejects.toThrow(/get_audit needs the admin or steward role/);
  });
});

describe("numeric bounds (v1.71 F-M2)", () => {
  it("rejects negative or fractional limits and out-of-range day counts before the tool runs", async () => {
    await expect(call("get_audit", { limit: -5 })).rejects.toThrow(/arguments\.limit must be at least 1/);   /* used to reach SQL as LIMIT -5 */
    await expect(call("get_audit", { limit: 2.5 })).rejects.toThrow(/arguments\.limit must be an integer/);
    await expect(call("search_catalog", { query: "claim", limit: 0 })).rejects.toThrow(/must be at least 1/);
    await expect(call("list_open_questions", { limit: -1 })).rejects.toThrow(/must be at least 1/);
    await expect(call("review_table", { table: "BRONZE.raw.claim_raw", cycle_days: -30 })).rejects.toThrow(/arguments\.cycle_days must be at least 0/);
    await expect(call("list_stewardship_tasks", { attest_days: 0 })).rejects.toThrow(/arguments\.attest_days must be at least 1/);
    expect(queryAudit).not.toHaveBeenCalled();
    await expect(call("get_audit", { limit: 500 })).rejects.toThrow(/arguments\.limit must be at most 100/);   /* v1.74 (F-M3): rejected, no longer clamped */
  });
});

describe("unique names on create and rename (v1.71 F-M3)", () => {
  it("assertUniqueName compares case-insensitively within the given siblings and skips the renamed record", () => {
    const list = [{ id: "1", name: "Alpha" }, { id: "2", name: "beta" }];
    expect(() => assertUniqueName(list, "ALPHA", { label: "Hub" })).toThrow('Hub "ALPHA" already exists');
    expect(() => assertUniqueName(list, "Beta", { label: "Schema", where: "in GOLD" })).toThrow('Schema "Beta" already exists in GOLD');
    expect(() => assertUniqueName(list, "alpha", { exceptId: "1" })).not.toThrow();   /* a case-only rename of itself */
    expect(() => assertUniqueName(list, "gamma")).not.toThrow();
    expect(() => assertUniqueName(undefined, "x")).not.toThrow();
  });
  /* each of these renames used to succeed and leave two siblings with the same name (findDb then reported "ambiguous") */
  it("update_hub refuses a rename onto another hub's name", async () => {
    await expect(call("update_hub", { hub: "Health", new_name: "p&c" })).rejects.toThrow('Hub "p&c" already exists');
    expect(await call("update_hub", { hub: "Health", new_name: "HEALTH" })).toBe("Hub updated: HEALTH.");
  });
  it("update_database refuses a rename or a move onto a sibling's name in the target hub", async () => {
    await expect(call("update_database", { database: "BRONZE", new_name: "gold" })).rejects.toThrow('Database "gold" already exists in hub Health');
    cat.databases.push({ id: "d9", name: "BRONZE", hubId: "h2", country: "DE", layer: "bronze", source: "manual" });
    await expect(call("update_database", { database: "Health/BRONZE", hub: "P&C" })).rejects.toThrow('Database "BRONZE" already exists in hub P&C');
    await expect(call("update_database", { database: "Health/BRONZE", new_name: "uc_cat", hub: "P&C" })).rejects.toThrow('Database "uc_cat" already exists in hub P&C');
    expect(await call("update_database", { database: "Health/BRONZE", new_name: "pc_gold" })).toBe("Database updated: pc_gold.");   /* same name in another hub is fine */
    expect(cat.databases[1].hubId).toBe("h1");
  });
  it("update_schema refuses a rename onto a sibling schema", async () => {
    cat.schemas.push({ id: "s9", databaseId: "d2", name: "stage" });
    await expect(call("update_schema", { schema: "BRONZE.raw", new_name: "STAGE" })).rejects.toThrow('Schema "STAGE" already exists in BRONZE');
  });
  it("update_attribute refuses a rename onto a sibling column", async () => {
    await expect(call("update_attribute", { attribute: "GOLD.claims_dp.claim_fact.claim_id", new_name: "Insured_Name" })).rejects.toThrow('Attribute "Insured_Name" already exists on GOLD.claims_dp.claim_fact');
    expect(await call("update_attribute", { attribute: "GOLD.claims_dp.claim_fact.claim_id", new_name: "payload" })).toBe("Attribute updated: payload.");   /* other tables do not count */
  });
  it("update_glossary_term refuses a rename onto another term", async () => {
    cat.glossary.push({ id: "g2", name: "Claim", definition: "", refs: [], urls: [] });
    await expect(call("update_glossary_term", { term: "Claim", new_name: "insured" })).rejects.toThrow('Glossary term "insured" already exists');
  });
});

describe("hub tools", () => {
  it("create_hub adds a hub and rejects duplicates (case-insensitive)", async () => {
    expect(await call("create_hub", { name: "Life", description: "Life hub" })).toBe('Hub "Life" created.');
    expect(cat.hubs.at(-1)).toMatchObject({ name: "Life", description: "Life hub", ownerId: null, dataHubs: [] });
    expect(changed("hub", "created")).toHaveLength(1);
    await expect(call("create_hub", { name: "health" })).rejects.toThrow(/Hub "health" already exists/);
  });
  it("update_hub renames and re-describes; unknown hub is readable", async () => {
    expect(await call("update_hub", { hub: "Health", new_name: "Health DE", description: "x" })).toBe("Hub updated: Health DE.");
    expect(changed("hub", "updated")).toHaveLength(1);
    await expect(call("update_hub", { hub: "Nope" })).rejects.toThrow(/Data hub "Nope" not found/);
  });
  it("delete_hub deletes an empty hub and guards the non-empty and the last one", async () => {
    expect(await call("delete_hub", { hub: "SOURCE" })).toBe('Hub "SOURCE" deleted.');
    expect(changed("hub", "deleted")).toHaveLength(1);
    await expect(call("delete_hub", { hub: "Health" })).rejects.toThrow(/still contains databases/);
    cat.databases = []; cat.hubs = [cat.hubs[0]];
    await expect(call("delete_hub", { hub: "Health" })).rejects.toThrow(/The last hub cannot be deleted/);
  });
});

describe("database tools", () => {
  it("create_database guesses the layer, normalises the country and rejects duplicates per hub", async () => {
    expect(await call("create_database", { name: "silver_dwh", hub: "Health" })).toBe('Database "silver_dwh" created in hub Health.');
    expect(cat.databases.at(-1)).toMatchObject({ layer: "silver", country: "GLOBAL", source: "manual", hubId: "h1" });
    await call("create_database", { name: "x", hub: "Health", layer: "gold", country: "  Health  DE " });
    expect(cat.databases.at(-1)).toMatchObject({ layer: "gold", country: "Health DE" });
    await call("create_database", { name: "src", hub: "SOURCE", layer: "gold" });
    expect(cat.databases.at(-1).layer).toBe("other");   /* the SOURCE hub has no medallion layer */
    await expect(call("create_database", { name: "gold", hub: "Health" })).rejects.toThrow(/Database "gold" already exists in hub Health/);
    expect(await call("create_database", { name: "uc_cat", hub: "Health" })).toMatch(/created/);   /* same name in another hub is fine */
  });
  it("v1.74 (F-M2): the layer guess is the UI's — raw/landing/stg/mart names classify like in the catalog", async () => {
    for (const [name, layer] of [["raw_claims", "bronze"], ["landing_zone", "bronze"], ["stg_policy", "silver"], ["claims_mart", "gold"], ["misc", "other"]]) {
      await call("create_database", { name, hub: "Health" });
      expect(cat.databases.at(-1).layer, name).toBe(layer);
    }
  });
  it("create_database rejects an unknown layer like update_database (v1.71 F-M2: it used to guess one silently)", async () => {
    await expect(call("create_database", { name: "bronze_x", hub: "Health", layer: "platinum" })).rejects.toThrow(/arguments\.layer must be one of bronze, silver, gold, other/);
    expect(cat.databases.map((d) => d.name)).not.toContain("bronze_x");
  });
  it("update_database renames, moves, re-layers and rejects a bad layer", async () => {
    expect(await call("update_database", { database: "BRONZE", new_name: "BRONZE2", hub: "P&C", country: "AT", layer: "silver", description: "d" })).toBe("Database updated: BRONZE2.");
    expect(cat.databases[1]).toMatchObject({ name: "BRONZE2", hubId: "h2", country: "AT", layer: "silver", description: "d" });
    await expect(call("update_database", { database: "BRONZE2", layer: "platinum" })).rejects.toThrow(/arguments\.layer must be one of bronze, silver, gold, other/);   /* v1.71: schema error (was a hand-rolled check, same wording) */
    await call("update_database", { database: "BRONZE2", hub: "SOURCE" });
    expect(cat.databases[1].layer).toBe("other");
    await expect(call("update_database", { database: "nope" })).rejects.toThrow(/Database "nope" not found/);
  });
  it("delete_database cascades over schemas, tables, attributes and lineage", async () => {
    expect(await call("delete_database", { database: "BRONZE" })).toBe('Database "BRONZE" deleted (1 schemas, 1 tables).');
    expect(cat.databases.map((d) => d.id)).toEqual(["d1", "d3", "d4"]);
    expect(cat.schemas.map((s) => s.id)).toEqual(["s1", "s3", "s4"]);
    expect(cat.tables.map((t) => t.id)).toEqual(["t1", "t3", "t4"]);
    expect(cat.attributes.map((a) => a.id)).toEqual(["a1", "a2", "a4"]);
    expect(cat.lineage).toEqual([]);
    expect(changes.map((ch) => `${ch.entityType}:${ch.action}`).sort()).toEqual(["attribute:deleted", "database:deleted", "lineage:deleted", "lineage:deleted", "schema:deleted", "table:deleted"]);
    cat.databases.push({ id: "d9", name: "gold", hubId: "h2", country: "DE", layer: "gold", source: "manual" });
    await expect(call("delete_database", { database: "GOLD" })).rejects.toThrow(/ambiguous/);
  });
});

describe("schema tools", () => {
  it("create_schema adds a schema and rejects duplicates within the database", async () => {
    expect(await call("create_schema", { database: "BRONZE", name: "stage" })).toBe('Schema "BRONZE.stage" created.');
    expect(cat.schemas.at(-1)).toMatchObject({ databaseId: "d2", name: "stage", description: "" });
    await expect(call("create_schema", { database: "BRONZE", name: "RAW" })).rejects.toThrow(/Schema "RAW" already exists in BRONZE/);
    await expect(call("create_schema", { database: "nope", name: "x" })).rejects.toThrow(/Database "nope" not found/);
  });
  it("update_schema renames and re-describes", async () => {
    expect(await call("update_schema", { schema: "BRONZE.raw", new_name: "raw2", description: "d" })).toBe("Schema updated: BRONZE.raw2.");
    expect(changed("schema", "updated")[0].after).toMatchObject({ name: "raw2", description: "d" });
    await expect(call("update_schema", { schema: "BRONZE.nope" })).rejects.toThrow(/Schema "BRONZE.nope" not found/);
  });
  it("delete_schema cascades over tables, attributes and lineage", async () => {
    expect(await call("delete_schema", { schema: "BRONZE.raw" })).toBe('Schema "BRONZE.raw" deleted (1 tables).');
    expect(cat.schemas.map((s) => s.id)).toEqual(["s1", "s3", "s4"]);
    expect(cat.tables.map((t) => t.id)).toEqual(["t1", "t3", "t4"]);
    expect(cat.attributes.map((a) => a.id)).toEqual(["a1", "a2", "a4"]);
    expect(cat.lineage).toEqual([]);
    expect(changed("schema", "deleted")).toHaveLength(1);
    await expect(call("delete_schema", { schema: "nope.raw" })).rejects.toThrow(/Database "nope" not found/);
  });
});

describe("table tools", () => {
  it("create_table finds-or-creates steward and owner and rejects duplicates within the schema", async () => {
    expect(await call("create_table", { schema: "BRONZE.raw", name: "events", steward: "ben steward", owner: "New Owner", tags: "t", business_definition: "b" })).toBe('Table "BRONZE.raw.events" created.');
    const t = cat.tables.at(-1);
    expect(t).toMatchObject({ schemaId: "s2", name: "events", type: "TABLE", stewardId: "p2", tags: "t", businessDefinition: "b" });
    expect(cat.people.find((p) => p.id === t.ownerId).name).toBe("New Owner");
    expect(changed("person", "created")).toHaveLength(1);
    await expect(call("create_table", { schema: "BRONZE.raw", name: "CLAIM_RAW" })).rejects.toThrow(/Table "CLAIM_RAW" already exists in BRONZE.raw/);
  });
  it("update_table renames with a collision check and updates the other fields", async () => {
    expect(await call("update_table", { table: "GOLD.claims_dp.claim_fact", new_name: "claim_fact_v2", description: "d", business_definition: "b", steward: "Anna Owner", owner: "Ben Steward", tags: "x" })).toBe("Table updated: GOLD.claims_dp.claim_fact_v2.");
    expect(tb("t1")).toMatchObject({ name: "claim_fact_v2", description: "d", businessDefinition: "b", stewardId: "p1", ownerId: "p2", tags: "x" });
    cat.tables.push({ id: "t9", schemaId: "s1", name: "other", type: "TABLE" });
    await expect(call("update_table", { table: "GOLD.claims_dp.claim_fact_v2", new_name: "OTHER" })).rejects.toThrow('Table "OTHER" already exists in GOLD.claims_dp');   /* v1.71 (F-M3): was 'A table named "OTHER" already exists in …' */
    await expect(call("update_table", { table: "GOLD.claims_dp.nope" })).rejects.toThrow(/Table "GOLD.claims_dp.nope" not found/);
  });
  it("update_table rejects an unknown steward/owner with close matches instead of creating a ghost person (v1.73 F-M6)", async () => {
    const people = cat.people.length;
    await expect(call("update_table", { table: "GOLD.claims_dp.claim_fact", steward: "Anna Ownr", description: "changed" }))
      .rejects.toThrow('Steward "Anna Ownr" is not a known person — did you mean: Anna Owner? Pass create_person: true to create a new person with this name.');
    await expect(call("update_table", { table: "GOLD.claims_dp.claim_fact", owner: "Zoe Q" })).rejects.toThrow('Owner "Zoe Q" is not a known person. Pass create_person: true');
    expect(cat.people).toHaveLength(people);
    expect(tb("t1")).toMatchObject({ stewardId: "p2", ownerId: "p1", description: "Claims facts" });   /* rejected before any change */
    expect(await call("update_table", { table: "GOLD.claims_dp.claim_fact", steward: "anna owner" })).toBe("Table updated: GOLD.claims_dp.claim_fact.");
    expect(tb("t1").stewardId).toBe("p1");   /* existing names still match case-insensitively */
    await call("update_table", { table: "GOLD.claims_dp.claim_fact", steward: "Anna Ownr", create_person: true });
    expect(cat.people.find((p) => p.id === tb("t1").stewardId).name).toBe("Anna Ownr");
    expect(changed("person", "created")).toHaveLength(1);
    await call("update_table", { table: "GOLD.claims_dp.claim_fact", steward: "", owner: "" });
    expect(tb("t1")).toMatchObject({ stewardId: null, ownerId: null });   /* "" still clears */
    await expect(call("update_table", { table: "GOLD.claims_dp.claim_fact", create_person: "yes" })).rejects.toThrow(/create_person must be true or false/);
  });
  it("delete_table removes the table with its attributes and lineage", async () => {
    expect(await call("delete_table", { table: "BRONZE.raw.claim_raw" })).toBe('Table "BRONZE.raw.claim_raw" deleted.');
    expect(cat.tables.map((t) => t.id)).toEqual(["t1", "t3", "t4"]);
    expect(cat.attributes.map((a) => a.id)).toEqual(["a1", "a2", "a4"]);
    expect(cat.lineage).toEqual([]);
    expect(changes.map((ch) => `${ch.entityType}:${ch.action}`).sort()).toEqual(["attribute:deleted", "lineage:deleted", "lineage:deleted", "table:deleted"]);
    await expect(call("delete_table", { table: "BRONZE.raw.nope" })).rejects.toThrow(/not found/);
  });
});

describe("stewardship tools", () => {
  it("certify_table endorses (counts as a review), deprecates with a successor and removes a certification", async () => {
    const before = Date.now();
    expect(await call("certify_table", { table: "BRONZE.raw.claim_raw", status: "endorsed", note: "ok" })).toBe("Table BRONZE.raw.claim_raw endorsed.");
    expect(tb("t2")).toMatchObject({ certStatus: "endorsed", certifiedBy: "Sam Steward", certNote: "ok", lastReviewedBy: "Sam Steward" });
    expect(tb("t2").certifiedAt).toBeGreaterThanOrEqual(before);
    expect(tb("t2").lastReviewedAt).toBe(tb("t2").certifiedAt);   /* v1.71 (F-M1): catalog-ops stamps both with one `now` (was two Date.now() calls) */
    expect(tb("t2").successorId).toBeUndefined();
    expect(changed("table", "updated")[0].after.certStatus).toBe("endorsed");
    expect(await call("certify_table", { table: "BRONZE.raw.claim_raw", status: "deprecated", successor: "GOLD.claims_dp.claim_fact" })).toBe("Table BRONZE.raw.claim_raw deprecated (successor GOLD.claims_dp.claim_fact).");
    expect(tb("t2")).toMatchObject({ certStatus: "deprecated", successorId: "t1", certNote: "" });
    expect(await call("certify_table", { table: "BRONZE.raw.claim_raw", status: "none" })).toBe("Certification removed from BRONZE.raw.claim_raw.");
    expect(Object.keys(tb("t2")).filter((k) => /^cert|successor/.test(k))).toEqual([]);
  });
  it("certify_table rejects a bad status and an unknown successor", async () => {
    await expect(call("certify_table", { table: "BRONZE.raw.claim_raw", status: "gold" })).rejects.toThrow(/arguments\.status must be one of endorsed, deprecated, none/);
    /* v1.71 (F-M2): the enum is exact — "Endorsed" used to be lower-cased and accepted */
    await expect(call("certify_table", { table: "BRONZE.raw.claim_raw", status: "Endorsed" })).rejects.toThrow(/must be one of/);
    await expect(call("certify_table", { table: "BRONZE.raw.claim_raw", status: "deprecated", successor: "GOLD.claims_dp.nope" })).rejects.toThrow(/Table "GOLD.claims_dp.nope" not found/);
    await expect(call("certify_table", { table: "BRONZE.raw.claim_raw", status: "deprecated", successor: "BRONZE.raw.claim_raw" })).rejects.toThrow(/a table cannot be its own successor/);
  });
  it("certify_table ignores a successor unless deprecating (v1.71 F-M1: was a self-successor error for every status; catalog-ops rules win)", async () => {
    expect(await call("certify_table", { table: "BRONZE.raw.claim_raw", status: "endorsed", successor: "BRONZE.raw.claim_raw" })).toBe("Table BRONZE.raw.claim_raw endorsed.");
    expect(tb("t2").successorId).toBeUndefined();
    /* the answer names a successor only when one was actually set (it used to echo an ignored one) */
    expect(await call("certify_table", { table: "BRONZE.raw.claim_raw", status: "endorsed", successor: "GOLD.claims_dp.claim_fact" })).toBe("Table BRONZE.raw.claim_raw endorsed.");
  });
  it("certify_table records name ‖ email of the caller (v1.71 F-M1: was the name only — undefined for a nameless caller)", async () => {
    user = { email: "key@agents.local", role: "agent" };
    await call("certify_table", { table: "BRONZE.raw.claim_raw", status: "endorsed" });
    expect(tb("t2")).toMatchObject({ certifiedBy: "key@agents.local", lastReviewedBy: "key@agents.local" });
    await call("review_table", { table: "GOLD.claims_dp.claim_fact" });
    expect(tb("t1").lastReviewedBy).toBe("key@agents.local");
  });
  it("review_table marks reviewed, sets the cycle and reports the status", async () => {
    expect(await call("review_table", { table: "BRONZE.raw.claim_raw", cycle_days: 180, note: "fine" })).toBe("Table BRONZE.raw.claim_raw: reviewed, review cycle 180 days (status ok).");
    expect(tb("t2")).toMatchObject({ reviewCycleDays: 180, lastReviewedBy: "Sam Steward", lastReviewNote: "fine" });
    expect(await call("review_table", { table: "BRONZE.raw.claim_raw", reviewed: false, cycle_days: 0 })).toBe("Table BRONZE.raw.claim_raw: unchanged, review cycle 0 days (status none).");
    expect(tb("t2").reviewCycleDays).toBeUndefined();
    await expect(call("review_table", { table: "BRONZE.raw.claim_raw", cycle_days: 99999 })).rejects.toThrow(/cycle_days must be at most 3650/);   /* v1.74: rejected, not clamped */
    await expect(call("review_table", { table: "BRONZE.raw.nope" })).rejects.toThrow(/not found/);
  });
  it("review_table clears the old note when none is given (v1.71 F-M1: the note belongs to the review — was kept)", async () => {
    await call("review_table", { table: "GOLD.claims_dp.claim_fact" });
    expect(tb("t1").lastReviewedBy).toBe("Sam Steward");
    expect(tb("t1").lastReviewNote).toBeUndefined();
    expect(changed("table", "updated")[0].before.lastReviewNote).toBe("old note");   /* the audit diff carries the removal */
    await call("review_table", { table: "GOLD.claims_dp.claim_fact", reviewed: false, cycle_days: 30 });
    expect(tb("t1").lastReviewedBy).toBe("Sam Steward");   /* reviewed:false leaves the review untouched */
  });
  it("list_stewardship_tasks reports due reviews, deprecations and overdue attestations", async () => {
    const r = await call("list_stewardship_tasks", {});
    expect(r.reviews_due).toEqual([{ table: "GOLD.claims_dp.claim_fact", status: "overdue", next_review_at: expect.any(String), last_reviewed_by: "Old Reviewer" }]);
    expect(r.deprecated).toEqual([{ table: "pc_gold.pc.pc_fact", successor: "GOLD.claims_dp.claim_fact", note: "use claim_fact" }]);
    expect(r.attestations_due.map((x) => `${x.kind}:${x.name}:${x.owner}`)).toEqual(["table:GOLD.claims_dp.claim_fact:Anna Owner", "domain:Claims:Anna Owner"]);
    tb("t1").ownerAttestedAt = Date.now() - 10 * 864e5;
    expect((await call("list_stewardship_tasks", { attest_days: 30 })).attestations_due.map((x) => x.kind)).toEqual(["domain"]);
    expect((await call("list_stewardship_tasks", { attest_days: 5 })).attestations_due.map((x) => x.kind)).toEqual(["table", "domain"]);
  });
});

describe("collaboration tools", () => {
  it("are absent without a collab backend", () => {
    const names = build({ collab: null }).map((t) => t.name);
    expect(names).not.toContain("add_comment"); expect(names).not.toContain("get_discussion"); expect(names).not.toContain("list_open_questions");
  });
  it("list_open_questions maps the open questions", async () => {
    expect(await call("list_open_questions", { limit: 5 })).toEqual([{ id: "c1", type: "table", path: "GOLD.claims_dp.claim_fact", question: "why?", asked_by: "Q", asked_at: new Date(1).toISOString() }]);
    expect(collab.open).toHaveBeenCalledWith(5);
    await call("list_open_questions", {});
    expect(collab.open).toHaveBeenLastCalledWith(50);
  });
  it("get_discussion returns threads with replies and rejects an unknown table", async () => {
    const d = await call("get_discussion", { table: "GOLD.claims_dp.claim_fact" });
    expect(d).toMatchObject({ rating: { avg: 4 }, usage: { views: 7 }, threads: [{ id: "c1", kind: "question", by: "Q", body: "why?", resolved: false, replies: [{ id: "c2", by: "A", body: "because" }] }] });
    await expect(call("get_discussion", { table: "GOLD.claims_dp.nope" })).rejects.toThrow(/not found/);
  });
  it("add_comment posts under the caller's identity, defaults the kind and notifies on questions", async () => {
    expect(await call("add_comment", { table: "GOLD.claims_dp.claim_fact", body: "hi" })).toEqual({ id: "c9", kind: "comment", table: "GOLD.claims_dp.claim_fact", posted_at: new Date(3).toISOString() });
    expect(collab.add).toHaveBeenCalledWith("table", "t1", user, { body: "hi", kind: "comment", parentId: null });
    await call("add_comment", { table: "GOLD.claims_dp.claim_fact", body: "re", reply_to: "c1" });
    expect(collab.add).toHaveBeenLastCalledWith("table", "t1", user, { body: "re", kind: "answer", parentId: "c1" });
    await call("add_comment", { table: "GOLD.claims_dp.claim_fact", body: "?", kind: "question" });
    expect(collab.notifyQuestion).toHaveBeenCalledTimes(1);
    expect(mutate).not.toHaveBeenCalled();   /* comments live in their own tables, not in the catalog document */
    await expect(call("add_comment", { table: "GOLD.claims_dp.nope", body: "x" })).rejects.toThrow(/not found/);
    expect(collab.add).toHaveBeenCalledTimes(3);
  });
});

describe("attribute tools", () => {
  it("create_attribute defaults the optional fields, normalises the classification and rejects duplicates", async () => {
    expect(await call("create_attribute", { table: "BRONZE.raw.claim_raw", name: "amount" })).toBe('Attribute "BRONZE.raw.claim_raw.amount" created.');
    expect(cat.attributes.at(-1)).toMatchObject({ tableId: "t2", name: "amount", dataType: "STRING", nullable: true, isPK: false, sensitivity: "Internal", classification: "", description: "", businessTerm: "" });
    await call("create_attribute", { table: "BRONZE.raw.claim_raw", name: "id", data_type: "BIGINT", nullable: false, is_pk: true, sensitivity: "Confidential", classification: "C3", description: "d", business_term: "b" });
    expect(cat.attributes.at(-1)).toMatchObject({ dataType: "BIGINT", nullable: false, isPK: true, sensitivity: "Confidential", classification: "C3", description: "d", businessTerm: "b" });
    expect(changed("attribute", "created")).toHaveLength(1);
    await expect(call("create_attribute", { table: "BRONZE.raw.claim_raw", name: "PAYLOAD" })).rejects.toThrow(/Attribute "PAYLOAD" already exists on BRONZE.raw.claim_raw/);
  });
  it("create_attribute rejects an unknown classification like update_attribute (v1.71 F-M2: it used to drop it silently; lower case is no longer upper-cased)", async () => {
    await expect(call("create_attribute", { table: "BRONZE.raw.claim_raw", name: "x", classification: "C9" })).rejects.toThrow(/arguments\.classification must be one of C1, C2, C3, C4/);
    await expect(call("create_attribute", { table: "BRONZE.raw.claim_raw", name: "x", classification: "c3" })).rejects.toThrow(/must be one of C1, C2, C3, C4/);
    expect(cat.attributes.map((a) => a.name)).not.toContain("x");
  });
  it("create_attribute loads the table's attributes before the duplicate check on a lazy document", async () => {
    cat.$load = vi.fn(async () => {});
    await call("create_attribute", { table: "BRONZE.raw.claim_raw", name: "x" });
    expect(cat.$load).toHaveBeenCalledWith(["t2"]);
  });
  it("update_attribute changes every field, clears or rejects the classification", async () => {
    expect(await call("update_attribute", { attribute: "GOLD.claims_dp.claim_fact.claim_id", new_name: "claim_no", data_type: "STRING", nullable: true, is_pk: false, sensitivity: "Public", classification: "C4", description: "d", business_term: "b" })).toBe("Attribute updated: claim_no.");
    expect(cat.attributes[0]).toMatchObject({ name: "claim_no", dataType: "STRING", nullable: true, isPK: false, sensitivity: "Public", classification: "C4", description: "d", businessTerm: "b" });
    await call("update_attribute", { attribute: "GOLD.claims_dp.claim_fact.claim_no", classification: "" });
    expect(cat.attributes[0].classification).toBe("");
    await expect(call("update_attribute", { attribute: "GOLD.claims_dp.claim_fact.claim_no", classification: "C9" })).rejects.toThrow(/arguments\.classification must be one of C1, C2, C3, C4, $/);   /* v1.71: schema error (was "classification must be C1, C2, C3 or C4") */
    await expect(call("update_attribute", { attribute: "GOLD.claims_dp.claim_fact.nope" })).rejects.toThrow(/Attribute "GOLD.claims_dp.claim_fact.nope" not found\. Attributes of claim_fact: claim_no, insured_name/);
    await expect(call("update_attribute", { attribute: "GOLD.claims_dp.claim_fact" })).rejects.toThrow(/Attribute reference must be "database.schema.table.attribute"/);
  });
  it("delete_attribute removes the attribute", async () => {
    expect(await call("delete_attribute", { attribute: "BRONZE.raw.claim_raw.payload" })).toBe('Attribute "payload" deleted from claim_raw.');
    expect(cat.attributes.map((a) => a.id)).toEqual(["a1", "a2", "a4"]);
    expect(changed("attribute", "deleted")).toHaveLength(1);
    await expect(call("delete_attribute", { attribute: "BRONZE.raw.claim_raw.payload" })).rejects.toThrow(/not found/);
  });
});

describe("lineage tools", () => {
  it("add_lineage links two tables and rejects self links, duplicates and Unity tables", async () => {
    expect(await call("add_lineage", { from_table: "GOLD.claims_dp.claim_fact", to_table: "pc_gold.pc.pc_fact" })).toBe("Lineage link added: GOLD.claims_dp.claim_fact → pc_gold.pc.pc_fact.");
    expect(cat.lineage.at(-1)).toMatchObject({ from: "t1", to: "t4" });
    expect(changed("lineage", "created")).toHaveLength(1);
    await expect(call("add_lineage", { from_table: "GOLD.claims_dp.claim_fact", to_table: "pc_gold.pc.pc_fact" })).rejects.toThrow(/This lineage link already exists/);
    await expect(call("add_lineage", { from_table: "pc_gold.pc.pc_fact", to_table: "pc_gold.pc.pc_fact" })).rejects.toThrow(/from_table and to_table must differ/);
    await expect(call("add_lineage", { from_table: "uc_cat.uc.uc_table", to_table: "pc_gold.pc.pc_fact" })).rejects.toThrow(/Unity-Catalog-imported tables is managed in Databricks/);
  });
  it("remove_lineage removes a link and reports a missing one", async () => {
    expect(await call("remove_lineage", { from_table: "BRONZE.raw.claim_raw", to_table: "GOLD.claims_dp.claim_fact" })).toBe("Lineage link removed: BRONZE.raw.claim_raw → GOLD.claims_dp.claim_fact.");
    expect(cat.lineage.map((e) => e.id)).toEqual(["e2"]);
    await expect(call("remove_lineage", { from_table: "BRONZE.raw.claim_raw", to_table: "GOLD.claims_dp.claim_fact" })).rejects.toThrow(/No such lineage link/);
    await expect(call("remove_lineage", { from_table: "uc_cat.uc.uc_table", to_table: "BRONZE.raw.claim_raw" })).rejects.toThrow(/Unity-Catalog/);
  });
  it("map_lineage_attributes maps a column pair on an existing link", async () => {
    expect(await call("map_lineage_attributes", { from_table: "BRONZE.raw.claim_raw", to_table: "GOLD.claims_dp.claim_fact", from_attribute: "PAYLOAD", to_attribute: "claim_id" })).toBe("Mapped BRONZE.raw.claim_raw.payload → GOLD.claims_dp.claim_fact.claim_id.");
    expect(cat.lineage[0].mappings.map((m) => `${m.from}>${m.to}`)).toEqual(["a3>a2", "a3>a1"]);
    expect(changed("lineage", "updated")).toHaveLength(1);
    await expect(call("map_lineage_attributes", { from_table: "BRONZE.raw.claim_raw", to_table: "GOLD.claims_dp.claim_fact", from_attribute: "payload", to_attribute: "claim_id" })).rejects.toThrow(/already mapped/);
    await expect(call("map_lineage_attributes", { from_table: "BRONZE.raw.claim_raw", to_table: "GOLD.claims_dp.claim_fact", from_attribute: "nope", to_attribute: "claim_id" })).rejects.toThrow(/Attribute "nope" not found on BRONZE.raw.claim_raw/);
    await expect(call("map_lineage_attributes", { from_table: "GOLD.claims_dp.claim_fact", to_table: "BRONZE.raw.claim_raw", from_attribute: "claim_id", to_attribute: "payload" })).rejects.toThrow(/No lineage link .* — create it first with add_lineage/);
    expect(await call("map_lineage_attributes", { from_table: "uc_cat.uc.uc_table", to_table: "BRONZE.raw.claim_raw", from_attribute: "uc_col", to_attribute: "payload" })).toMatch(/^Mapped/);   /* enrichment is allowed on Unity links */
  });
  it("unmap_lineage_attributes removes a mapping and reports a missing one", async () => {
    expect(await call("unmap_lineage_attributes", { from_table: "BRONZE.raw.claim_raw", to_table: "GOLD.claims_dp.claim_fact", from_attribute: "payload", to_attribute: "insured_name" })).toBe("Mapping removed: BRONZE.raw.claim_raw.payload → GOLD.claims_dp.claim_fact.insured_name.");
    expect(cat.lineage[0].mappings).toEqual([]);
    await expect(call("unmap_lineage_attributes", { from_table: "BRONZE.raw.claim_raw", to_table: "GOLD.claims_dp.claim_fact", from_attribute: "payload", to_attribute: "insured_name" })).rejects.toThrow(/No such attribute mapping/);
    await expect(call("unmap_lineage_attributes", { from_table: "GOLD.claims_dp.claim_fact", to_table: "BRONZE.raw.claim_raw", from_attribute: "a", to_attribute: "b" })).rejects.toThrow(/No lineage link/);
  });
});

describe("glossary tools", () => {
  it("list_glossary_terms lists and filters", async () => {
    expect(await call("list_glossary_terms", {})).toEqual([{ name: "Insured", definition: "The insured person", linked_entities: 2, external_links: 1 }]);
    expect(await call("list_glossary_terms", { query: "person" })).toHaveLength(1);
    expect(await call("list_glossary_terms", { query: "zzz" })).toEqual([]);
    cat.glossary = undefined;
    expect(await call("list_glossary_terms", {})).toEqual([]);
  });
  it("get_glossary_term resolves linked entities to paths and rejects an unknown term", async () => {
    expect(await call("get_glossary_term", { term: "insured" })).toEqual({ name: "Insured", definition: "The insured person", data_domain: null, owner: null, steward: null,
      linked_entities: [{ type: "attribute", path: "GOLD.claims_dp.claim_fact.insured_name" }, { type: "table", path: "GOLD.claims_dp.claim_fact" }], external_links: [{ name: "wiki", url: "https://wiki.example/insured" }] });
    await expect(call("get_glossary_term", { term: "Nope" })).rejects.toThrow(/Glossary term "Nope" not found\. Available: Insured/);
  });
  it("create_glossary_term resolves references of every type and rejects duplicates and bad references", async () => {
    expect(await call("create_glossary_term", { name: "Claim", definition: "d", references: [{ type: "hub", path: "Health" }, { type: "database", path: "BRONZE" }, { type: "schema", path: "BRONZE.raw" }, { type: "table", path: "BRONZE.raw.claim_raw" }, { type: "attribute", path: "BRONZE.raw.claim_raw.payload" }], external_links: [{ url: "https://a" }, { name: "B", url: "https://b" }] })).toBe('Glossary term "Claim" created.');
    expect(cat.glossary.at(-1)).toMatchObject({ name: "Claim", definition: "d", refs: [{ type: "hub", id: "h1" }, { type: "database", id: "d2" }, { type: "schema", id: "s2" }, { type: "table", id: "t2" }, { type: "attribute", id: "a3" }], urls: [{ name: "https://a", url: "https://a" }, { name: "B", url: "https://b" }] });
    expect(changed("glossary_term", "created")).toHaveLength(1);
    await expect(call("create_glossary_term", { name: "INSURED" })).rejects.toThrow(/Glossary term "INSURED" already exists/);
    await expect(call("create_glossary_term", { name: "X", references: [{ type: "table", path: "BRONZE.raw.nope" }] })).rejects.toThrow(/Table "BRONZE.raw.nope" not found/);
    /* v1.71 (F-M2): the reference type is a schema enum — was the tool's "Unknown reference type" error, and "Table" was accepted case-insensitively */
    await expect(call("create_glossary_term", { name: "X", references: [{ type: "column", path: "a" }] })).rejects.toThrow(/arguments\.references\[0\]\.type must be one of hub, database, schema, table, attribute/);
    await expect(call("update_glossary_term", { term: "Insured", references: [{ type: "Table", path: "BRONZE.raw.claim_raw" }] })).rejects.toThrow(/must be one of/);
    await expect(call("create_glossary_term", { name: "X", references: [{ type: "table" }] })).rejects.toThrow(/references\[0\]\.path is required/);
  });
  it("update_glossary_term renames and replaces the lists", async () => {
    expect(await call("update_glossary_term", { term: "Insured", new_name: "Insured Person", definition: "x", references: [{ type: "table", path: "BRONZE.raw.claim_raw" }], external_links: [] })).toBe("Glossary term updated: Insured Person.");
    expect(cat.glossary[0]).toMatchObject({ name: "Insured Person", definition: "x", refs: [{ type: "table", id: "t2" }], urls: [] });
    await expect(call("update_glossary_term", { term: "Nope" })).rejects.toThrow(/not found/);
  });
  it("delete_glossary_term removes the term", async () => {
    expect(await call("delete_glossary_term", { term: "Insured" })).toBe('Glossary term "Insured" deleted.');
    expect(cat.glossary).toEqual([]);
    expect(changed("glossary_term", "deleted")).toHaveLength(1);
    await expect(call("delete_glossary_term", { term: "Insured" })).rejects.toThrow(/not found/);
  });
});

describe("OKF export tool", () => {
  it("export_okf returns the bundle as files, restricted by a selection, or as a zip", async () => {
    const all = await call("export_okf", {});
    expect(all.files_count).toBe(Object.keys(all.files).length);
    expect(all.files["index.md"]).toContain("Alassio Data Catalog");
    const one = await call("export_okf", { table: "BRONZE.raw.claim_raw" });
    expect(one.files_count).toBeLessThan(all.files_count);
    expect(Object.keys(one.files).some((p) => p.includes("claim-raw"))).toBe(true);
    const sel = await call("export_okf", { hub: "P&C" });
    expect(Object.keys(sel.files).some((p) => p.includes("claim-raw"))).toBe(false);
    const z = await call("export_okf", { database: "BRONZE", format: "zip_base64" });
    expect(z).toMatchObject({ filename: "alassio-catalog-okf.zip", files: expect.any(Number) });
    expect(Buffer.from(z.zip_base64, "base64").subarray(0, 2).toString()).toBe("PK");
    await expect(call("export_okf", { hub: "Nope" })).rejects.toThrow(/Data hub "Nope" not found/);
  });
  it("export_okf rejects an unknown format (v1.71 F-M2: it used to return files silently)", async () => {
    await expect(call("export_okf", { table: "BRONZE.raw.claim_raw", format: "zip" })).rejects.toThrow(/arguments\.format must be one of files, zip_base64/);
    expect((await call("export_okf", { table: "BRONZE.raw.claim_raw", format: "files" })).files).toBeDefined();
  });
  it("export_okf loads only the selected tables' attributes", async () => {
    cat.$load = vi.fn(async () => {});
    await call("export_okf", { table: "BRONZE.raw.claim_raw" });
    expect(cat.$load).toHaveBeenCalledWith(["t2"]);
    await call("export_okf", {});
    expect(cat.$load).toHaveBeenLastCalledWith(null);
    cat = null; tools = build();
    await expect(call("export_okf", {})).rejects.toThrow(/The catalog is empty/);
  });
});

describe("lookup helpers (v1.73 F-M4, F-M6)", () => {
  it("sameName, iso and tablePathById", () => {
    expect(sameName("Claim_Fact", "claim_fact")).toBe(true);
    expect(sameName("a", "b")).toBe(false);
    expect(iso(0)).toBeNull();
    expect(iso(undefined)).toBeNull();
    expect(iso(Date.UTC(2026, 0, 2))).toBe("2026-01-02T00:00:00.000Z");
    expect(tablePathById(cat, "t2")).toBe("BRONZE.raw.claim_raw");
    expect(tablePathById(cat, "gone")).toBe("undefined.undefined.gone");   /* a dangling id stays visible */
  });
  it("findOrCreatePerson finds case-insensitively or creates; closePeople ranks near names", () => {
    expect(findOrCreatePerson(cat, "BEN STEWARD")).toBe("p2");
    expect(findOrCreatePerson(cat, "")).toBeNull();
    const id = findOrCreatePerson(cat, "New Person");
    expect(cat.people.find((p) => p.id === id).name).toBe("New Person");
    expect(closePeople(cat, "Ben Stewart")).toEqual(["Ben Steward"]);
    expect(closePeople(cat, "anna")).toEqual(["Anna Owner"]);   /* shares a word */
    expect(closePeople(cat, "Xavier")).toEqual([]);
  });
});
