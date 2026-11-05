/* The shared catalog: assembling the document from the relational tables, FULLTEXT search, whole-document
   writes (restore) and delta writes with per-object conflict detection (phase 2).

   Phase 4 (v1.56): the full document is no longer built for writes. Delta saves, bulk imports and the MCP tools work
   on the lite document (every collection except the attributes) and load attributes per table on demand; the dump
   restore diffs one collection at a time. The complete document (assembleCatalog) is assembled only for small
   catalogs (/api/catalog without lazy loading, routes/catalog.js); dump export, OKF bundle, search, imports, the
   marketplace workflow and the permission checks use assembleLite() + attributes per table (v1.71). */
import { q, pool, sql } from "./db.js";
import { LAZY_ATTRIBUTES } from "./config.js";
import { COLL, CAT_TABLES, TYPE_TO_TABLE, searchTextOf } from "./catalog-tables.js";
import { insertAudit } from "./audit.js";
import crypto from "crypto";
import { diffCollection, catalogMaps, entriesForChanges, entriesForCreated, auditUserRef, canon } from "../catalog-diff.js";

/* the JSON payload of a catalog row (MariaDB returns TEXT, PostgreSQL may hand back the parsed object) */
const rowData = (r) => (typeof r.data === "string" ? JSON.parse(r.data) : r.data);
import { authorizeChanges } from "../permissions.js";

let liteCache = null; /* { version, catalog (without attributes), stats } — shared by /api/catalog, delta saves and MCP */
const runOf = (conn) => conn ? (s, p) => conn.query(s, p).then((r) => r[0]) : q;
export const currentVersion = async (conn = null) => { const m = (await runOf(conn)("SELECT version FROM catalog_meta WHERE id = 1"))[0]; return m ? Number(m.version) : 0; };

let asmCache = null; /* { version, catalog } — kept only for catalogs the UI reads in full (≤ LAZY_ATTRIBUTES attributes) */
export const assembleCatalog = async (conn) => {
  const run = runOf(conn);
  const meta = (await run("SELECT * FROM catalog_meta WHERE id = 1"))[0];
  if (!meta) return { catalog: null, version: 0 };
  const version = Number(meta.version);
  if (!conn && asmCache && asmCache.version === version) return { catalog: structuredClone(asmCache.catalog), version };
  const catalog = { ...(meta.extra ? (typeof meta.extra === "string" ? JSON.parse(meta.extra) : meta.extra) : {}) };
  for (const [key, tbl] of COLL) catalog[key] = await readCollection(run, tbl);
  if (!conn) asmCache = catalog.attributes.length <= LAZY_ATTRIBUTES ? { version, catalog: structuredClone(catalog) } : null;
  return { catalog, version };
};
/* rows of one collection in document order. Sorted in JS: ORDER BY seq, id makes MariaDB filesort the JSON payloads
   (10+ s for 400k attributes) while an unordered read takes about a second. */
const readCollection = async (run, tbl) => {
  const rows = await run(`SELECT seq, id, data FROM ${tbl}`);
  rows.sort((a, b) => (a.seq - b.seq) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rows.map((r) => (rowData(r)));
};
const metaOf = (c) => c.extra ? (typeof c.extra === "string" ? JSON.parse(c.extra) : c.extra) : {};

/* inside a write transaction (catalog_meta locked FOR UPDATE at `version`): the lite document — every collection
   except the attributes. The lite cache is current when its version matches, so a clone beats re-reading the rows. */
const assembleLiteLocked = async (conn, version) => {
  if (liteCache && liteCache.version === version) return structuredClone(liteCache.catalog);
  const run = runOf(conn);
  const meta = (await run("SELECT * FROM catalog_meta WHERE id = 1"))[0];
  const catalog = { ...metaOf(meta || {}) };
  for (const [key, tbl] of COLL) catalog[key] = key === "attributes" ? [] : await readCollection(run, tbl);
  return catalog;
};
/* attribute records of a set of tables (chunked IN lists), document order */
export const attributesOfTables = async (tableIds, conn = null) => {
  const run = runOf(conn);
  const ids = [...new Set((tableIds || []).filter(Boolean))];
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    const rows = await run(`SELECT seq, id, data FROM cat_attributes WHERE table_id IN (${part.map(() => "?").join(",")})`, part);
    rows.sort((a, b) => (a.seq - b.seq) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const r of rows) out.push(rowData(r));
  }
  return out;
};
/* v1.59: attributes streamed per table instead of assembled once. `attributeChunks(tables)` yields arrays of attribute
   records for `step` tables at a time (document order of the tables; orphaned attributes, if any, come last), and
   `makeAttrLoader(tables)` is an async accessor attrsOf(tableId) for exporters that walk the hierarchy — it prefetches
   the chunk of tables around the requested one and keeps only the last two chunks in memory. */
