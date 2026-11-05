/* Scheduled Unity Catalog synchronisation with drift detection (v1.59, PLAN.md item 6).
   A sync profile names a workspace, a catalog and the data hub it lands in; the sync reads schemas, tables and
   columns through the Databricks REST API (PAT, a service principal of its own, or the app's identity in Databricks
   Apps), compares them with the catalog and either applies the differences (mode "apply": new schemas / tables /
   columns, changed column types, optionally removals) or only reports them (mode "report"). Either way the drift is
   recorded on the profile and the effective stewards / owners of the affected tables get a notification in their
   language (admins when nobody is responsible). Writes go through applyChanges — delta saves with conflict
   detection, audited as "Unity Catalog sync <profile>". */
import { emailSet } from "./users.js";
import { assembleLite, attributesOfTables, applyChanges } from "./catalog-store.js";
import { changesBetween } from "../catalog-diff.js";
import { importUnity, applyUnityTags } from "../src/lib/catalog-ops.js";
import { catalogIndex, effStewardId, effOwnerId } from "../permissions.js";
import { notifyI18n, emailsByRole } from "./mail.js";
import { sysAudit } from "./audit.js";
import { runWriteBack } from "./uc-writeback-run.js";
import { fetchUnity, fetchUnityTags } from "./unity-client.js";
import { SYSTEM, syncProfiles, recordRun, hostOf, dueProfiles, profileSchedules, warehouseOf } from "./sync-profiles.js";
import { accountEmailOf } from "./people.js";
export const UC_SYNC_TASK = { description: "Unity Catalog synchronisation — the profiles that are due (body { profileId } runs one profile regardless of its schedule)",
  schedule: async () => profileSchedules(await syncProfiles()),   /* v1.74 (F-S3): was the literal "manual" although due() fires it */
  run: async (user, body) => (body?.profileId ? { runs: [{ id: body.profileId, ...(await runSync(String(body.profileId), user)) }] } : { runs: await runDueSyncs(user) }),
  /* v1.73 (F-S9): the schedules are per profile — the task is due whenever at least one profile is (checked every tick) */
  due: async (now) => dueProfiles(await syncProfiles(), now).length > 0, actor: SYSTEM };

/* ── drift (pure): what Unity Catalog has that the catalog lacks, and vice versa ── */
export const computeDrift = (catalog, catalogName, schemasPayload, { updateTypes = true } = {}) => {
  const d = (catalog.databases || []).find((x) => x.name === catalogName && x.source === "unity");
  const drift = { newSchemas: [], newTables: [], newColumns: [], removedTables: [], removedColumns: [], changedTypes: [], database: d ? d.id : null };
  const scs = d ? (catalog.schemas || []).filter((s) => s.databaseId === d.id) : [];
  const tbsOf = new Map(); for (const t of catalog.tables || []) { if (!tbsOf.has(t.schemaId)) tbsOf.set(t.schemaId, []); tbsOf.get(t.schemaId).push(t); }
  const atsOf = new Map(); for (const a of catalog.attributes || []) { if (!atsOf.has(a.tableId)) atsOf.set(a.tableId, []); atsOf.get(a.tableId).push(a); }
  const seenSc = new Set(), seenTb = new Set();
  for (const scP of schemasPayload) {
    const sc = scs.find((x) => x.name === scP.name);
    if (!sc) { drift.newSchemas.push(scP.name); for (const t of scP.tables || []) { drift.newTables.push(`${scP.name}.${t.name}`); for (const c of t.columns || []) drift.newColumns.push(`${scP.name}.${t.name}.${c.name}`); } continue; }
    seenSc.add(sc.id);
    for (const tbP of scP.tables || []) {
      const tb = (tbsOf.get(sc.id) || []).find((x) => x.name === tbP.name);
      if (!tb) { drift.newTables.push(`${scP.name}.${tbP.name}`); for (const c of tbP.columns || []) drift.newColumns.push(`${scP.name}.${tbP.name}.${c.name}`); continue; }
      seenTb.add(tb.id);
      const have = atsOf.get(tb.id) || [], seenAt = new Set();
      for (const c of tbP.columns || []) {
        const at = have.find((x) => x.name === c.name);
        if (!at) { drift.newColumns.push(`${scP.name}.${tbP.name}.${c.name}`); continue; }
        seenAt.add(at.id);
        const ucType = c.type_text || c.type_name || "STRING";
        if (updateTypes && at.dataType && ucType && String(at.dataType).toUpperCase() !== String(ucType).toUpperCase()) drift.changedTypes.push({ path: `${scP.name}.${tbP.name}.${c.name}`, from: at.dataType, to: ucType, attributeId: at.id, tableId: tb.id });
      }
      for (const at of have) if (!seenAt.has(at.id)) drift.removedColumns.push({ path: `${scP.name}.${tbP.name}.${at.name}`, attributeId: at.id, tableId: tb.id });
    }
    for (const tb of tbsOf.get(sc.id) || []) if (!seenTb.has(tb.id)) drift.removedTables.push({ path: `${sc.name}.${tb.name}`, tableId: tb.id });
  }
  drift.counts = { newSchemas: drift.newSchemas.length, newTables: drift.newTables.length, newColumns: drift.newColumns.length, removedTables: drift.removedTables.length, removedColumns: drift.removedColumns.length, changedTypes: drift.changedTypes.length };
  drift.total = Object.values(drift.counts).reduce((a, b) => a + b, 0);
  return drift;
};

