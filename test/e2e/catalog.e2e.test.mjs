/**
 * E2E — catalog structure through MCP and the UI endpoint: seed, per-object delta saves, search, glossary attachments, tree deletion.
 * v1.73 (F-T6): split out of the former server.e2e.test.mjs. This file resets the test database, boots its own server
 * on port 3981 (E2E_PORT_BASE + 1), bootstraps the admin, seeds hub → e2e_gold → prod → kpi and removes it again.
 * Run alone: DB_USER=… DB_PASSWORD=… DB_NAME=datahub_catalog_test node --test test/e2e/catalog.e2e.test.mjs
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { requireDb, startSuite, cleanupTree } from "./helpers.mjs";

let S;   /* the running suite: { base, c (cookie client), m (MCP client), hubName, seeded, stop } */
const req = (...a) => S.c.req(...a);
const tool = (...a) => S.m.tool(...a);

describe("E2E catalog", { skip: requireDb() }, () => {
  before(async () => {
    S = await startSuite({ name: "catalog" });
  });
  after(async () => { if (S) { await cleanupTree(S.m, S.hubName); await S.stop(); } });

  test("catalog: seed via MCP, read via UI endpoint", async () => {
    /* the tree (hub → e2e_gold → prod → kpi) was created through MCP in before() */
    const { created } = S.seeded;
    assert.equal(created.hub.isError, false);
    assert.equal(created.database.isError, false);
    assert.equal(created.schema.isError, false);
    assert.equal(created.table.isError, false);
    const { catalog } = (await req("/api/catalog")).json;
    assert.ok(catalog.tables.some((t) => t.name === "kpi"));
  });

  test("delta saves: only touched objects conflict", async () => {
    const { catalog, version } = (await req("/api/catalog")).json;
    const t = catalog.tables.find((x) => x.name === "kpi");
    const change = (desc) => ({ entityType: "table", action: "updated", id: t.id, before: t, after: { ...t, description: desc } });
    const a = await req("/api/catalog", { method: "PATCH", body: { baseVersion: version, changes: [change("edit A")] } });
    assert.equal(a.status, 200);
    const other = { id: `e2e-${Date.now()}`, tableId: t.id, name: "col1", dataType: "INT", nullable: true, isPK: false, sensitivity: "Internal", description: "", businessTerm: "" };
    const b = await req("/api/catalog", { method: "PATCH", body: { baseVersion: version, changes: [{ entityType: "attribute", action: "created", id: other.id, after: other }] } });
    assert.equal(b.status, 200, "other object with stale base must succeed");
    const c = await req("/api/catalog", { method: "PATCH", body: { baseVersion: version, changes: [change("edit B")] } });
    assert.equal(c.status, 409, "same object with stale before must conflict");
    assert.equal(c.json.conflicts[0].name, "kpi");
  });

  test("search: FULLTEXT endpoint and MCP search agree", async () => {
    const s = await req(`/api/search?q=${encodeURIComponent("kpi")}`);
    assert.ok(s.json.hits.some((h) => h.name === "kpi"));
    const m = await tool("search_catalog", { query: "kpi" });
    assert.ok(JSON.stringify(m.data).includes("kpi"));
  });

  test("glossary: term via MCP, attachment roundtrip, orphan cleanup", async () => {
    const name = `Term ${Date.now()}`;
    assert.equal((await tool("create_glossary_term", { name, definition: "e2e", references: [{ type: "table", path: "e2e_gold.prod.kpi" }] })).isError, false);
    const g = (await req("/api/catalog")).json.catalog.glossary.find((x) => x.name === name);
    const up = await req(`/api/glossary/${g.id}/files`, { method: "POST", body: { name: "note.txt", mime: "text/plain", data: Buffer.from("hello").toString("base64") } });
    assert.equal(up.status, 200);
    const dl = await req(up.json.file.url, { raw: true });
    assert.equal(await dl.text(), "hello");
    assert.equal((await tool("delete_glossary_term", { term: name })).isError, false);
    assert.equal((await req(`/api/glossary/${g.id}/files`)).json.files.length, 0);
  });

  test("cleanup: delete the e2e hub tree", async () => {
    assert.equal((await tool("delete_database", { database: `${S.hubName}/e2e_gold` })).isError, false);
    const hubs = (await tool("list_hubs")).data;
    if (hubs.length > 1) assert.equal((await tool("delete_hub", { hub: S.hubName })).isError, false);
    else assert.equal((await tool("delete_hub", { hub: S.hubName })).isError, true, "the last hub must be protected");
  });
});
