/* Databricks / Unity Catalog client side of the sync (v1.73, F-S8 — split out of uc-sync.js): the profile-bound
   requester, the REST reads (catalogs; schemas, tables and columns, optional lineage) and the governance tags through
   information_schema on the profile's SQL warehouse. Failures of the workspace carry status 502 (v1.72). */
import { makeSqlRunner, ucListAll } from "../uc-writeback.js";
import { bearerFor, hostOf, warehouseOf } from "./sync-profiles.js";

/* a fetch-like requester bound to the profile's workspace and token (moved from server/uc-writeback.js in v1.73) */
export const ucRequester = async (p, fetchImpl = fetch) => {
  const token = await bearerFor(p), host = hostOf(p);
  return (path, opts = {}) => fetchImpl(`${host}${path}`, { ...opts, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) } });
};

/* marks an error as a failure of the Databricks workspace (HTTP 502 when a route lets it through, v1.72) */
const upstream = (e, { keepStatus = false } = {}) => { if (!(keepStatus && e?.status)) e.status = 502; return e; };

/* catalogs the profile's credentials can see (one-off import dialog); failures are upstream ones unless they carry a
   status already (a workspace host outside the allow-list stays 400) */
export const listUnityCatalogs = async (p, { fetchImpl = fetch } = {}) => {
  try {
    const req = await ucRequester(p, fetchImpl);
    return (await ucListAll(req, "/api/2.1/unity-catalog/catalogs?max_results=50", "catalogs")).map((c) => ({ name: c.name, comment: c.comment || "", owner: c.owner || "" }));
  } catch (e) { throw upstream(e, { keepStatus: true }); }
};
/* governance tags of a catalog through information_schema (needs the SQL warehouse) — the shape applyUnityTags expects */
export const fetchUnityTags = async (p, { fetchImpl = fetch } = {}) => {
  const wh = warehouseOf(p);
  if (!wh || p.importTags === false) return null;
  const runSqlQ = makeSqlRunner(await ucRequester(p, fetchImpl), wh);
  const cat = `\`${String(p.catalog).replace(/`/g, "``")}\``;
  const WANT = new Set(["Sensitivity", "Classification", "Data Owner", "Data Steward", "Data Domain"]);
  const catalogTags = {}, tableTags = {}, columnTags = {}, columnClass = {};
  for (const r of await runSqlQ(`SELECT tag_name, tag_value FROM ${cat}.information_schema.catalog_tags`)) if (WANT.has(r[0])) catalogTags[r[0]] = r[1];
  for (const r of await runSqlQ(`SELECT schema_name, table_name, tag_name, tag_value FROM ${cat}.information_schema.table_tags`)) if (r[2] === "Data Steward" && r[3]) tableTags[`${r[0]}.${r[1]}`] = r[3];
  for (const r of await runSqlQ(`SELECT schema_name, table_name, column_name, tag_name, tag_value FROM ${cat}.information_schema.column_tags`)) { if (r[3] === "Sensitivity") columnTags[`${r[0]}.${r[1]}.${r[2]}`] = r[4]; else if (r[3] === "Classification") columnClass[`${r[0]}.${r[1]}.${r[2]}`] = r[4]; }
  return { catalogTags, tableTags, columnTags, columnClass };
};
/* schemas, tables and columns (+ lineage when the profile asks) through the REST API. Every failure is an upstream one:
   it carries status 502 (v1.72 — the connection test route used to translate it by hand). */
export const fetchUnity = (p, opts = {}) => fetchUnityRaw(p, opts).catch((e) => { throw upstream(e); });
const fetchUnityRaw = async (p, { fetchImpl = fetch, onProgress = null } = {}) => {
  const ucReq = await ucRequester(p, fetchImpl);
  const get = async (path) => { const r = await ucReq(path); if (!r.ok) throw new Error(`HTTP ${r.status} on ${path.split("?")[0]}`); return r.json(); };
  const list = (path, key) => ucListAll(ucReq, path, key);
  const schemas = (await list(`/api/2.1/unity-catalog/schemas?catalog_name=${encodeURIComponent(p.catalog)}&max_results=50`, "schemas")).filter((s) => s.name !== "information_schema");
  const payload = [];
  for (const sc of schemas) {
    const tables = await list(`/api/2.1/unity-catalog/tables?catalog_name=${encodeURIComponent(p.catalog)}&schema_name=${encodeURIComponent(sc.name)}&max_results=50`, "tables");
    const tbs = [];
    for (const t of tables) {
      let cols = t.columns || [];
      if (!cols.length) { try { cols = (await get(`/api/2.1/unity-catalog/tables/${encodeURIComponent(`${p.catalog}.${sc.name}.${t.name}`)}`)).columns || []; } catch { /* table without columns */ } }
      tbs.push({ name: t.name, type: t.table_type, comment: t.comment, columns: cols });
    }
    payload.push({ name: sc.name, comment: sc.comment, tables: tbs });
    if (onProgress) onProgress({ schemas: payload.length, schemasTotal: schemas.length, tables: payload.reduce((n, x) => n + x.tables.length, 0) });
  }
  const pairs = [];
  if (p.lineage) {
    for (const sc of payload) for (const tb of sc.tables) {
      const full = `${p.catalog}.${sc.name}.${tb.name}`;
      try { const ld = await get(`/api/2.0/lineage-tracking/table-lineage?table_name=${encodeURIComponent(full)}&include_entity_lineage=false`); for (const u of ld.upstreams || []) { const ti = u.tableInfo || u.table_info; if (ti?.catalog_name === p.catalog) pairs.push([`${ti.catalog_name}.${ti.schema_name}.${ti.name}`, full]); } }
      catch { /* lineage is best-effort */ }
    }
  }
  return { schemasPayload: payload, lineagePairs: pairs };
};