export async function* attributeChunks(tables, step = 200, conn = null) {
  const ids = (tables || []).map((t) => t.id);
  for (let i = 0; i < ids.length; i += step) yield await attributesOfTables(ids.slice(i, i + step), conn);
  const run = runOf(conn);
  const orphans = await run("SELECT a.seq, a.id, a.data FROM cat_attributes a LEFT JOIN cat_tables t ON t.id = a.table_id WHERE t.id IS NULL");
  if (orphans.length) { orphans.sort((a, b) => (a.seq - b.seq) || (a.id < b.id ? -1 : 1)); yield orphans.map((r) => (rowData(r))); }
}
export const makeAttrLoader = (tables, step = 200) => {
  const ids = (tables || []).map((t) => t.id), pos = new Map(ids.map((id, i) => [id, i]));
  const cache = new Map();   /* chunk index → Map(tableId → attrs) */
  return async (tableId) => {
    const p = pos.get(tableId);
    if (p === undefined) return [];
    const ci = Math.floor(p / step);
    if (!cache.has(ci)) {
      const part = ids.slice(ci * step, (ci + 1) * step);
      const by = new Map(part.map((id) => [id, []]));
      for (const a of await attributesOfTables(part)) (by.get(a.tableId) || by.set(a.tableId, []).get(a.tableId)).push(a);
      cache.set(ci, by);
      for (const k of [...cache.keys()].slice(0, -2)) cache.delete(k);
    }
    return cache.get(ci).get(tableId) || [];
  };
};

