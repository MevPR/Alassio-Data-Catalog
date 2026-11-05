/**
 * E2E — operations: backups (SQL dump, restore drill, restore job, retention), health endpoint, task registry and TASKS_TOKEN.
 * v1.73 (F-T6): split out of the former server.e2e.test.mjs. This file resets the test database, boots its own server
 * on port 3986 (E2E_PORT_BASE + 6), bootstraps the admin, seeds hub → e2e_gold → prod → kpi and removes it again.
 * Run alone: DB_USER=… DB_PASSWORD=… DB_NAME=datahub_catalog_test node --test test/e2e/ops.e2e.test.mjs
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { requireDb, startSuite, cleanupTree } from "./helpers.mjs";

let S;   /* the running suite: { base, c (cookie client), m (MCP client), hubName, seeded, stop } */
const req = (...a) => S.c.req(...a);
const tool = (...a) => S.m.tool(...a);

describe("E2E ops", { skip: requireDb() }, () => {
  before(async () => {
    S = await startSuite({ name: "ops" });
  });
  after(async () => { if (S) { await cleanupTree(S.m, S.hubName); await S.stop(); } });

  test("backups: settings, on-demand backup with SQL dump, restore drill, restore job, download, retention, job history", async () => {
    let r = await req("/admin/backups/settings", { method: "PUT", body: { enabled: true, time: "25:99" } });
    assert.equal(r.status, 400);
    r = await req("/admin/backups/settings", { method: "PUT", body: { enabled: true, time: "02:15", keep: 2, sql: true } });
    assert.equal(r.status, 200); assert.deepEqual(r.json.settings, { enabled: true, time: "02:15", keep: 2, sql: true });
    r = await req("/admin/backups", { method: "POST" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const b = r.json.backup;
    assert.match(b.fileName, /^cortex-backup-\d{8}-\d{6}\.json\.gz$/); assert.ok(b.size > 100); assert.equal(b.kind, "manual"); assert.ok(b.counts.tables >= 1);
    const list = (await req("/admin/backups")).json;
    assert.ok(list.backups.some((x) => x.id === b.id)); assert.equal(list.settings.keep, 2);
    if (list.mysqldump) { assert.ok(b.sqlFile && b.sqlSize > 100, `SQL dump expected: ${JSON.stringify(b)}`); }
    /* restore drill */
    const v = (await req(`/admin/backups/${b.id}/verify`, { method: "POST" })).json.backup;
    assert.equal(v.verify.ok, true, JSON.stringify(v.verify)); assert.ok(v.verifiedAt);
    assert.deepEqual(v.verify.drift, {}, "nothing changed since the backup");
    assert.ok(v.verify.checks.some((c) => c.name === "integrity" && c.ok));
    if (b.sqlFile) assert.ok(v.verify.checks.some((c) => c.name === "sql" && c.ok));
    /* change something, verify again → drift reported */
    assert.equal((await tool("create_table", { schema: "e2e_gold.prod", name: "after_backup" })).isError, false);
    const v2 = (await req(`/admin/backups/${b.id}/verify`, { method: "POST" })).json.backup;
    assert.equal(v2.verify.drift.tables, 1);
    /* restore from the backup file: the extra table disappears again */
    r = await req(`/admin/backups/${b.id}/restore`, { method: "POST" });
    assert.equal(r.status, 200); const job = r.json.job; assert.equal(job.kind, "dump");
    let j; for (let i = 0; i < 60; i++) { await new Promise((x) => setTimeout(x, 500)); j = (await req(`/api/import/jobs/${job.id}`)).json.job; if (["done", "error"].includes(j.status)) break; }
    assert.equal(j.status, "done", j.error); assert.equal(j.counts.deleted, 1);
    assert.ok(!(await req("/api/catalog")).json.catalog.tables.some((t) => t.name === "after_backup"));
    assert.ok((await req("/admin/backups")).json.backups.some((x) => x.id === b.id), "restoring keeps the backup file");
    /* downloads are gzip files */
    const dl = await req(`/admin/backups/${b.id}/download`, { raw: true });
    assert.equal(dl.status, 200); const bytes = Buffer.from(await dl.arrayBuffer()); assert.deepEqual([bytes[0], bytes[1]], [0x1f, 0x8b]);
    /* job history is mirrored to the database (survives restarts): the restore job is listed with its counts */
    const jobs = (await req("/api/import/jobs")).json.jobs;
    const mine = jobs.find((x) => x.id === job.id); assert.ok(mine); assert.equal(mine.status, "done"); assert.equal(mine.counts.deleted, 1);
    /* retention only touches automatic backups; manual ones are deleted explicitly */
    assert.equal((await req(`/admin/backups/${b.id}`, { method: "DELETE" })).json.ok, true);
    assert.ok(!(await req("/admin/backups")).json.backups.some((x) => x.id === b.id));
    assert.equal((await req(`/admin/backups/${b.id}/verify`, { method: "POST" })).status, 404);
    await req("/admin/backups/settings", { method: "PUT", body: { enabled: false } });
  });

  test("ops: health endpoint, task registry, API-triggered tasks with admin session and TASKS_TOKEN", async () => {
    const anon = await (await fetch(S.base + "/healthz")).json(); assert.equal(anon.ok, true); assert.equal(anon.db, undefined, "v1.66.1: anonymous healthz carries no details"); assert.equal(anon.copyright, undefined, "v1.79.4: no copyright field");
    const h = await req("/healthz", { raw: true }); assert.equal(h.status, 200);
    const hj = typeof h.json === "function" ? await h.json() : h.json; assert.equal(hj.ok, true); assert.equal(hj.status, "ready"); assert.ok(hj.db.ok && hj.db.catalogVersion >= 1); assert.ok(hj.version); assert.equal(hj.scheduler, "internal"); assert.equal(hj.identity, "local");
    assert.equal((await fetch(S.base + "/admin/tasks")).status, 401, "anonymous cannot list tasks");
    const list = (await req("/admin/tasks")).json;
    assert.deepEqual(list.tasks.map((t) => t.name).sort(), ["backup", "housekeeping", "stewardship-reminders", "uc-sync", "uc-writeback", "usage-purge"]);
    const hk = await req("/admin/tasks/housekeeping/run", { method: "POST", body: {} });   /* v1.67 */
    assert.equal(hk.status, 200, JSON.stringify(hk.json)); assert.equal(typeof hk.json.result.oauthTokens, "number"); assert.equal(typeof hk.json.result.sessions, "number");
    let run = await req("/admin/tasks/usage-purge/run", { method: "POST", body: { keepDays: 400 } });
    assert.equal(run.status, 200, JSON.stringify(run.json)); assert.equal(run.ok, undefined); assert.equal(run.json.ok, true); assert.equal(typeof run.json.result.deleted, "number");
    assert.equal((await req("/admin/tasks/nope/run", { method: "POST", body: {} })).status, 404);
    /* an external scheduler authenticates with the TASKS_TOKEN bearer — no session, no CSRF */
    const ext = await fetch(S.base + "/admin/tasks/stewardship-reminders/run", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer e2e-tasks-token" }, body: "{}" });
    assert.equal(ext.status, 200, await ext.clone().text()); const ej = await ext.json(); assert.equal(ej.task, "stewardship-reminders"); assert.equal(typeof ej.result.messages, "number");
    assert.equal((await fetch(S.base + "/admin/tasks/backup/run", { method: "POST", headers: { Authorization: "Bearer wrong" } })).status, 401);
    /* v1.61: the token may travel in X-Tasks-Token when Authorization is consumed by an authenticating platform (Databricks Apps) */
    const viaHeader = await fetch(S.base + "/admin/tasks/usage-purge/run", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer some-platform-token", "X-Tasks-Token": "e2e-tasks-token" }, body: "{}" });
    assert.equal(viaHeader.status, 200, await viaHeader.clone().text());
    assert.equal((await fetch(S.base + "/admin/tasks/usage-purge/run", { method: "POST", headers: { "X-Tasks-Token": "wrong" } })).status, 401);
    const after = (await req("/admin/tasks")).json.tasks;
    assert.ok(after.find((t) => t.name === "usage-purge").lastRun.ok); assert.equal(after.find((t) => t.name === "stewardship-reminders").lastRun.by, "system");
    const bk = await req("/admin/tasks/backup/run", { method: "POST", body: {} });
    assert.equal(bk.status, 200, JSON.stringify(bk.json)); assert.match(bk.json.result.file, /^cortex-backup-.*\.json\.gz$/);
    const backups = (await req("/admin/backups")).json; assert.equal(backups.storage.provider, "local"); assert.ok(backups.backups.some((b) => b.fileName === bk.json.result.file && b.kind === "auto"));
    for (const b of backups.backups.filter((x) => x.fileName === bk.json.result.file)) await req(`/admin/backups/${b.id}`, { method: "DELETE" });
  });
});
