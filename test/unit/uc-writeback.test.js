/* v1.64 — Unity Catalog write-back diff shared by the browser dialog and the server */
import { describe, it, expect } from "vitest";
import { readUnityState, buildWriteBackOps, executeWriteBackOps, makeSqlRunner, ucListAll } from "../../uc-writeback.js";

const state = {
  hubs: [{ id: "h", name: "Health", bpoId: "p1" }], people: [{ id: "p1", name: "Anna Weber", email: "anna@x.de" }, { id: "p2", name: "Jonas Klein", email: "jonas@x.de" }],
  domains: [{ id: "dm", name: "Claims" }],
  databases: [{ id: "d", name: "main", source: "unity", hubId: "h", country: "DE", layer: "gold", description: "Claims DWH", domainId: "dm", ownerId: "p2", stewardId: "p1" }],
  schemas: [{ id: "s", databaseId: "d", name: "claims", description: "Claim facts" }],
  tables: [{ id: "t1", schemaId: "s", name: "fact_claims", description: "One row per claim", stewardId: "p1", ownerId: "p2" }, { id: "t2", schemaId: "s", name: "not_in_uc", description: "x" }],
  attributes: [{ id: "a1", tableId: "t1", name: "claim_id", description: "Claim number", sensitivity: "Internal", classification: "C2" }, { id: "a2", tableId: "t1", name: "amount", description: "", sensitivity: "Confidential" }],
};
const attributesOf = async (id) => state.attributes.filter((a) => a.tableId === id);
/* fake workspace: REST reads + information_schema tag queries via the SQL statements API */
const fakeUc = ({ catComment = "", tableComment = "", colComment = "", tags = {}, sqlFails = false } = {}) => {
  const calls = [];
  const resp = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const ucReq = async (path, opts = {}) => {
    calls.push({ path, method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : null });
    if (path.startsWith("/api/2.1/unity-catalog/catalogs/main") && !opts.method) return resp({ name: "main", comment: catComment, owner: "old@x.de", properties: { medallion_layer: "gold" } });
    if (path.startsWith("/api/2.1/unity-catalog/schemas?")) return resp({ schemas: [{ name: "information_schema", comment: "" }, { name: "claims", comment: "Claim facts" }] });
    if (path.startsWith("/api/2.1/unity-catalog/tables?")) return resp({ tables: [{ name: "fact_claims", comment: tableComment, properties: { medallion_layer: "gold" }, columns: [{ name: "claim_id", comment: colComment }, { name: "amount", comment: "" }] }] });
    if (path === "/api/2.0/sql/statements") {
      if (sqlFails) return resp({ status: { state: "FAILED", error: { message: "no warehouse" } } });
      const st = JSON.parse(opts.body).statement;
      if (/catalog_tags/.test(st)) return resp({ status: { state: "SUCCEEDED" }, result: { data_array: Object.entries(tags.cat || {}) } });
      if (/table_tags/.test(st)) return resp({ status: { state: "SUCCEEDED" }, result: { data_array: (tags.table || []) } });
      if (/column_tags/.test(st)) return resp({ status: { state: "SUCCEEDED" }, result: { data_array: (tags.col || []) } });
      return resp({ status: { state: "SUCCEEDED" }, result: { data_array: [] } });
    }
    if (opts.method === "PATCH") return path.startsWith("/missing") ? resp({ error: "not found" }, 404) : resp({});
    return resp({ error: "nope" }, 404);
  };
  ucReq.calls = calls;
  return ucReq;
};