/* row-level FULLTEXT search shared by /api/search and the MCP search tool */
export const searchRows = async (term, limit = 50) => {
  const hits = [];
  for (const [, tbl, type] of COLL) {
    if (type === "lineage") continue;
    const s = sql.search(tbl, term, limit);
    if (!s) return [];
    const rows = await q(s.sql, s.params);
    for (const r of rows) hits.push({ type, id: r.id, name: r.name, score: Number(r.score), record: rowData(r) });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
};

/* Writes only the rows the diff engine reports as created/updated/deleted (multi-row statements in chunks).
   Row order: new rows get seq values after the table's current maximum (document order = insertion order), updated
   rows keep their seq, deletions leave gaps. With the previous row order per collection (`prevIds`: { key: [ids] })
   an explicit reordering of the remaining rows is detected and written in batches. `onProgress(done, total)` reports
   row writes for long imports. */
const CHUNK = 400;
export const persistCatalog = async (conn, prevIds, next, entries, newVersion, user, onProgress = null) => {
  const now = Date.now();
  const touched = new Set();
  const upserts = new Map();   /* table → [[t, rec, created?]] */
  const deletes = new Map();   /* table → ids */
  for (const e of entries) {
    const t = TYPE_TO_TABLE[e.entityType]; if (!t) continue;
    touched.add(e.entityId);
    if (e.action === "deleted") { if (!deletes.has(t.tbl)) deletes.set(t.tbl, []); deletes.get(t.tbl).push(e.entityId); continue; }
    if (e.after) { if (!upserts.has(t.tbl)) upserts.set(t.tbl, []); upserts.get(t.tbl).push([t, e.after, e.action === "created"]); }
  }
  for (const [tbl, ids] of deletes) {
    for (let i = 0; i < ids.length; i += CHUNK) { const part = ids.slice(i, i + CHUNK); await conn.query(`DELETE FROM ${tbl} WHERE id IN (${part.map(() => "?").join(",")})`, part); }
  }
  const total = [...upserts.values()].reduce((n, l) => n + l.length, 0);
  let done = 0;
  for (const [tbl, list] of upserts) {
    const pcol = CAT_TABLES[tbl];
    const cols = ["id", ...(pcol ? [pcol] : []), "name", "seq", "data", "search_text", "updated_at"];
    const [[mx]] = await conn.query(`SELECT COALESCE(MAX(seq), -1) AS m FROM ${tbl}`);
    let seq = Math.max(Number(mx.m), (next[list[0][0].key] || []).length - 1);
    for (let i = 0; i < list.length; i += CHUNK) {
      const chunk = list.slice(i, i + CHUNK);
      const vals = chunk.flatMap(([t, rec]) => [rec.id, ...(pcol ? [rec[t.parent] ?? null] : []), rec.name ?? null, ++seq, JSON.stringify(rec), searchTextOf(t.key, rec), now]);
      await conn.query(sql.upsert(tbl, cols, chunk.length, ["id"], cols.filter((c) => c !== "id" && c !== "seq")), vals);
      done += chunk.length;
      if (onProgress) onProgress(done, total);
    }
  }
  /* explicit reordering (rare — the UI never reorders): only when the relative order of the surviving rows changed */
  if (prevIds) {
    for (const [key, tbl] of COLL) {
      const nextIds = (next[key] || []).map((x) => x.id), nextSet = new Set(nextIds);
      const prevList = (prevIds[key] || []).filter((id) => nextSet.has(id)), prevSet = new Set(prevList);
      const common = nextIds.filter((id) => prevSet.has(id));
      if (common.length === prevList.length && common.every((id, i) => id === prevList[i])) continue;
      /* attributes are only ever shown per table: a dump written table by table (v1.59) interleaves them differently
         than the global seq order — that is no reorder as long as every table keeps its column order */
      if (key === "attributes") {
        const tableOf = new Map((next.attributes || []).map((a) => [a.id, a.tableId]));
        const seqs = (list) => { const m = new Map(); for (const id of list) { const t = tableOf.get(id); if (!m.has(t)) m.set(t, []); m.get(t).push(id); } return m; };
        const a = seqs(prevList), b = seqs(common);
        if ([...a.keys()].every((t) => { const x = a.get(t), y = b.get(t) || []; return x.length === y.length && x.every((id, i) => id === y[i]); })) continue;
      }
      const rows = nextIds.map((id, i) => [id, i]).filter(([id]) => !touched.has(id));
      for (let i = 0; i < rows.length; i += CHUNK) {
        const part = rows.slice(i, i + CHUNK);
        await conn.query(`UPDATE ${tbl} SET seq = CASE id ${part.map(() => `WHEN ? THEN ${sql.int()}`).join(" ")} END WHERE id IN (${part.map(() => "?").join(",")})`, [...part.flat(), ...part.map(([id]) => id)]);
      }
    }
  }
  const extra = Object.fromEntries(Object.entries(next).filter(([k]) => !COLL.some(([key]) => key === k)));
  await conn.query(sql.upsert("catalog_meta", ["id", "version", "extra", "updated_at", "updated_by"], 1, ["id"]), [1, newVersion, JSON.stringify(extra), now, user.email]);
};

/* audit entries of a bulk change: one summary entry above AUDIT_SUMMARY_ABOVE records (as the dump restore does) */
export const AUDIT_SUMMARY_ABOVE = 800;
export const summariseEntries = (entries, user, name, entityId = "bulk") =>
  entries.length > AUDIT_SUMMARY_ABOVE
    ? [{ id: crypto.randomUUID(), ts: Date.now(), user: auditUserRef(user), action: "imported", entityType: "system", entityId, name: `${name} (${entries.length} record changes)`, context: "", scope: [] }]
    : entries;

/* one-time migration: catalog_doc (JSON document, v1.3–v1.13) → relational tables */
export const migrateDocToRows = async () => {
  const meta = await q("SELECT id FROM catalog_meta WHERE id = 1");
  if (meta.length) return;
  const doc = await q("SELECT version, data FROM catalog_doc WHERE id = 1");
  if (!doc.length) return;
  const catalog = JSON.parse(doc[0].data);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const mu = { id: "migration", name: "migration", email: "migration" }, m = catalogMaps(catalog);
    const entries = COLL.flatMap(([key, , type]) => diffCollection(type, [], catalog[key] || [], mu, m, m));
    await persistCatalog(conn, null, catalog, entries, Number(doc[0].version), { email: "migration" });
    await conn.commit();
    console.log(`Migrated catalog document to relational tables (${entries.length} rows, version ${doc[0].version}); catalog_doc kept as read-only backup`);
  } catch (e) { await conn.rollback(); console.error("Relational migration failed:", e.message); throw e; }
  finally { conn.release(); }
};