/* ── one run ── */
/* v1.74 (F-S3 of the third review): one run per profile at a time — the scheduler, the uc-sync task and the
   "Run now" button share this guard (409 while a run of the same profile is in progress) */
const syncing = new Set();
export const isSyncRunning = (id) => syncing.has(id);
export const runSync = async (profileOrId, user = SYSTEM, opts = {}) => {
  const p = typeof profileOrId === "string" ? (await syncProfiles()).find((x) => x.id === profileOrId) : profileOrId;
  if (!p) throw Object.assign(new Error("Unknown sync profile"), { status: 404 });
  if (syncing.has(p.id)) throw Object.assign(new Error(`Sync profile "${p.name}" is already running`), { status: 409 });
  syncing.add(p.id);
  try { return await runSyncNow(p, user, opts); } finally { syncing.delete(p.id); }
};
const runSyncNow = async (p, user, { fetchImpl = fetch, unity = null, onPhase = null, onProgress = null } = {}) => {
  const t0 = Date.now();
  let result;
  try {
    if (onPhase) onPhase("fetching");
    const { schemasPayload, lineagePairs } = unity || await fetchUnity(p, { fetchImpl, onProgress });
    /* v1.66: governance tags (Sensitivity, Classification, Data Owner / Steward / Domain) through the profile's warehouse — best effort */
    let tagData = null, tagError = null;
    if (!unity && p.mode === "apply") { try { tagData = await fetchUnityTags(p, { fetchImpl }); } catch (e) { tagError = e.message; } }
    if (onPhase) onPhase("diffing");
    const { catalog: prev } = await assembleLite();
    if (!prev) throw new Error("The catalog is not initialised");
    const db = prev.databases.find((x) => x.name === p.catalog && x.source === "unity");
    const dbTableIds = db ? prev.tables.filter((t) => prev.schemas.some((s) => s.databaseId === db.id && s.id === t.schemaId)).map((t) => t.id) : [];
    prev.attributes = await attributesOfTables(dbTableIds);
    const drift = computeDrift(prev, p.catalog, schemasPayload, { updateTypes: p.updateTypes });
    let applied = 0, version = null;
    if (p.mode === "apply" && (drift.total > 0 || !db || tagData)) {
      const next = structuredClone(prev);
      const workspace = hostOf(p).replace(/^https?:\/\//, "");
      const sourceRef = { kind: "unity", host: workspace, sync: p.id, ...(warehouseOf(p) ? { warehouse: warehouseOf(p) } : {}) };
      importUnity(next, { catalogName: p.catalog, schemasPayload, workspace, hubId: p.hubId, lineagePairs, country: p.country, layer: p.layer, sourceRef });
      if (tagData) applyUnityTags(next, p.catalog, tagData);
      if (db) keepSourceRefUnlessChanged(next, db);
      if (p.updateTypes) for (const ch of drift.changedTypes) { const at = next.attributes.find((a) => a.id === ch.attributeId); if (at) at.dataType = ch.to; }
      if (p.deleteMissing) {
        const goneTb = new Set(drift.removedTables.map((x) => x.tableId)), goneAt = new Set(drift.removedColumns.map((x) => x.attributeId));
        next.tables = next.tables.filter((t) => !goneTb.has(t.id));
        next.attributes = next.attributes.filter((a) => !goneAt.has(a.id) && !goneTb.has(a.tableId));
        next.lineage = (next.lineage || []).filter((l) => !goneTb.has(l.from) && !goneTb.has(l.to));
      }
      const changes = changesBetween(prev, next);
      if (changes.length) {
        if (onPhase) onPhase("writing");
        const r = await applyChanges({ ...user, name: `${user.name} · UC sync ${p.name}` }, changes, { authorize: false });
        applied = changes.length; version = r.version ?? null;
      }
    }
    const notified = drift.total ? await notifyDrift(p, prev, drift).catch((e) => { console.error("drift notify:", e.message); return 0; }) : 0;
    result = { at: Date.now(), ms: Date.now() - t0, ok: true, mode: p.mode, counts: drift.counts, total: drift.total, applied, version, notified, tags: tagData ? true : tagError ? `not read: ${tagError}` : false,
      samples: { newTables: drift.newTables.slice(0, 20), newColumns: drift.newColumns.slice(0, 20), removedTables: drift.removedTables.map((x) => x.path).slice(0, 20), removedColumns: drift.removedColumns.map((x) => x.path).slice(0, 20), changedTypes: drift.changedTypes.slice(0, 20).map(({ path, from, to }) => ({ path, from, to })) } };
    await sysAudit(user, "system", applied ? "imported" : "verified", `Unity Catalog sync ${p.name} (${p.catalog}): ${drift.total} difference(s)${applied ? `, ${applied} change(s) applied` : p.mode === "report" ? " reported" : ""}`);
  } catch (e) {
    result = { at: Date.now(), ms: Date.now() - t0, ok: false, error: e.message };
    await sysAudit(user, "system", "failed", `Unity Catalog sync ${p.name}: ${e.message}`);
  }
  if (p.id) await recordRun(p.id, result);
  /* v1.64: push catalog metadata back to Unity Catalog after a successful run when the profile says so */
  if (result.ok && p.writeBack?.enabled) {
    result.writeBack = await runWriteBack(p, user, { fetchImpl });
  }
  return result;
};

/* the sourceRef's lastUsed stamp alone is no change worth a version and an audit entry: keep the stored record when
   nothing else differs (compared with sorted keys — key order differs between JSONB and JS objects) */
const keepSourceRefUnlessChanged = (next, db) => {
  const dn = next.databases.find((x) => x.id === db.id);
  const strip = (r) => { const o = { ...(r || {}), lastUsed: 0 }; return JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]])); };
  if (dn && strip(dn.sourceRef) === strip(db.sourceRef)) dn.sourceRef = db.sourceRef;
};

