/**
 * E2E — imports and exports: CSV import job, streamed CSV/OKF exports, dump restore, source-import route, Unity Catalog sync (fake workspace on 127.0.0.1:3993), server-side imports, native connectors (fake services on 127.0.0.1:3994).
 * v1.73 (F-T6): split out of the former server.e2e.test.mjs. This file resets the test database, boots its own server
 * on port 3985 (E2E_PORT_BASE + 5), bootstraps the admin, seeds hub → e2e_gold → prod → kpi and removes it again.
 * Run alone: DB_USER=… DB_PASSWORD=… DB_NAME=datahub_catalog_test node --test test/e2e/imports.e2e.test.mjs
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { requireDb, startSuite, cleanupTree, client } from "./helpers.mjs";

let S;   /* the running suite: { base, c (cookie client), m (MCP client), hubName, seeded, stop } */
const req = (...a) => S.c.req(...a);
const tool = (...a) => S.m.tool(...a);

describe("E2E imports", { skip: requireDb() }, () => {
  before(async () => {
    S = await startSuite({ name: "imports" });
  });
  after(async () => { if (S) { await cleanupTree(S.m, S.hubName); await S.stop(); } });

  test("csv import job, streamed CSV/OKF exports, dump export + restore job", async () => {
    const N = 12000;                                                    /* > LAZY_ATTRIBUTES → the catalog switches to lazy mode */
    const lines = ["data_hub_type,data_hub,database,schema,table,attribute,data_type,nullable,primary_key,attribute_description,sensitivity,classification,domain,domain_owner"];
    for (let i = 0; i < N; i++) lines.push(`${S.hubName},DE,e2e_csv,${i % 2 ? "raw" : "core"},tab_${i % 300},col_${i},INT,${i % 3 ? "true" : "false"},${i % 300 ? "false" : "true"},"desc, ${i}",${i % 7 ? "Internal" : "PII"},${i % 5 ? "" : "c3"},${i % 2 ? "Claims" : ""},${i % 2 ? "Carl Owner" : ""}`);
    const csv = lines.join("\n") + "\n";
    const upload = async () => { const r = await req("/api/import/csv", { method: "POST", body: csv, headers: { "Content-Type": "text/csv", "X-File-Name": "e2e.csv" } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.job; };
    const wait = async (id) => { for (let i = 0; i < 600; i++) { const j = (await req(`/api/import/jobs/${id}`)).json.job; if (["done", "error", "cancelled"].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 200)); } throw new Error("import job did not finish"); };
    let job = await upload();
    assert.ok(["uploading", "running"].includes(job.status)); assert.equal(job.fileName, "e2e.csv"); assert.ok(job.bytesTotal > 100000);
    job = await wait(job.id);
    assert.equal(job.status, "done", job.error);
    assert.equal(job.counts.attributes, N); assert.equal(job.counts.tables, 300); assert.equal(job.counts.schemas, 2); assert.equal(job.counts.databases, 1); assert.equal(job.counts.domains, 1); assert.equal(job.counts.people, 1);
    assert.equal(job.rowsRead, N); assert.equal(job.rowsWritten, job.rowsToWrite); assert.equal(job.rowsWritten, job.counts.total);
    assert.ok(job.chunks >= 3, `the 12k rows were merged in ${job.chunks} chunks of ≤ 5000 (v1.59 streaming import)`);
    /* catalog is lazy now; the table endpoint reads its attributes directly from the rows */
    const cat = await req("/api/catalog");
    assert.equal(cat.json.lazy, true); assert.equal(cat.json.catalog.attributes.length, 0); assert.ok(cat.json.stats.attributes >= N);
    const tab = cat.json.catalog.tables.find((x) => x.name === "tab_7");
    const attrs = (await req(`/api/tables/${tab.id}/attributes`)).json.attributes;
    assert.equal(attrs.length, 40); assert.equal(attrs[0].description, "desc, 7"); assert.equal(attrs[0].classification, ""); assert.equal(attrs.find((a) => a.name === "col_307").classification, "");
    assert.equal(cat.json.catalog.domains.find((d) => d.name === "Claims").ownerId, cat.json.catalog.people.find((p) => p.name === "Carl Owner").id);
    const full = await req("/api/catalog?full=1");
    assert.equal(full.json.lazy, false); assert.ok(full.json.catalog.attributes.length >= N);
    /* idempotent: the same file again creates nothing */
    job = await wait((await upload()).id);
    assert.equal(job.status, "done"); assert.equal(job.counts.total, 0);
    /* audit: one summary entry for the bulk import, not one per attribute */
    const audit = await req("/api/audit?q=e2e.csv&limit=5");
    assert.ok(audit.json.entries.some((e) => e.entityType === "system" && /CSV import e2e.csv( \(part \d+\))? \(\d+ record changes\)/.test(e.name)), JSON.stringify(audit.json.entries.map((e) => e.name)));
    /* broken file: missing columns → job error, nothing written */
    const bad = await req("/api/import/csv", { method: "POST", body: "a,b\n1,2\n", headers: { "Content-Type": "text/csv" } });
    const badJob = await wait(bad.json.job.id);
    assert.equal(badJob.status, "error"); assert.match(badJob.error, /required/);
    /* guests cannot import */
    assert.equal((await req("/api/import/jobs", { headers: { Cookie: "" } })).status, 401);
    /* server-side exports: CSV and OKF are streamed with a form-encoded selection */
    /* (like submitDownload in the UI: the CSRF token travels in the _csrf field, not in a header) */
    const form = (sel) => ({ method: "POST", csrf: false, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `selection=${encodeURIComponent(JSON.stringify(sel))}&_csrf=${S.c.csrf()}`, raw: true });
    const csvRes = await req("/api/export/csv", form({ tableIds: [tab.id], schemaIds: [], databaseIds: [] }));
    assert.equal(csvRes.status, 200); assert.match(csvRes.headers.get("content-disposition"), /attachment; filename=alassio-catalog-export-/);
    const csvText = await csvRes.text(); const csvLines = csvText.trim().split(/\r?\n/);
    assert.equal(csvLines.length, 41, "header + 40 attribute rows"); assert.match(csvLines[0], /^data_hub_type,data_hub,database/); assert.ok(csvLines[1].includes("tab_7") && csvLines[1].includes('"desc, 7"'));
    const csvAll = await (await req("/api/export/csv", { ...form({}), body: `_csrf=${S.c.csrf()}` })).text();
    assert.ok(csvAll.split("\n").length > N, "full export streams every attribute");
    const okfRes = await req("/api/export/okf", form({ tableIds: [tab.id], schemaIds: [], databaseIds: [] }));
    assert.equal(okfRes.status, 200); assert.equal(okfRes.headers.get("content-type"), "application/zip");
    const zip = Buffer.from(await okfRes.arrayBuffer());
    assert.equal(zip.subarray(0, 2).toString(), "PK"); assert.ok(zip.includes(Buffer.from("alassio-catalog-okf/index.md")) && zip.includes(Buffer.from("tab-7.md")));
    /* dump: streamed export, restore as a job (the restored catalog equals the export) */
    const dumpRes = await req("/admin/dump", { raw: true }); assert.equal(dumpRes.status, 200);
    const dumpText = await dumpRes.text(); const dump = JSON.parse(dumpText);
    assert.equal(dump.format, "datahub-catalog-dump"); assert.ok(dump.catalog.attributes.length >= N);
    dump.catalog.tables.find((x) => x.id === tab.id).description = "restored description";
    const restore = await req("/admin/dump", { method: "POST", body: JSON.stringify(dump), headers: { "Content-Type": "application/json", "X-File-Name": "e2e-dump.json" } });
    assert.equal(restore.status, 200, JSON.stringify(restore.json)); assert.equal(restore.json.job.kind, "dump");
    const rj = await wait(restore.json.job.id);
    assert.equal(rj.status, "done", rj.error); assert.equal(rj.counts.updated, 1); assert.equal(rj.counts.created, 0);
    assert.equal((await req(`/api/catalog`)).json.catalog.tables.find((x) => x.id === tab.id).description, "restored description");
    const badRestore = await wait((await req("/admin/dump", { method: "POST", body: '{"nope":1}', headers: { "Content-Type": "application/json" } })).json.job.id);
    assert.equal(badRestore.status, "error"); assert.match(badRestore.error, /Not a valid catalog dump/);
    assert.equal((await tool("delete_database", { database: `${S.hubName}/e2e_csv` })).isError, false);
  });

  test("source import route: inspector modes are forwarded, native modes run in Node, unknown ones rejected", async () => {
    /* the Python inspector is not running in CI — an inspector mode is forwarded (502 not reachable), an invalid one is 400 */
    for (const mode of ["lakefiles", "sqlalchemy"]) {
      const r = await req("/api/source-import/inspect", { method: "POST", body: { mode, url: "https://x", paths: ["s3://b/x.parquet"] } });
      assert.equal(r.status, 502, `${mode}: ${JSON.stringify(r.json)}`); assert.match(r.json.error, /inspector service is not reachable/);
    }
    /* v1.60: the HTTPS connectors no longer need the inspector — they fail on the unreachable host itself */
    for (const mode of ["odata", "kafka", "powerbi"]) {
      const r = await req("/api/source-import/inspect", { method: "POST", body: { mode, url: "https://x.invalid", tenantId: "t", clientId: "c", clientSecret: "s" } });
      assert.equal(r.status, 502, `${mode}: ${JSON.stringify(r.json)}`); assert.doesNotMatch(r.json.error, /inspector service/); assert.match(r.json.error, /ENOTFOUND|EAI_AGAIN|token request failed/);
    }
    assert.equal((await req("/api/source-import/inspect", { method: "POST", body: { mode: "ftp" } })).status, 400);
    /* bundle import through the normal delta save: two databases + a lineage edge, as the UI sends them */
    const t = (await req("/api/catalog")).json;
    const mk = (id, extra) => ({ id, ...extra });
    const db1 = mk(`e2e-pbi-${Date.now()}`, { name: `E2E PBI ${Date.now()}`, hubId: t.catalog.hubs[0].id, country: "GLOBAL", layer: "other", source: "external", sourceType: "Power BI", domainId: null, description: "ws" });
    const sc1 = mk(`${db1.id}-s`, { databaseId: db1.id, name: "Reports", description: "" });
    const tb1 = mk(`${db1.id}-t`, { schemaId: sc1.id, name: "Overview", type: "REPORT", description: "", businessDefinition: "", stewardId: null, tags: "power-bi" });
    const kpi = t.catalog.tables.find((x) => x.name === "kpi");
    const edge = mk(`${db1.id}-e`, { from: kpi.id, to: tb1.id });
    const changes = [["database", db1], ["schema", sc1], ["table", tb1], ["lineage", edge]].map(([entityType, after]) => ({ entityType, action: "created", id: after.id, after }));
    const r = await req("/api/catalog", { method: "PATCH", body: { baseVersion: t.version, changes } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const after = (await req("/api/catalog")).json.catalog;
    assert.ok(after.tables.some((x) => x.id === tb1.id && x.type === "REPORT"));
    assert.ok(after.lineage.some((e) => e.from === kpi.id && e.to === tb1.id), "lineage edge to the report persisted");
    assert.equal((await tool("delete_database", { database: `${t.catalog.hubs[0].name}/${db1.name}` })).isError, false);
  });

  test("scheduled Unity Catalog sync: profile CRUD, connection test, apply / report modes, drift notification, task endpoint", async () => {
    /* a fake Databricks workspace: just enough of the Unity Catalog REST API */
    const http = await import("node:http");
    const uc = { sales: { orders: [["id", "INT"], ["amount", "DECIMAL(10,2)"]], customers: [["id", "INT"], ["name", "STRING"]] } };
    const written = { patches: [], sql: [] };   /* v1.64: what the server-side write-back sends */
    const comments = {};   /* table comments the fake workspace remembers (v1.77) */
    const fake = http.createServer((rq, rs) => {
      const u = new URL(rq.url, "http://x"); const json = (b, code = 200) => { rs.writeHead(code, { "Content-Type": "application/json" }); rs.end(JSON.stringify(b)); };
      if (rq.headers.authorization !== "Bearer fake-pat") return json({ error: "unauthorized" }, 401);
      const chunks = []; rq.on("data", (c) => chunks.push(c)); rq.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      if (rq.method === "PATCH") { written.patches.push({ path: u.pathname, body }); const tm = u.pathname.match(/\/tables\/uc_e2e\.([^.]+)\.([^.]+)$/); if (tm && body?.comment !== undefined) comments[`${tm[1]}.${tm[2]}`] = body.comment; return json({}); }   /* v1.77: table comments persist, so a written change stops being a difference */
      if (u.pathname === "/api/2.0/sql/statements") { written.sql.push(body.statement); return json({ status: { state: "SUCCEEDED" }, result: { data_array: /information_schema\.table_tags/.test(body.statement) ? [["sales", "orders", "Data Steward", "E2E Steward"]] : [] } }); }
      if (u.pathname === "/api/2.1/unity-catalog/catalogs/uc_e2e") return json({ name: "uc_e2e", comment: "", owner: "someone@x", properties: {} });
      if (u.pathname === "/api/2.1/unity-catalog/catalogs") return json({ catalogs: [{ name: "uc_e2e", comment: "e2e catalog", owner: "someone@x" }] });
      if (u.pathname === "/api/2.1/unity-catalog/schemas") return json({ schemas: [...Object.keys(uc).map((name) => ({ name, comment: `${name} schema` })), { name: "information_schema" }] });
      if (u.pathname === "/api/2.1/unity-catalog/tables") { const sc = u.searchParams.get("schema_name"); return json({ tables: Object.entries(uc[sc] || {}).map(([name, cols]) => ({ name, table_type: "TABLE", comment: comments[`${sc}.${name}`] ?? `${name} table`, columns: cols.map(([n, t]) => ({ name: n, type_text: t, nullable: true })) })) }); }
      json({ error: "not found" }, 404);
      });
    });
    await new Promise((r) => fake.listen(3993, "127.0.0.1", r));
    try {
      const hubId = (await req("/api/catalog")).json.catalog.hubs.find((h) => h.name === S.hubName).id;
      let r = await req("/admin/sync/profiles", { method: "PUT", body: { name: "E2E UC", host: "http://127.0.0.1:3993", catalog: "uc_e2e", hubId, country: "DE", layer: "silver", mode: "apply", schedule: "manual", auth: { type: "pat", token: "fake-pat" } } });
      assert.equal(r.status, 200, JSON.stringify(r.json)); const prof = r.json.profile; assert.equal(prof.auth.token, "••••••••"); assert.equal(prof.auth.hasToken, true);
      assert.equal((await req("/admin/sync/profiles", { method: "PUT", body: { name: "x", catalog: "", auth: { type: "pat", token: "t" } } })).status, 400);
      /* v1.66.1: a profile may only point at a Databricks workspace (or a host from DATABRICKS_ALLOWED_HOSTS) */
      const evil = await req("/admin/sync/profiles", { method: "PUT", body: { name: "evil", host: "https://attacker.example", catalog: "x", auth: { type: "pat", token: "t" } } });
      assert.equal(evil.status, 400, JSON.stringify(evil.json)); assert.match(evil.json.error, /not a Databricks workspace/);
      assert.equal((await req("/api/import/unity/catalogs", { method: "POST", body: { host: "https://attacker.example", auth: { type: "pat", token: "t" } } })).status, 400);
      /* a changed host never reuses the stored token */
      const moved = await req("/admin/sync/profiles", { method: "PUT", body: { id: prof.id, host: "https://adb-999.9.azuredatabricks.net" } });
      assert.equal(moved.status, 400, "a host change without a new token is refused for a PAT profile");
      const t = await req(`/admin/sync/profiles/${prof.id}/test`, { method: "POST", body: {} });
      assert.equal(t.status, 200, JSON.stringify(t.json)); assert.deepEqual([t.json.schemas, t.json.tables, t.json.columns], [1, 2, 4]);
      /* first run: everything is new and gets applied */
      r = await req(`/admin/sync/profiles/${prof.id}/run`, { method: "POST", body: {} });
      assert.equal(r.status, 200, JSON.stringify(r.json)); let res = r.json.result; assert.equal(res.ok, true, res.error); assert.equal(res.counts.newTables, 2); assert.equal(res.counts.newColumns, 4); assert.ok(res.applied >= 7, `applied ${res.applied}`);
      let cat = (await req("/api/catalog")).json.catalog;
      const db = cat.databases.find((d) => d.name === "uc_e2e"); assert.ok(db); assert.equal(db.source, "unity"); assert.equal(db.hubId, hubId); assert.equal(db.layer, "silver"); assert.equal(db.sourceRef.sync, prof.id);
      const sc = cat.schemas.find((s) => s.databaseId === db.id && s.name === "sales"); const orders = cat.tables.find((x) => x.schemaId === sc.id && x.name === "orders"); assert.ok(orders);
      assert.equal((await req(`/api/tables/${orders.id}/attributes`)).json.attributes.length, 2);
      /* second run: a new column, a changed type and a removed table — removals are reported, not deleted, unless deleteMissing */
      uc.sales.orders = [["id", "INT"], ["amount", "DOUBLE"], ["status", "STRING"]]; delete uc.sales.customers;
      res = (await req(`/admin/sync/profiles/${prof.id}/run`, { method: "POST", body: {} })).json.result;
      assert.deepEqual([res.counts.newColumns, res.counts.changedTypes, res.counts.removedTables], [1, 1, 1]); assert.equal(res.applied, 2);
      let attrs = (await req(`/api/tables/${orders.id}/attributes`)).json.attributes;
      assert.equal(attrs.length, 3); assert.equal(attrs.find((a) => a.name === "amount").dataType, "DOUBLE");
      cat = (await req("/api/catalog")).json.catalog; assert.ok(cat.tables.some((x) => x.schemaId === sc.id && x.name === "customers"), "not deleted without deleteMissing");
      r = await req("/admin/sync/profiles", { method: "PUT", body: { id: prof.id, deleteMissing: true } }); assert.equal(r.status, 200);
      res = (await req(`/admin/sync/profiles/${prof.id}/run`, { method: "POST", body: {} })).json.result;
      assert.equal(res.counts.removedTables, 1); assert.equal(res.applied, 3, "table + its two attributes");
      cat = (await req("/api/catalog")).json.catalog; assert.ok(!cat.tables.some((x) => x.schemaId === sc.id && x.name === "customers"), "deleted with deleteMissing");
      /* report mode: drift is recorded and the admins (nobody responsible) are notified, nothing changes */
      uc.sales.returns = [["id", "INT"]];
      r = await req("/admin/sync/profiles", { method: "PUT", body: { id: prof.id, mode: "report" } }); assert.equal(r.json.profile.mode, "report");
      res = (await req(`/admin/sync/profiles/${prof.id}/run`, { method: "POST", body: {} })).json.result;
      assert.equal(res.counts.newTables, 1); assert.equal(res.applied, 0); assert.ok(res.notified >= 1, "admins notified");
      cat = (await req("/api/catalog")).json.catalog; assert.ok(!cat.tables.some((x) => x.schemaId === sc.id && x.name === "returns"));
      const inbox = (await req("/api/messages")).json.messages; assert.ok(inbox.some((m) => /^Unity[- ]Catalog[- ](drift|Abweichung): uc_e2e \(2 /.test(m.subject) && m.body.includes("sales.returns") && /new table|neue Tabelle/.test(m.body)), "localized drift message for the admin (German account since test 13): " + JSON.stringify(inbox.map((m) => m.subject).slice(0, 5)));
      const listed = (await req("/admin/sync/profiles")).json; assert.equal(listed.profiles.find((p) => p.id === prof.id).lastRun.total, 2, "new table + its column");
      /* v1.64: server-side write-back — preview, then write; comments/tags/properties go to the fake workspace with the profile's token */
      const snap = (await req("/api/catalog")).json; const dbUpd = snap.catalog.databases.find((d) => d.name === "uc_e2e"); const ordersNow = snap.catalog.tables.find((x) => x.id === orders.id);
      r = await req("/api/catalog", { method: "PATCH", body: { baseVersion: snap.version, changes: [
        { entityType: "database", action: "updated", id: dbUpd.id, before: dbUpd, after: { ...dbUpd, description: "E2E catalog description" } },
        { entityType: "table", action: "updated", id: orders.id, before: ordersNow, after: { ...ordersNow, description: "Orders fact" } }] } });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      const preview = await req(`/admin/sync/profiles/${prof.id}/writeback?dryRun=1`, { method: "POST", body: {} });
      assert.equal(preview.status, 200, JSON.stringify(preview.json)); assert.equal(preview.json.result.ok, true, preview.json.result.error); assert.equal(preview.json.result.dryRun, true);
      assert.ok(preview.json.result.log.some((l) => l.label === "Catalog uc_e2e — description"), JSON.stringify(preview.json.result.log));
      assert.equal(written.patches.length, 0, "a preview writes nothing");
      assert.equal(preview.json.result.tagsReadable, false); assert.equal(typeof preview.json.result.skipped, "number");   /* v1.64.1: no warehouse yet → SQL-only changes are counted as skipped, never failed */
      assert.ok(preview.json.result.log.every((l) => l.ok), "nothing fails without a warehouse");
      r = await req("/admin/sync/profiles", { method: "PUT", body: { id: prof.id, writeBack: { enabled: true, warehouseId: "wh-e2e" } } });
      assert.equal(r.json.profile.writeBack.enabled, true); assert.equal(r.json.profile.writeBack.warehouseId, "wh-e2e"); assert.equal(r.json.profile.writeBack.comments, true);
      const wb = await req(`/admin/sync/profiles/${prof.id}/writeback`, { method: "POST", body: {} });
      assert.equal(wb.status, 200, JSON.stringify(wb.json)); assert.equal(wb.json.result.ok, true, JSON.stringify(wb.json.result)); assert.ok(wb.json.result.written >= 2, JSON.stringify(wb.json.result)); assert.equal(wb.json.result.tagsReadable, true);
      assert.ok(written.patches.some((p) => p.path === "/api/2.1/unity-catalog/catalogs/uc_e2e" && p.body.comment === "E2E catalog description"), JSON.stringify(written.patches));
      assert.ok(written.patches.some((p) => p.path === "/api/2.1/unity-catalog/catalogs/uc_e2e" && p.body.properties?.medallion_layer === "silver"), "catalog properties");
      assert.ok(written.patches.some((p) => p.path.endsWith("/tables/uc_e2e.sales.orders") && p.body.comment === "Orders fact") || written.sql.some((q) => q.includes("COMMENT ON TABLE `uc_e2e`.`sales`.`orders`")), "table comment");
      assert.ok(written.sql.some((q) => /information_schema\.catalog_tags/.test(q)), "tags were read through the warehouse");
      const listedWb = (await req("/admin/sync/profiles")).json.profiles.find((p) => p.id === prof.id);
      assert.equal(listedWb.lastWriteBack.ok, true); assert.equal(listedWb.lastWriteBack.written, wb.json.result.written);
      /* v1.77: changes belong to the user who made them — a steward writes back her own change, the admin's stays pending for the admin */
      const patMail = `pat-${Date.now()}@example.com`;
      const inv = await req("/admin/invite", { method: "POST", body: { email: patMail, roles: ["steward"] } }); assert.equal(inv.status, 200);
      const pat = client(S.base);
      const acc = await pat.req("/auth/accept-invite", { method: "POST", body: { token: new URL(inv.json.link).searchParams.get("invite"), name: "Pat Steward", password: "pat-pass-12345" } }); assert.equal(acc.status, 200);
      let snap2 = (await req("/api/catalog")).json;
      const patPerson = { id: `p-pat-${Date.now()}`, name: "Pat Steward", email: patMail };
      const ordersA = snap2.catalog.tables.find((x) => x.id === orders.id), dbA = snap2.catalog.databases.find((d) => d.id === dbUpd.id);
      r = await req("/api/catalog", { method: "PATCH", body: { baseVersion: snap2.version, changes: [
        { entityType: "person", action: "created", id: patPerson.id, after: patPerson },
        { entityType: "table", action: "updated", id: orders.id, before: ordersA, after: { ...ordersA, stewardId: patPerson.id } },
        { entityType: "database", action: "updated", id: dbA.id, before: dbA, after: { ...dbA, description: "Admin description v2" } }] } });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      snap2 = (await pat.req("/api/catalog")).json; const ordersB = snap2.catalog.tables.find((x) => x.id === orders.id);
      r = await pat.req("/api/catalog", { method: "PATCH", body: { baseVersion: snap2.version, changes: [{ entityType: "table", action: "updated", id: orders.id, before: ordersB, after: { ...ordersB, description: "Orders fact — by Pat" } }] } });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal((await client(S.base).req("/api/writeback/targets")).status, 401, "targets need a session");
      const targets = (await pat.req("/api/writeback/targets")).json.targets; assert.ok(targets.some((x) => x.id === prof.id && x.catalog === "uc_e2e"), JSON.stringify(targets));
      written.patches.length = 0; written.sql.length = 0;
      const patPreview = (await pat.req(`/api/writeback/${prof.id}/preview`, { method: "POST", body: {} })).json.result;
      assert.equal(patPreview.scope, "mine"); assert.equal(patPreview.pending.mine, 1, JSON.stringify(patPreview)); assert.equal(patPreview.pending.writable, 1);
      assert.ok(patPreview.pending.others.some((o) => o.name === "E2E Admin" && o.count >= 1), "the admin's change is listed as another user's");
      assert.ok(patPreview.log.find((l) => l.label.endsWith("sales.orders — description")).mine); assert.equal(patPreview.log.find((l) => l.label === "Catalog uc_e2e — description").mine, false);
      assert.equal(written.patches.length, 0, "a preview writes nothing");
      const patRun = (await pat.req(`/api/writeback/${prof.id}/run`, { method: "POST", body: {} })).json.result;
      assert.equal(patRun.ok, true, JSON.stringify(patRun)); assert.equal(patRun.written, 1); assert.equal(patRun.total, 1);
      assert.ok(written.patches.some((p) => p.path.endsWith("/tables/uc_e2e.sales.orders") && p.body.comment === "Orders fact — by Pat") || written.sql.some((q) => q.includes("Orders fact — by Pat")), JSON.stringify(written));
      assert.ok(!written.patches.some((p) => p.body.comment === "Admin description v2"), "the admin's change is not written by Pat");
      const adminPreview = (await req(`/admin/sync/profiles/${prof.id}/writeback?dryRun=1`, { method: "POST", body: {} })).json.result;
      assert.ok(adminPreview.pending.mine >= 1, JSON.stringify(adminPreview.pending)); assert.ok(adminPreview.log.find((l) => l.label === "Catalog uc_e2e — description").mine, "the admin's own change");
      assert.ok(!adminPreview.pending.others.length, "Pat's change was written, nothing of hers is pending: " + JSON.stringify(adminPreview.log.filter((l) => !l.mine)));
      assert.ok(!adminPreview.log.some((l) => l.label === "Table uc_e2e.sales.orders — description"), "the written comment is no longer a difference");   /* the fake workspace never persists SQL tag writes, so the admin's own tag changes stay listed */
      const wbTask = await req("/admin/tasks/uc-writeback/run", { method: "POST", body: { profileId: prof.id, dryRun: true } });
      assert.equal(wbTask.status, 200, JSON.stringify(wbTask.json)); assert.equal(wbTask.json.result.dryRun, true);
      /* a sync run with write-back enabled carries the write-back result */
      const runWb = (await req(`/admin/sync/profiles/${prof.id}/run`, { method: "POST", body: {} })).json.result;
      assert.equal(runWb.ok, true); assert.ok(runWb.writeBack, "write-back ran after the sync"); assert.equal(runWb.writeBack.ok, true);
      const auditWb = (await req("/api/audit?type=system&limit=20")).json.entries;
      assert.ok(auditWb.some((e) => /Unity Catalog write-back E2E UC/.test(e.name)), "audited");
      /* the task endpoint runs a profile regardless of its schedule; wrong credentials fail cleanly */
      const task = await req("/admin/tasks/uc-sync/run", { method: "POST", body: { profileId: prof.id } });
      assert.equal(task.status, 200, JSON.stringify(task.json)); assert.equal(task.json.result.runs[0].ok, true);
      await req("/admin/sync/profiles", { method: "PUT", body: { id: prof.id, auth: { type: "pat", token: "wrong" } } });
      res = (await req(`/admin/sync/profiles/${prof.id}/run`, { method: "POST", body: {} })).json.result; assert.equal(res.ok, false); assert.match(res.error, /HTTP 401/);
      assert.equal((await req(`/admin/sync/profiles/${prof.id}`, { method: "DELETE" })).json.ok, true);
      assert.equal((await tool("delete_database", { database: `${S.hubName}/uc_e2e` })).isError, false);

      /* v1.66: the one-off Unity Catalog import runs on the server as a job (the browser dialog no longer talks to Databricks) */
      const conn = { host: "http://127.0.0.1:3993", auth: { type: "pat", token: "fake-pat" }, warehouseId: "wh-e2e" };
      const cats = await req("/api/import/unity/catalogs", { method: "POST", body: conn });
      assert.equal(cats.status, 200, JSON.stringify(cats.json)); assert.deepEqual(cats.json.catalogs.map((c) => c.name), ["uc_e2e"]);
      assert.equal((await req("/api/import/unity/catalogs", { method: "POST", body: { ...conn, auth: { type: "pat", token: "wrong" } } })).status, 502);
      const started = await req("/api/import/unity", { method: "POST", body: { ...conn, catalog: "uc_e2e", hubId, country: "DE", layer: "silver", lineage: false, importTags: true, saveProfile: { name: "E2E one-off" } } });
      assert.equal(started.status, 200, JSON.stringify(started.json)); assert.equal(started.json.job.kind, "unity");
      let job;
      for (let i = 0; i < 100; i++) { job = (await req(`/api/import/jobs/${started.json.job.id}`)).json.job; if (["done", "error", "cancelled"].includes(job.status)) break; await new Promise((r) => setTimeout(r, 100)); }
      assert.equal(job.status, "done", JSON.stringify(job)); assert.equal(job.counts.tables, 2); assert.equal(job.counts.tags, true, "governance tags read through the warehouse"); assert.ok(job.profileId, "saved as a sync profile");
      const imported = (await req("/api/catalog")).json.catalog;
      const ucDb = imported.databases.find((d) => d.name === "uc_e2e" && d.hubId === hubId); assert.ok(ucDb, "database imported"); assert.equal(ucDb.source, "unity"); assert.equal(ucDb.sourceRef.warehouse, "wh-e2e");
      const ordersT = imported.tables.find((t) => t.name === "orders" && imported.schemas.some((sc) => sc.id === t.schemaId && sc.databaseId === ucDb.id));
      assert.ok(ordersT); assert.equal(imported.people.find((p) => p.id === ordersT.stewardId)?.name, "E2E Steward", "Data Steward tag became the table steward");
      const savedProf = (await req("/admin/sync/profiles")).json.profiles.find((p) => p.id === job.profileId);
      assert.equal(savedProf.name, "E2E one-off"); assert.equal(savedProf.warehouseId, "wh-e2e"); assert.equal(savedProf.schedule, "manual"); assert.equal(savedProf.mode, "apply");
      await req(`/admin/sync/profiles/${savedProf.id}`, { method: "DELETE" });
      assert.equal((await tool("delete_database", { database: `${S.hubName}/uc_e2e` })).isError, false);
    } finally { fake.close(); }
  });

  test("server-side imports (v1.66): external source, dbt bundle, bundle apply, stats and capabilities", async () => {
    const ext = await req("/api/import/external", { method: "POST", body: { dbName: "e2e_src", sourceType: "DuckDB", country: "DE", schemasPayload: [{ name: "main", tables: [{ name: "claims", comment: "claims", columns: [{ name: "id", type_text: "BIGINT", nullable: false }, { name: "paid", type_text: "DECIMAL" }] }] }], sourceRef: { kind: "duckdb", path: "/x.duckdb" } } });
    assert.equal(ext.status, 200, JSON.stringify(ext.json)); assert.ok(ext.json.applied >= 4, JSON.stringify(ext.json)); assert.equal(ext.json.counts.tables, 1);
    let cat = (await req("/api/catalog")).json.catalog;
    const srcHub = cat.hubs.find((h) => h.name === "SOURCE"); assert.ok(srcHub, "SOURCE hub exists (seeded on the server)");
    const srcDb = cat.databases.find((d) => d.name === "e2e_src"); assert.equal(srcDb.hubId, srcHub.id); assert.equal(srcDb.layer, "other"); assert.equal(srcDb.sourceRef.kind, "duckdb");
    const again = await req("/api/import/external", { method: "POST", body: { dbName: "e2e_src", sourceType: "DuckDB", country: "DE", schemasPayload: [{ name: "main", tables: [{ name: "claims", columns: [{ name: "id" }, { name: "paid" }] }] }] } });
    assert.equal(again.json.counts.tables, 1); assert.ok(again.json.applied <= 1, "re-import only touches the sourceRef stamp");   /* existing attributes were loaded, nothing duplicated */
    const manifest = { metadata: { project_name: "e2e_dbt", dbt_version: "1.8.0" }, nodes: { "model.e2e_dbt.m1": { resource_type: "model", name: "m1", database: "e2e_src", schema: "main", description: "model one", columns: { id: { name: "id", description: "key" } }, depends_on: { nodes: ["source.e2e_dbt.src.claims"] } } }, sources: { "source.e2e_dbt.src.claims": { resource_type: "source", name: "claims", database: "e2e_src", schema: "main", columns: {} } } };
    const dbt = await req("/api/import/bundle", { method: "POST", body: { kind: "dbt", manifest: JSON.stringify(manifest), fileName: "manifest.json", hubId: "source", country: "DE" } });
    assert.equal(dbt.status, 200, JSON.stringify(dbt.json)); assert.ok(dbt.json.applied >= 1, JSON.stringify(dbt.json));
    cat = (await req("/api/catalog")).json.catalog;
    const m1 = cat.tables.find((t) => t.name === "m1"); assert.ok(m1, "dbt model imported on the server"); assert.equal(m1.description, "model one");
    const claims = cat.tables.find((t) => t.name === "claims" && cat.schemas.some((sc) => sc.id === t.schemaId && sc.databaseId === srcDb.id));
    assert.ok(cat.lineage.some((e) => e.from === claims.id && e.to === m1.id), "dbt source → model lineage resolved against the existing catalog");
    assert.equal((await req("/api/import/bundle", { method: "POST", body: { kind: "odcs", contracts: ["nothing: here"], fileName: "c.yaml" } })).status, 400);
    const applied = await req("/api/import/bundle/apply", { method: "POST", body: { hubId: "source", sourceType: "Power BI", databases: [{ name: "e2e_pbi", schemas: [{ name: "Reports", tables: [{ name: "Sales report", type: "REPORT", columns: [] }] }] }], lineage: [["e2e_src.main.m1", "e2e_pbi.Reports.Sales report"]] } });
    assert.equal(applied.status, 200, JSON.stringify(applied.json)); assert.equal(applied.json.counts.lineage, 1);
    const stats = await req("/api/stats");
    assert.equal(stats.status, 200); assert.ok(stats.json.stats.attributes >= 2); assert.ok(stats.json.stats.attributesWithDescription >= 1); assert.equal(typeof stats.json.stats.tablesWithDescription, "number");
    const me = (await req("/auth/me")).json.user;
    assert.equal(me.capabilities.admin, true); assert.equal(me.capabilities.canImport, true); assert.equal(me.capabilities.canDesignProducts, true);
    for (const name of ["e2e_pbi", "e2e_src"]) { const d = cat.databases.find((x) => x.name === name) || (await req("/api/catalog")).json.catalog.databases.find((x) => x.name === name); if (d) await tool("delete_database", { database: `SOURCE/${name}` }); }
  });

  test("native connectors (v1.60): capabilities, OData and Schema Registry through the Node route, inspector-only modes still proxied", async () => {
    const http = await import("node:http");
    const EDMX = `<?xml version="1.0"?><edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0"><edmx:DataServices><Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="E2E"><EntityType Name="Claim"><Key><PropertyRef Name="id"/></Key><Property Name="id" Type="Edm.Int32" Nullable="false"/><Property Name="note" Type="Edm.String"><Annotation Term="Core.Description" String="free text"/></Property></EntityType></Schema></edmx:DataServices></edmx:Edmx>`;
    const seen = [];
    const fake = http.createServer((rq, rs) => {
      seen.push(rq.url);
      const json = (b, code = 200) => { rs.writeHead(code, { "Content-Type": "application/json" }); rs.end(JSON.stringify(b)); };
      if (rq.url === "/svc/$metadata?sap-client=100") { if (rq.headers.authorization !== "Basic " + Buffer.from("u:p").toString("base64")) return json({}, 401); rs.writeHead(200, { "Content-Type": "application/xml" }); return rs.end(EDMX); }
      if (rq.url === "/subjects") return json(["claims-value"]);
      if (rq.url === "/subjects/claims-value/versions/latest") return json({ id: 1, version: 1, schemaType: "AVRO", schema: JSON.stringify({ type: "record", name: "Claim", fields: [{ name: "id", type: "int" }, { name: "amount", type: ["null", "double"], default: null }] }) });
      json({ error: "not found" }, 404);
    });
    await new Promise((r) => fake.listen(3994, "127.0.0.1", r));
    try {
      const caps = await req("/api/source-import/capabilities");
      assert.equal(caps.status, 200); assert.deepEqual(caps.json.native, ["odata", "successfactors", "kafka", "powerbi", "informatica"]); assert.equal(caps.json.inspector, true, "INSPECTOR_URL defaults to the local inspector"); assert.equal(caps.json.inspectorReachable, false, "no inspector running in the test");
      let r = await req("/api/source-import/inspect", { method: "POST", body: { mode: "odata", url: "http://127.0.0.1:3994/svc", user: "u", password: "p", sapClient: "100" } });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.schemas[0].name, "E2E"); assert.deepEqual(r.json.schemas[0].tables[0].columns, [{ name: "id", type_text: "INT32", nullable: false, isPK: true, comment: "" }, { name: "note", type_text: "STRING", nullable: true, isPK: false, comment: "free text" }]);
      r = await req("/api/source-import/inspect", { method: "POST", body: { mode: "odata", url: "http://127.0.0.1:3994/svc", user: "u", password: "wrong", sapClient: "100" } });
      assert.equal(r.status, 502); assert.match(r.json.error, /refused the credentials \(HTTP 401\)/);
      r = await req("/api/source-import/inspect", { method: "POST", body: { mode: "kafka", url: "http://127.0.0.1:3994", schema: "events" } });
      assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.schemas[0].name, "events"); assert.equal(r.json.schemas[0].tables[0].type, "TOPIC"); assert.deepEqual(r.json.schemas[0].tables[0].columns.map((c) => c.name), ["id", "amount"]); assert.equal(r.json.schemas[0].tables[0].columns[1].nullable, true);
      r = await req("/api/source-import/inspect", { method: "POST", body: { mode: "odata" } });
      assert.equal(r.status, 400); assert.match(r.json.error, /OData service URL is required/);
      r = await req("/api/source-import/inspect", { method: "POST", body: { mode: "duckdb", path: "/x.duckdb" } });
      assert.equal(r.status, 502); assert.match(r.json.error, /inspector service is not reachable/);
      assert.ok(seen.includes("/subjects"), "the schema registry was called");
      const audit = await req("/api/audit?type=system&limit=10");
      assert.ok(audit.json.entries.some((e) => e.action === "imported" && e.name === "source load via odata http://127.0.0.1:3994/svc"), JSON.stringify(audit.json.entries.slice(0, 2)));
    } finally { fake.close(); }
  });
});