/* fresh installation: create the (empty) catalog so delta saves and MCP can start from version 0 */
export const ensureCatalogMeta = async () => {
  if (!(await q("SELECT id FROM catalog_meta WHERE id = 1")).length) {
    await q("INSERT INTO catalog_meta (id, version, extra, updated_at, updated_by) VALUES (1, 0, '{}', ?, 'init')", [Date.now()]);
    console.log("Initialised empty catalog (version 0)");
  }
};

/* best effort: drop attachments whose glossary term no longer exists */
const cleanupGlossaryFiles = async (catalog) => {
  try {
    const ids = (catalog.glossary || []).map((t) => t.id);
    if (ids.length) await q(`DELETE FROM glossary_files WHERE term_id NOT IN (${ids.map(() => "?").join(",")})`, ids);
    else await q("DELETE FROM glossary_files");
  } catch (e) { console.error("glossary file cleanup:", e.message); }
};

/* whole-document write with optimistic locking (baseVersion = null skips the check). The previous document is never
   assembled: each collection is read, diffed against the new document and dropped again (`auditOverride(rowEntries)`
   lets the caller replace the audit entries, e.g. by one summary entry). */
export const writeCatalog = async (catalog, baseVersion, user, auditOverride, { onProgress = null, onPhase = null } = {}) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [metaRows] = await conn.query("SELECT version FROM catalog_meta WHERE id = 1 FOR UPDATE");
    const current = metaRows[0];
    if (current && baseVersion !== null && Number(current.version) !== Number(baseVersion)) {
      await conn.rollback();
      return { conflict: true, version: Number(current.version) };
    }
    const run = runOf(conn);
    if (onPhase) onPhase("diffing");
    /* context maps of the previous document need only databases, schemas and tables */
    const prevSmall = {};
    for (const key of ["databases", "schemas", "tables"]) prevSmall[key] = current ? await readCollection(run, COLL.find(([k]) => k === key)[1]) : [];
    const mPrev = catalogMaps(prevSmall), mNext = catalogMaps(catalog);
    const rowEntries = [], prevIds = {};
    for (const [key, tbl, type] of COLL) {
      const prevRows = !current ? [] : prevSmall[key] || await readCollection(run, tbl);
      prevIds[key] = prevRows.map((x) => x.id);
      rowEntries.push(...diffCollection(type, prevRows, catalog[key] || [], user, mPrev, mNext));
      delete prevSmall[key];
    }
    const entries = auditOverride ? auditOverride(rowEntries) : rowEntries;  // drives the audit trail
    const newVersion = current ? Number(current.version) + 1 : 1;
    await persistCatalog(conn, current ? prevIds : null, catalog, rowEntries, newVersion, user, onProgress);
    await insertAudit(conn, entries);
    if (onPhase) onPhase("committing");
    await conn.commit();
    await cleanupGlossaryFiles(catalog);
    return { version: newVersion, audited: entries.length, rows: rowEntries.length };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

/* Delta write with per-object conflict detection (phase 2).
   changes: [{ entityType, action: created|updated|deleted, id, before?, after? }]
   A change conflicts only if the object it touches was changed by someone else since the client saw it
   (DB row ≠ before); other users' edits on other objects never block.
   v1.73 (F-S2): returns { ok: true, version, applied }; refusals throw an Error carrying `status` (409 conflict / not
   initialised, 403 not allowed) plus `conflicts` or `violations` — the callers (route, MCP, jobs) shape their own answer. */