/* stewards / owners of the affected tables (accounts matched by e-mail), admins as fallback — one message each, localized */
const notifyDrift = async (p, catalog, drift) => {
  const ix = catalogIndex(catalog);
  const accounts = await emailSet();
  const personEmail = (pid) => accountEmailOf(catalog, pid, accounts);
  const perEmail = new Map();
  const add = (email, line) => { if (!email) return false; if (!perEmail.has(email)) perEmail.set(email, []); perEmail.get(email).push(line); return true; };
  const unassigned = [];
  const route = (tableId, line) => {
    const emails = tableId ? [personEmail(effStewardId(catalog, "table", tableId, ix)), personEmail(effOwnerId(catalog, "table", tableId, ix))].filter(Boolean) : [];
    if (!emails.length || !tableId) { if (drift.database) { const dbo = personEmail(effOwnerId(catalog, "database", drift.database, ix)), dbs = personEmail(effStewardId(catalog, "database", drift.database, ix)); if (dbo || dbs) { for (const e of new Set([dbo, dbs].filter(Boolean))) add(e, line); return; } } unassigned.push(line); return; }
    for (const e of new Set(emails)) add(e, line);
  };
  for (const t of drift.newTables) route(null, { kind: "newTable", path: t });
  /* v1.73 (F-S8): "schema.table" → table of the synced database, built once (was a scan per new column) */
  const schemaOf = new Map((catalog.schemas || []).map((s) => [s.id, s]));
  const tableByPath = new Map();
  for (const t of catalog.tables || []) {
    const sc = schemaOf.get(t.schemaId);
    if (sc?.databaseId !== drift.database) continue;
    const key = `${sc.name}.${t.name}`;
    if (!tableByPath.has(key)) tableByPath.set(key, t);   /* first match wins, as with the former find() */
  }
  for (const c of drift.newColumns) route(tableByPath.get(c.split(".").slice(0, 2).join("."))?.id || null, { kind: "newColumn", path: c });
  for (const r of drift.removedTables) route(r.tableId, { kind: "removedTable", path: r.path });
  for (const r of drift.removedColumns) route(r.tableId, { kind: "removedColumn", path: r.path });
  for (const ch of drift.changedTypes) route(ch.tableId, { kind: "changedType", path: ch.path, from: ch.from, to: ch.to });
  if (unassigned.length) for (const e of await emailsByRole("admin")) for (const line of unassigned) add(String(e).toLowerCase(), line);
  let n = 0;
  for (const [email, items] of perEmail) n += await notifyI18n([email], "Unity Catalog sync", "uc_drift", { profile: p.name, catalog: p.catalog, mode: p.mode, items: items.slice(0, 40), more: Math.max(0, items.length - 40) }, {});
  return n;
};

/* ── the profiles that are due (hourly, or daily at their time) — the task scheduler (server/tasks.js) checks every minute ── */
export const runDueSyncs = async (user = SYSTEM) => {
  const out = [];
  for (const p of dueProfiles(await syncProfiles())) {
    if (syncing.has(p.id)) { out.push({ id: p.id, name: p.name, skipped: "already running" }); continue; }
    out.push({ id: p.id, name: p.name, ...(await runSync(p, user)) });
  }
  return out;
};