describe("Unity Catalog write-back", () => {
  it("emits only the differences — comments, tags, properties — and skips tables that do not exist in UC", async () => {
    const ucReq = fakeUc({ tags: { cat: { "Data Domain": "Claims" }, table: [["claims", "fact_claims", "Data Steward", "Anna Weber"]], col: [["claims", "fact_claims", "claim_id", "Sensitivity", "Public"]] } });
    const runSqlQ = makeSqlRunner(ucReq, "wh1");
    const uc = await readUnityState("main", { ucReq, runSqlQ });
    expect(uc.tagsReadable).toBe(true); expect(Object.keys(uc.curTables)).toEqual(["claims.fact_claims"]);
    const ops = await buildWriteBackOps({ state, db: state.databases[0], attributesOf, uc });
    const labels = ops.map((o) => o.label);
    expect(labels).toEqual([
      "Catalog main — description",
      "Catalog main — tag Data Owner",                           // Data Domain already set; one statement per tag (v1.77)
      "Catalog main — tag Data Steward",
      "Catalog main — property data_hub",                        // medallion_layer already set
      "Catalog main — property country",
      "Table main.claims.fact_claims — description",
      "Table main.claims.fact_claims — tag Data Owner",          // steward tag already set
      "Column main.claims.fact_claims.claim_id — description",
      "Column main.claims.fact_claims.claim_id — tag Sensitivity",   // Public → Internal
      "Column main.claims.fact_claims.claim_id — tag Classification",
      "Column main.claims.fact_claims.amount — tag Sensitivity",
    ]);
    expect(ops.find((o) => o.label.endsWith("tag Data Owner")).sql).toBe("ALTER CATALOG `main` SET TAGS ('Data Owner' = 'Jonas Klein')");
    expect(ops.find((o) => o.label.endsWith("tag Data Steward")).sql).toBe("ALTER CATALOG `main` SET TAGS ('Data Steward' = 'Anna Weber')");
    expect(ops.find((o) => o.label.endsWith("property data_hub")).body).toEqual({ properties: { data_hub: "Health" } });
    expect(ops.find((o) => o.label.endsWith("property country")).body).toEqual({ properties: { country: "DE" } });
    /* v1.77: every operation names the catalog records and fields its value comes from */
    expect(ops.find((o) => o.label.endsWith("tag Data Owner")).src).toEqual([{ type: "database", id: "d", field: "ownerId" }, { type: "person", id: "p2", field: "name" }]);
    expect(ops.find((o) => o.label.endsWith("property data_hub")).src).toEqual([{ type: "database", id: "d", field: "hubId" }, { type: "hub", id: "h", field: "name" }]);
    expect(ops.find((o) => o.label.endsWith("claim_id — tag Sensitivity")).src).toEqual([{ type: "attribute", id: "a1", field: "sensitivity" }]);
    expect(ops.find((o) => o.label === "Table main.claims.fact_claims — description").src).toEqual([{ type: "table", id: "t1", field: "description" }]);
    expect(ops.every((o) => Array.isArray(o.src) && o.src.length > 0)).toBe(true);
    expect(ops.find((o) => o.label === "Table main.claims.fact_claims — description")).toMatchObject({ kind: "sqlOrPatch", path: "/api/2.1/unity-catalog/tables/main.claims.fact_claims", sql: "COMMENT ON TABLE `main`.`claims`.`fact_claims` IS 'One row per claim'" });
    expect(ops.find((o) => o.label.endsWith("claim_id — description")).sql).toBe("ALTER TABLE `main`.`claims`.`fact_claims` ALTER COLUMN `claim_id` COMMENT 'Claim number'");
    expect(labels.some((l) => l.includes("not_in_uc"))).toBe(false);
    /* owner option off by default; on → PATCH owner with the e-mail */
    const withOwner = await buildWriteBackOps({ state, db: state.databases[0], attributesOf, uc, options: { owner: true, comments: false, roles: false, columns: false } });
    expect(withOwner.map((o) => o.label)).toEqual(["Catalog main — UC owner"]); expect(withOwner[0].body).toEqual({ owner: "jonas@x.de" });
    /* an inherited owner points at the record that holds it (here the data hub entry inside the hub type) */
    const inherited = { ...state, databases: [{ ...state.databases[0], ownerId: null }], hubs: [{ id: "h", name: "Health", dataHubs: [{ name: "DE", bpoId: "p1" }] }] };
    const inh = await buildWriteBackOps({ state: inherited, db: inherited.databases[0], attributesOf, uc });
    expect(inh.find((o) => o.label.endsWith("tag Data Owner")).src).toEqual([{ type: "hub", id: "h", field: "dataHubs" }, { type: "person", id: "p1", field: "name" }]);
  });
  it("writes nothing when everything matches, and leaves tags alone when no warehouse can read them", async () => {
    const same = fakeUc({ catComment: "Claims DWH", tableComment: "One row per claim", colComment: "Claim number", tags: { cat: { "Data Owner": "Jonas Klein", "Data Steward": "Anna Weber", "Data Domain": "Claims" }, table: [["claims", "fact_claims", "Data Steward", "Anna Weber"], ["claims", "fact_claims", "Data Owner", "Jonas Klein"]], col: [["claims", "fact_claims", "claim_id", "Sensitivity", "Internal"], ["claims", "fact_claims", "claim_id", "Classification", "C2"], ["claims", "fact_claims", "amount", "Sensitivity", "Confidential"]] } });
    const uc = await readUnityState("main", { ucReq: same, runSqlQ: makeSqlRunner(same, "wh1") });
    const ops = await buildWriteBackOps({ state, db: state.databases[0], attributesOf, uc });
    expect(ops.map((o) => o.label)).toEqual(["Catalog main — property data_hub", "Catalog main — property country"]);
    const noWh = fakeUc({ catComment: "Claims DWH", tableComment: "One row per claim", colComment: "Claim number" });
    const uc2 = await readUnityState("main", { ucReq: noWh, runSqlQ: null });
    expect(uc2.tagsReadable).toBe(false); expect(uc2.sqlAvailable).toBe(false);
    const ops2 = await buildWriteBackOps({ state, db: state.databases[0], attributesOf, uc: uc2 });
    expect(ops2.map((o) => o.label)).toEqual(["Catalog main — property data_hub", "Catalog main — property country"]); expect(ops2.skippedSql).toBe(0);
    /* v1.64.1: without a warehouse the SQL-only changes (column comments, table properties) are counted, not failed */
    const noWhDiff = fakeUc();
    const ops3 = await buildWriteBackOps({ state, db: state.databases[0], attributesOf, uc: await readUnityState("main", { ucReq: noWhDiff, runSqlQ: null }) });
    expect(ops3.map((o) => o.label)).toEqual(["Catalog main — description", "Catalog main — property data_hub", "Catalog main — property country", "Table main.claims.fact_claims — description"]);
    expect(ops3.skippedSql).toBe(1);   /* claim_id column comment */
    expect(ops3.every((o) => o.kind !== "sql")).toBe(true);
    expect(noWhDiff.calls.some((c) => c.path.includes("schema_name=information_schema"))).toBe(false);
    const failing = fakeUc({ sqlFails: true });
    expect((await readUnityState("main", { ucReq: failing, runSqlQ: makeSqlRunner(failing, "wh1") })).tagsReadable).toBe(false);
  });
  it("quotes identifiers in SQL and encodes them in REST paths", async () => {
    const st = structuredClone(state);
    st.tables[0].name = "fact-claims 2024"; st.attributes[0].name = "claim id";
    const ucReq = fakeUc({ tags: { cat: {}, table: [], col: [] } });
    const ucReq2 = async (path, opts) => path.startsWith("/api/2.1/unity-catalog/tables?") ? ({ ok: true, status: 200, json: async () => ({ tables: [{ name: "fact-claims 2024", comment: "", properties: { medallion_layer: "gold" }, columns: [{ name: "claim id", comment: "" }] }] }) }) : ucReq(path, opts);
    const ops = await buildWriteBackOps({ state: st, db: st.databases[0], attributesOf: async (id) => st.attributes.filter((a) => a.tableId === id), uc: await readUnityState("main", { ucReq: ucReq2, runSqlQ: makeSqlRunner(ucReq2, "wh1") }) });
    const tbl = ops.find((o) => o.label === "Table main.claims.fact-claims 2024 — description");
    expect(tbl.path).toBe("/api/2.1/unity-catalog/tables/main.claims.fact-claims%202024"); expect(tbl.sql).toBe("COMMENT ON TABLE `main`.`claims`.`fact-claims 2024` IS 'One row per claim'");
    expect(ops.find((o) => o.label.endsWith("claim id — description")).sql).toBe("ALTER TABLE `main`.`claims`.`fact-claims 2024` ALTER COLUMN `claim id` COMMENT 'Claim number'");
  });
  it("executes PATCH and SQL operations, falls back from PATCH to SQL, reports failures per operation and pages list calls", async () => {
    const ucReq = fakeUc();
    const runSqlQ = makeSqlRunner(ucReq, "wh1");
    const ops = [
      { label: "a", kind: "patch", path: "/api/2.1/unity-catalog/catalogs/main", body: { comment: "x" } },
      { label: "b", kind: "sql", sql: "ALTER TABLE main.claims.fact_claims SET TAGS ('k'='v')" },
      { label: "c", kind: "sqlOrPatch", path: "/missing", body: {}, sql: "COMMENT ON TABLE main.claims.fact_claims IS 'y'" },
      { label: "d", kind: "patch", path: "/missing", body: {} },
    ];
    const progress = [];
    const log = await executeWriteBackOps(ops, { ucReq, runSqlQ, onProgress: (o) => progress.push(o.length) });
    expect(log.map((l) => l.ok)).toEqual([true, true, true, false]); expect(log[3].label).toBe("d — HTTP 404"); expect(progress).toEqual([1, 2, 3, 4]);
    expect(ucReq.calls.filter((c) => c.method === "PATCH")).toHaveLength(3); expect(ucReq.calls.filter((c) => c.path === "/api/2.0/sql/statements")).toHaveLength(2);   /* b, and c after its PATCH failed */
    const noSql = await executeWriteBackOps([ops[1]], { ucReq, runSqlQ: null });
    expect(noSql[0]).toEqual({ ok: false, label: "b — needs a SQL warehouse ID" });
    let page = 0;
    const paged = async (path) => { page++; return { ok: true, status: 200, json: async () => (path.includes("page_token=p2") ? { schemas: [{ name: "b" }] } : { schemas: [{ name: "a" }], next_page_token: "p2" }) }; };
    expect((await ucListAll(paged, "/api/2.1/unity-catalog/schemas?catalog_name=main&max_results=50", "schemas")).map((s) => s.name)).toEqual(["a", "b"]); expect(page).toBe(2);
  });
});