/* a refused delta save: the transaction is rolled back by the catch below */
const refusal = (status, message, extra) => Object.assign(new Error(message), { status }, extra);
export const applyChanges = async (user, changes, { authorize = true } = {}) => {
  if (!changes.length) return { ok: true, version: await currentVersion(), applied: 0 };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [metaRows] = await conn.query("SELECT version FROM catalog_meta WHERE id = 1 FOR UPDATE");
    if (!metaRows.length) throw refusal(409, "Catalog not initialised — reload", { conflicts: [] });
    const conflicts = [];
    for (const ch of changes) {
      const t = TYPE_TO_TABLE[ch.entityType];
      if (!t || !ch.id) { conflicts.push({ id: ch.id, entityType: ch.entityType, reason: "unknown entity type" }); continue; }
      /* v1.66.1 (security review): the record must carry the id the change names — otherwise a steward could overwrite a
         foreign row through the upsert by sending after.id = <victim id>; parent references must be plain strings */
      if (typeof ch.id !== "string" || ch.id.length > 64) { conflicts.push({ id: ch.id, entityType: ch.entityType, reason: "invalid id" }); continue; }
      if (ch.after && (typeof ch.after !== "object" || ch.after.id !== ch.id)) { conflicts.push({ id: ch.id, entityType: ch.entityType, reason: "record id does not match the change" }); continue; }
      if (ch.before && (typeof ch.before !== "object" || ch.before.id !== ch.id)) { conflicts.push({ id: ch.id, entityType: ch.entityType, reason: "record id does not match the change" }); continue; }
      if (ch.after && t.parent && ch.after[t.parent] !== undefined && ch.after[t.parent] !== null && typeof ch.after[t.parent] !== "string") { conflicts.push({ id: ch.id, entityType: ch.entityType, reason: "invalid parent reference" }); continue; }
      const [rows] = await conn.query(`SELECT data FROM ${t.tbl} WHERE id = ? FOR UPDATE`, [ch.id]);
      const cur = rows.length ? (typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data) : null;
      if (ch.action === "created" && cur) conflicts.push({ id: ch.id, entityType: ch.entityType, reason: "already exists" });
      else if (ch.action !== "created" && (!cur || canon(cur) !== canon(ch.before))) conflicts.push({ id: ch.id, entityType: ch.entityType, name: cur?.name || ch.before?.name, reason: cur ? "changed by someone else" : "deleted by someone else" });
    }
    if (conflicts.length) throw refusal(409, "Some objects were changed by someone else", { conflicts });
    const prev = await assembleLiteLocked(conn, Number(metaRows[0].version));   /* no attribute payloads — the gate and the audit context only need the containers */
    /* permission gate: role + people-based responsibilities (owners / stewards) */
    const violations = authorize ? authorizeChanges(prev, user, changes) : [];
    if (violations.length) throw refusal(403, "Not allowed: " + violations.map((x) => `${x.name || x.id} — ${x.reason}`).slice(0, 3).join("; "), { violations });
    /* cascade: deleting a database / schema / table removes its children and lineage edges even when the client
       never loaded them (lazy catalogs); the attributes of deleted tables are read from the database */
    const all = [...changes, ...(await cascadeDeletes(prev, changes, (ids) => attributesOfTables(ids, conn)))];
    /* apply the delta in place (the document is a private copy); deltas never reorder rows, so no sequence pass is needed */
    const next = prev;
    const byKey = new Map();   /* collection → { del: Set(ids), ups: [changes] } — one pass per collection, no per-change scans */
    for (const ch of all) {
      const key = TYPE_TO_TABLE[ch.entityType].key;
      if (!byKey.has(key)) byKey.set(key, { del: new Set(), ups: [] });
      const g = byKey.get(key); if (ch.action === "deleted") g.del.add(ch.id); else g.ups.push(ch);
    }
    for (const [key, g] of byKey) {
      let list = next[key] = next[key] || [];
      if (g.del.size) list = next[key] = list.filter((x) => !g.del.has(x.id));
      if (g.ups.length) {
        const idx = new Map(list.map((x, i) => [x.id, i]));
        for (const ch of g.ups) { const i = idx.get(ch.id); if (i !== undefined) list[i] = ch.after; else { idx.set(ch.id, list.length); list.push(ch.after); } }
      }
    }
    const entries = entriesForChanges(next, user, all);
    const newVersion = Number(metaRows[0].version) + 1;
    await persistCatalog(conn, null, next, entries, newVersion, user);
    await insertAudit(conn, entries);
    await conn.commit();
    await cleanupGlossaryFiles(next);
    return { ok: true, version: newVersion, applied: entries.length };
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
};

