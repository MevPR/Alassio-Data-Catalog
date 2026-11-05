/* Server-side Unity Catalog write-back (v1.64): the same diff + operations as the browser dialog (uc-writeback.js),
   run with a sync profile's credentials — scheduled after each sync run (profile.writeBack.enabled) or on demand
   (POST /admin/sync/profiles/:id/writeback). The browser stays out of it, so it also works from a Databricks Job and
   with the app's own service principal. Only metadata, only differences, never creates or deletes objects.
   v1.73 (F-S12): renamed from server/uc-writeback.js (the browser-shared engine keeps the name uc-writeback.js at the
   root); ucRequester moved to server/unity-client.js.
   v1.77: changes belong to the user who made them. `scope: "mine"` (every user-triggered run) writes only the
   operations the caller authored — plus the unattributed ones for admins — and reports the rest per author
   (server/writeback-authors.js); `scope: "all"` is the automatic write-back after a sync run and the task. A profile
   runs one write-back at a time (409). */
import { assembleLite, attributesOfTables } from "./catalog-store.js";
import { sysAudit } from "./audit.js";
import { systemActor } from "./config.js";
import { syncProfiles, recordWriteBack, warehouseOf } from "./sync-profiles.js";
import { ucRequester } from "./unity-client.js";
import { readUnityState, buildWriteBackOps, executeWriteBackOps, makeSqlRunner } from "../uc-writeback.js";
import { attributeOps, mayWrite, pendingSummary } from "./writeback-authors.js";

const SYSTEM = systemActor("Unity Catalog write-back");

/* preview (dryRun) or execute the write-back of the profile's catalog */
const writing = new Set();
export const runWriteBack = async (profileOrId, user = SYSTEM, { fetchImpl = fetch, dryRun = false, scope = "all" } = {}) => {
  const p = typeof profileOrId === "string" ? (await syncProfiles()).find((x) => x.id === profileOrId) : profileOrId;
  if (!p) throw Object.assign(new Error("Unknown sync profile"), { status: 404 });
  if (!dryRun && writing.has(p.id)) throw Object.assign(new Error(`A write-back of "${p.name}" is already running`), { status: 409 });
  if (!dryRun) writing.add(p.id);
  try { return await writeBackNow(p, user, { fetchImpl, dryRun, scope }); } finally { writing.delete(p.id); }
};
const writeBackNow = async (p, user, { fetchImpl, dryRun, scope }) => {
  const t0 = Date.now();
  const mine = scope === "mine";
  let result;
  try {
    const { catalog: state } = await assembleLite();
    if (!state) throw new Error("The catalog is not initialised");
    const db = state.databases.find((x) => x.name === p.catalog && x.source === "unity");
    if (!db) throw new Error(`Catalog ${p.catalog} is not in the data catalog yet — run the sync first`);
    /* v1.74 (F-S4 of the third review): grouped once — filtering every attribute per table was quadratic
       (~10⁹ comparisons for 5 000 tables / 200 000 attributes on the event loop) */
    const schemaIds = new Set(state.schemas.filter((s) => s.databaseId === db.id).map((s) => s.id));
    const tableIds = state.tables.filter((t) => schemaIds.has(t.schemaId)).map((t) => t.id);
    const byTable = Map.groupBy(await attributesOfTables(tableIds), (a) => a.tableId);
    const attributesOf = async (tableId) => byTable.get(tableId) || [];
    const ucReq = await ucRequester(p, fetchImpl);
    const wb = p.writeBack || {};
    const wh = warehouseOf(p);   /* v1.66: the profile's warehouse (legacy writeBack.warehouseId still honoured) */
    const runSqlQ = wh ? makeSqlRunner(ucReq, wh) : null;
    const uc = await readUnityState(p.catalog, { ucReq, runSqlQ });
    const all = await buildWriteBackOps({ state, db, attributesOf, options: { comments: wb.comments !== false, roles: wb.roles !== false, columns: wb.columns !== false, owner: !!wb.owner }, uc });
    let ops = all, pending = null;
    if (mine) {
      await attributeOps(all);
      pending = pendingSummary(all, user);
      ops = all.filter((o) => mayWrite(o, user));
    }
    const log = dryRun
      ? (mine ? all : ops).map((o) => ({ ok: true, label: o.label, planned: true, ...(mine ? { author: o.author ? { id: o.author.id, name: o.author.name, ts: o.author.ts } : null, mine: mayWrite(o, user) } : {}) }))
      : await executeWriteBackOps(ops, { ucReq, runSqlQ });
    const failed = log.filter((l) => !l.ok).length;
    const skipped = all.skippedSql || 0;   /* SQL-only changes left out because the profile has no SQL warehouse (v1.64.1) */
    result = { at: Date.now(), ms: Date.now() - t0, ok: failed === 0, dryRun, scope, total: ops.length, written: dryRun ? 0 : ops.length - failed, failed, skipped, tagsReadable: !!all.tagsReadable, ...(pending ? { pending } : {}), log: log.slice(0, mine && dryRun ? 500 : 100) };
    if (!dryRun) await sysAudit(user, "system", failed ? "failed" : "exported", `Unity Catalog write-back ${p.name} (${p.catalog}): ${ops.length - failed} of ${ops.length} change(s) written${failed ? `, ${failed} failed` : ""}${skipped ? `, ${skipped} skipped (no SQL warehouse)` : ""}${mine ? " (own changes)" : ""}`);
  } catch (e) {
    result = { at: Date.now(), ms: Date.now() - t0, ok: false, dryRun, error: e.message, total: 0, written: 0, failed: 0, skipped: 0, log: [] };
    if (!dryRun) await sysAudit(user, "system", "failed", `Unity Catalog write-back ${p.name}: ${e.message}`);
  }
  if (p.id && !dryRun) await recordWriteBack(p.id, { ...result, log: result.log.slice(0, 100) });
  return result;
};

/* registered as task "uc-writeback" by server.js (v1.70) */
export const UC_WRITEBACK_TASK = { description: "Unity Catalog write-back — pushes catalog metadata of one sync profile to UC (body { profileId }, optional { dryRun: true })", schedule: "manual",
  run: async (user, body) => { if (!body?.profileId) throw Object.assign(new Error("profileId is required"), { status: 400 }); return runWriteBack(String(body.profileId), user, { dryRun: !!body.dryRun }); } };