/* children of deleted containers that the client did not send (it may hold a lazy document without attributes).
   `loadAttrs(tableIds)` supplies the attribute records of the deleted tables (prev is the lite document). */
export const cascadeDeletes = async (prev, changes, loadAttrs = async () => []) => {
  const explicit = new Set(changes.filter((c) => c.action === "deleted").map((c) => c.id));
  const ids = (type) => new Set(changes.filter((c) => c.action === "deleted" && c.entityType === type).map((c) => c.id));
  const dbIds = ids("database"), scIds = ids("schema"), tbIds = ids("table");
  const extra = [];
  const drop = (entityType, rec) => { if (!explicit.has(rec.id)) { explicit.add(rec.id); extra.push({ entityType, action: "deleted", id: rec.id, before: rec }); } };
  if (dbIds.size) for (const sc of prev.schemas || []) if (dbIds.has(sc.databaseId)) { scIds.add(sc.id); drop("schema", sc); }
  if (scIds.size) for (const t of prev.tables || []) if (scIds.has(t.schemaId)) { tbIds.add(t.id); drop("table", t); }
  if (tbIds.size) {
    const attrs = (prev.attributes || []).length ? (prev.attributes || []).filter((a) => tbIds.has(a.tableId)) : await loadAttrs([...tbIds]);
    for (const a of attrs) drop("attribute", a);
    for (const e of prev.lineage || []) if (tbIds.has(e.from) || tbIds.has(e.to)) drop("lineage", e);
  }
  return extra;
};

/* bulk import inside one transaction: `merge(prev, loadAttrs)` returns { next, created, name } — prev is the lite
   document; `loadAttrs(tableIds)` returns the attribute records of the tables the import touches (the merge dedupes
   against them). New records are appended, nothing is reordered; the audit gets one summary entry for large imports.
   `onProgress(done, total)` reports row writes. */
export const importBulk = async (user, merge, onProgress = null, onPhase = null) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [metaRows] = await conn.query("SELECT version FROM catalog_meta WHERE id = 1 FOR UPDATE");
    if (!metaRows.length) throw new Error("Catalog not initialised");
    const prev = await assembleLiteLocked(conn, Number(metaRows[0].version));
    const { next, created, name } = await merge(prev, (ids) => attributesOfTables(ids, conn));
    const entries = entriesForCreated(next, user, created);
    const newVersion = Number(metaRows[0].version) + 1;
    await persistCatalog(conn, null, next, entries, newVersion, user, onProgress);
    await insertAudit(conn, summariseEntries(entries, user, name, "csv"));
    if (onPhase) onPhase("committing");
    await conn.commit();
    return { version: newVersion, applied: entries.length };
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
};

/* lite document for large catalogs: every collection except the attributes, plus per-table attribute counts —
   read without touching the attribute payloads and cached per version */
export const assembleLite = async () => {
  const meta = (await q("SELECT * FROM catalog_meta WHERE id = 1"))[0];
  if (!meta) return { catalog: null, stats: null, version: 0 };
  const version = Number(meta.version);
  if (liteCache && liteCache.version === version) return { catalog: structuredClone(liteCache.catalog), stats: liteCache.stats, version };
  const catalog = { ...metaOf(meta) };
  for (const [key, tbl] of COLL) catalog[key] = key === "attributes" ? [] : await readCollection(q, tbl);
  const perTable = {};
  let total = 0;
  for (const r of await q("SELECT table_id, COUNT(*) AS n FROM cat_attributes GROUP BY table_id")) { perTable[r.table_id] = Number(r.n); total += Number(r.n); }
  const stats = { attributes: total, perTable };
  liteCache = { version, catalog, stats };
  return { catalog: structuredClone(catalog), stats, version };
};
export const countAttributes = async () => Number((await q("SELECT COUNT(*) AS n FROM cat_attributes"))[0].n);

/* v1.66: coverage statistics computed on the server (the browser's lite document carries no attributes) — cached per
   catalog version; attributes are read in chunks, never assembled into one document */
let statsCache = null;
export const catalogStats = async () => {
  const { catalog, version, stats } = await assembleLite();
  if (!catalog) return null;
  if (statsCache && statsCache.version === version) return statsCache.stats;
  const tables = catalog.tables || [];
  const out = { version, hubs: (catalog.hubs || []).length, domains: (catalog.domains || []).length, databases: (catalog.databases || []).length, schemas: (catalog.schemas || []).length, tables: tables.length,
    attributes: stats?.attributes || 0, perTable: stats?.perTable || {},
    tablesWithDescription: tables.filter((t) => String(t.description || "").trim()).length,
    attributesWithDescription: 0, attributesWithBusinessTerm: 0, attributesWithSensitivity: 0, attributesWithClassification: 0, pii: 0, bySensitivity: {} };
  for await (const chunk of attributeChunks(tables, 400)) {
    for (const a of chunk) {
      if (String(a.description || "").trim()) out.attributesWithDescription++;
      if (String(a.businessTerm || "").trim()) out.attributesWithBusinessTerm++;
      if (a.sensitivity) { out.attributesWithSensitivity++; out.bySensitivity[a.sensitivity] = (out.bySensitivity[a.sensitivity] || 0) + 1; if (a.sensitivity === "PII") out.pii++; }
      if (a.classification) out.attributesWithClassification++;
    }
  }
  statsCache = { version, stats: out };
  return out;
};
export const attributesOfTable = async (tableId) =>
  (await q("SELECT data FROM cat_attributes WHERE table_id = ? ORDER BY seq, id", [tableId])).map((r) => (rowData(r)));

/* lazy document for server-side consumers (MCP): the lite document plus $load(tableIds | null) that fetches attribute
   records on demand, $stats (attribute counts) and $snapshot (the loaded attribute records as read, for delta writes) */
export const assembleLazy = async () => {
  const { catalog, stats, version } = await assembleLite();
  if (!catalog) return { catalog: null, version };
  const loaded = new Set(); const snapshot = [];
  Object.defineProperties(catalog, {
    $stats: { value: stats },
    $snapshot: { value: snapshot },
    $loaded: { value: loaded },
    /* single attribute records by id (glossary references) — appended without marking their tables as loaded */
    $loadByIds: { value: async (ids) => {
      const want = [...new Set(ids)].filter((id) => id && !catalog.attributes.some((a) => a.id === id));
      for (let i = 0; i < want.length; i += CHUNK) {
        const part = want.slice(i, i + CHUNK);
        const rows = (await q(`SELECT data FROM cat_attributes WHERE id IN (${part.map(() => "?").join(",")})`, part)).map((r) => (rowData(r)));
        catalog.attributes.push(...rows); snapshot.push(...structuredClone(rows));
      }
      return catalog.attributes;
    } },
    $load: { value: async (tableIds) => {
      if (loaded.has("*")) return catalog.attributes;
      if (tableIds === null) {
        const rows = await readCollection(q, "cat_attributes");
        loaded.clear(); loaded.add("*"); catalog.attributes = rows; snapshot.splice(0, snapshot.length, ...structuredClone(rows));
        return rows;
      }
      const ids = [...new Set(tableIds)].filter((id) => id && !loaded.has(id));
      if (!ids.length) return catalog.attributes;
      const rows = await attributesOfTables(ids);
      for (const id of ids) loaded.add(id);
      catalog.attributes.push(...rows); snapshot.push(...structuredClone(rows));
      return catalog.attributes;
    } },
  });
  return { catalog, version };
};
