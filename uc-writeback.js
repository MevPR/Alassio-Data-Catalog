/* Unity Catalog write-back — the diff and the operations, run by the server (server/uc-writeback.js) with a sync
   profile's credentials (v1.64; the browser dialog and the /databricks proxy were retired in v1.66). Kept at the
   repo root next to csv-import.js because the unit tests exercise it without a database.
   Metadata only, and only what differs: descriptions become comments (REST PATCH, SQL COMMENT as fallback for tables,
   ALTER COLUMN … COMMENT for columns); Data Owner / Data Steward / Data Domain / Sensitivity / Classification become
   UC tags (SQL, needs a SQL warehouse); data hub, medallion layer and country become catalog properties. The current
   UC state is read first; nothing is created, renamed or deleted.
   v1.77: every operation names its sources — `src: [{ type, id, field }]`, the catalog records and fields the desired
   value comes from (an inherited owner points at the record that holds it) — so the server can look up in the audit
   trail who made the change and let each user write back their own changes (server/uc-writeback-run.js). */
import { effOwnerId, effStewardId, effDomainId } from "./permissions.js";

export const TAG_OWNER = "Data Owner", TAG_STEWARD = "Data Steward", TAG_DOMAIN = "Data Domain", TAG_SENS = "Sensitivity", TAG_CLASS = "Classification";
export const WRITEBACK_OPTIONS = { comments: true, roles: true, columns: true, owner: false };
const norm = (s) => String(s || "").trim();
const esc = (s) => String(s || "").replace(/'/g, "''");
/* v1.64.1: identifiers are backtick-quoted in SQL and URL-encoded in REST paths (names with spaces, dashes or dots) */
const qid = (s) => `\`${String(s || "").replace(/`/g, "``")}\``;
const qpath = (...parts) => parts.map((p) => encodeURIComponent(p)).join(".");

/* ucReq(path, { method, body }) → fetch-like Response; runSqlQ(statement) → rows (or null when no warehouse) */
export const makeSqlRunner = (ucReq, warehouse) => async (statement) => {
  if (!warehouse) throw new Error("needs a SQL warehouse ID");
  const res = await ucReq("/api/2.0/sql/statements", { method: "POST", body: JSON.stringify({ statement, warehouse_id: warehouse, wait_timeout: "30s" }) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (j.status?.state === "FAILED") throw new Error(j.status?.error?.message || "SQL statement failed");
  return j.result?.data_array || [];
};
export const ucListAll = async (ucReq, path, key) => {
  const out = []; let pt = "";
  do {
    const r = await ucReq(`${path}${pt ? `&page_token=${encodeURIComponent(pt)}` : ""}`);
    if (!r.ok) throw new Error(`HTTP ${r.status} on ${path.split("?")[0]}`);
    const j = await r.json();
    out.push(...(j[key] || []));
    pt = j.next_page_token || "";
  } while (pt);
  return out;
};

/* current state of one catalog: catalog, schemas, tables (with columns) and — when a warehouse is available — the tags.
   sqlAvailable says whether SQL statements can run at all (a warehouse ID was given); tagsReadable whether the tag views
   of information_schema could be read with it. */
export const readUnityState = async (cat, { ucReq, runSqlQ = null }) => {
  const catRes = await ucReq(`/api/2.1/unity-catalog/catalogs/${encodeURIComponent(cat)}`);
  if (!catRes.ok) throw new Error(`Catalog ${cat} not readable (HTTP ${catRes.status}) — check workspace URL and token`);
  const curCat = await catRes.json();
  const curSchemas = (await ucListAll(ucReq, `/api/2.1/unity-catalog/schemas?catalog_name=${encodeURIComponent(cat)}&max_results=50`, "schemas")).filter((s) => s.name !== "information_schema");
  const curTables = {};
  for (const s of curSchemas) {
    for (const t of await ucListAll(ucReq, `/api/2.1/unity-catalog/tables?catalog_name=${encodeURIComponent(cat)}&schema_name=${encodeURIComponent(s.name)}&max_results=50`, "tables")) curTables[`${s.name}.${t.name}`] = t;
  }
  const tags = { cat: {}, table: {}, col: {} };
  let tagsReadable = false;
  if (runSqlQ) {
    try {
      for (const r of await runSqlQ(`SELECT tag_name, tag_value FROM ${qid(cat)}.information_schema.catalog_tags`)) tags.cat[r[0]] = r[1];
      for (const r of await runSqlQ(`SELECT schema_name, table_name, tag_name, tag_value FROM ${qid(cat)}.information_schema.table_tags`)) tags.table[`${r[0]}.${r[1]}:${r[2]}`] = r[3];
      for (const r of await runSqlQ(`SELECT schema_name, table_name, column_name, tag_name, tag_value FROM ${qid(cat)}.information_schema.column_tags`)) tags.col[`${r[0]}.${r[1]}.${r[2]}:${r[3]}`] = r[4];
      tagsReadable = true;
    } catch { tagsReadable = false; }
  }
  return { curCat, curSchemas, curTables, tags, tagsReadable, sqlAvailable: !!runSqlQ };
};

/* the operations whose desired value differs from the UC state — unchanged metadata is never written.
   Without a SQL warehouse (uc.sqlAvailable false) the SQL-only operations (column comments, table properties, tags)
   are left out and counted in ops.skippedSql instead of failing one by one (v1.64.1). */
export const buildWriteBackOps = async ({ state, db, attributesOf, options = WRITEBACK_OPTIONS, uc }) => {
  const { hubs = [], people = [], domains = [], schemas = [], tables = [] } = state;
  const { curCat, curSchemas, curTables, tags, tagsReadable } = uc;
  const sqlOk = uc.sqlAvailable !== false;
  const opt = { ...WRITEBACK_OPTIONS, ...options };
  const pname = (id) => people.find((p) => p.id === id)?.name || "";
  const pmail = (id) => people.find((p) => p.id === id)?.email || "";
  const d = db, cat = d.name;
  const h = hubs.find((x) => x.id === d.hubId);
  const dm = domains.find((x) => x.id === effDomainId(state, "database", d.id));
  const ops = [];
  let skippedSql = 0;
  const push = (op) => { if (op.kind === "sql" && !sqlOk) skippedSql++; else ops.push(op); };
  /* v1.77: which record holds an inherited field of the database — the database itself, its data domain, or the
     data hub entry inside the hub type (effOwnerId / effDomainId walk the same chain) */
  const holderOf = (field) => {
    if (d[field]) return { type: "database", id: d.id, field };
    if (field !== "stewardId") {
      const dhRec = (h?.dataHubs || []).find((x) => x.name === (d.country || "GLOBAL"));
      if (field === "ownerId" && dhRec?.bpoId) return { type: "hub", id: h.id, field: "dataHubs" };
      if (field === "domainId" && dhRec?.domainId) return { type: "hub", id: h.id, field: "dataHubs" };
    }
    if (dm && field !== "domainId" && dm[field]) return { type: "domain", id: dm.id, field };
    return { type: "database", id: d.id, field };
  };
  const personSrc = (pid) => (pid ? [{ type: "person", id: pid, field: "name" }] : []);
  const S = { desc: (type, id) => [{ type, id, field: "description" }] };
  const catPath = `/api/2.1/unity-catalog/catalogs/${encodeURIComponent(cat)}`;
  if (opt.comments && norm(curCat.comment) !== norm(d.description)) push({ label: `Catalog ${cat} — description`, kind: "patch", path: catPath, body: { comment: d.description || "" }, src: S.desc("database", d.id) });
  const effOwnerName = pname(effOwnerId(state, "database", d.id)), effStewName = pname(effStewardId(state, "database", d.id));
  if (opt.roles && tagsReadable) {
    const wantCat = { [TAG_OWNER]: effOwnerName, [TAG_STEWARD]: effStewName, [TAG_DOMAIN]: dm?.name || "" };
    const setPairs = Object.entries(wantCat).filter(([k, v]) => v && norm(tags.cat[k]) !== norm(v));
    const tagSrc = { [TAG_OWNER]: [holderOf("ownerId"), ...personSrc(effOwnerId(state, "database", d.id))], [TAG_STEWARD]: [holderOf("stewardId"), ...personSrc(effStewardId(state, "database", d.id))], [TAG_DOMAIN]: [holderOf("domainId"), ...(dm ? [{ type: "domain", id: dm.id, field: "name" }] : [])] };
    /* one SQL statement per tag, so each carries its own author (v1.77) */
    for (const [k, v] of setPairs) push({ label: `Catalog ${cat} — tag ${k}`, kind: "sql", sql: `ALTER CATALOG ${qid(cat)} SET TAGS ('${esc(k)}' = '${esc(v)}')`, src: tagSrc[k] });
  }
  if (opt.roles) {
    const wantProps = { data_hub: h?.name || "", medallion_layer: d.layer || "", country: d.country || "" };
    const curProps = curCat.properties || {};
    const diffProps = Object.entries(wantProps).filter(([k, v]) => v && norm(curProps[k]) !== norm(v));
    const propSrc = { data_hub: [{ type: "database", id: d.id, field: "hubId" }, ...(h ? [{ type: "hub", id: h.id, field: "name" }] : [])], medallion_layer: [{ type: "database", id: d.id, field: "layer" }], country: [{ type: "database", id: d.id, field: "country" }] };
    for (const [k, v] of diffProps) push({ label: `Catalog ${cat} — property ${k}`, kind: "patch", path: catPath, body: { properties: { [k]: v } }, src: propSrc[k] });
  }
  const ownerPid = effOwnerId(state, "database", d.id);
  if (opt.owner && pmail(ownerPid) && norm(curCat.owner) !== norm(pmail(ownerPid))) push({ label: `Catalog ${cat} — UC owner`, kind: "patch", path: catPath, body: { owner: pmail(ownerPid) }, src: [holderOf("ownerId"), { type: "person", id: ownerPid, field: "email" }] });

  for (const sc of schemas.filter((x) => x.databaseId === d.id)) {
    const curSc = curSchemas.find((s) => s.name === sc.name);
    if (opt.comments && curSc && norm(curSc.comment) !== norm(sc.description)) push({ label: `Schema ${cat}.${sc.name} — description`, kind: "patch", path: `/api/2.1/unity-catalog/schemas/${qpath(cat, sc.name)}`, body: { comment: sc.description || "" }, src: S.desc("schema", sc.id) });
    for (const t of tables.filter((x) => x.schemaId === sc.id)) {
      const key = `${sc.name}.${t.name}`, full = `${cat}.${key}`, qfull = `${qid(cat)}.${qid(sc.name)}.${qid(t.name)}`;
      const cur = curTables[key];
      if (!cur) continue;   /* table does not exist in UC — write-back never creates objects */
      if (opt.comments && norm(cur.comment) !== norm(t.description)) push({ label: `Table ${full} — description`, kind: "sqlOrPatch", path: `/api/2.1/unity-catalog/tables/${qpath(cat, sc.name, t.name)}`, body: { comment: t.description || "" }, sql: `COMMENT ON TABLE ${qfull} IS '${esc(t.description || "")}'`, src: S.desc("table", t.id) });
      if (opt.roles && tagsReadable && pname(t.stewardId) && norm(tags.table[`${key}:${TAG_STEWARD}`]) !== norm(pname(t.stewardId))) push({ label: `Table ${full} — tag ${TAG_STEWARD}`, kind: "sql", sql: `ALTER TABLE ${qfull} SET TAGS ('${esc(TAG_STEWARD)}' = '${esc(pname(t.stewardId))}')`, src: [{ type: "table", id: t.id, field: "stewardId" }, ...personSrc(t.stewardId)] });
      if (opt.roles && tagsReadable && pname(t.ownerId) && norm(tags.table[`${key}:${TAG_OWNER}`]) !== norm(pname(t.ownerId))) push({ label: `Table ${full} — tag ${TAG_OWNER}`, kind: "sql", sql: `ALTER TABLE ${qfull} SET TAGS ('${esc(TAG_OWNER)}' = '${esc(pname(t.ownerId))}')`, src: [{ type: "table", id: t.id, field: "ownerId" }, ...personSrc(t.ownerId)] });
      if (opt.roles && d.layer && norm((cur.properties || {}).medallion_layer) !== norm(d.layer)) push({ label: `Table ${full} — property medallion_layer`, kind: "sql", sql: `ALTER TABLE ${qfull} SET TBLPROPERTIES ('medallion_layer'='${esc(d.layer)}')`, src: [{ type: "database", id: d.id, field: "layer" }] });
      if (opt.columns) {
        const curCols = Object.fromEntries((cur.columns || []).map((c) => [c.name, c]));
        for (const a of await attributesOf(t.id)) {
          if (!curCols[a.name]) continue;
          if (norm(curCols[a.name].comment) !== norm(a.description)) push({ label: `Column ${full}.${a.name} — description`, kind: "sql", sql: `ALTER TABLE ${qfull} ALTER COLUMN ${qid(a.name)} COMMENT '${esc(a.description || "")}'`, src: S.desc("attribute", a.id) });
          if (tagsReadable && a.sensitivity && norm(tags.col[`${key}.${a.name}:${TAG_SENS}`]) !== norm(a.sensitivity)) push({ label: `Column ${full}.${a.name} — tag ${TAG_SENS}`, kind: "sql", sql: `ALTER TABLE ${qfull} ALTER COLUMN ${qid(a.name)} SET TAGS ('${esc(TAG_SENS)}' = '${esc(a.sensitivity)}')`, src: [{ type: "attribute", id: a.id, field: "sensitivity" }] });
          if (tagsReadable && a.classification && norm(tags.col[`${key}.${a.name}:${TAG_CLASS}`]) !== norm(a.classification)) push({ label: `Column ${full}.${a.name} — tag ${TAG_CLASS}`, kind: "sql", sql: `ALTER TABLE ${qfull} ALTER COLUMN ${qid(a.name)} SET TAGS ('${esc(TAG_CLASS)}' = '${esc(a.classification)}')`, src: [{ type: "attribute", id: a.id, field: "classification" }] });
        }
      }
    }
  }
  ops.tagsReadable = tagsReadable;
  ops.skippedSql = skippedSql;
  return ops;
};

/* runs the operations one by one; never stops on a failure (each entry carries ok + label) */
export const executeWriteBackOps = async (ops, { ucReq, runSqlQ, onProgress = null }) => {
  const out = [];
  for (const op of ops) {
    try {
      if (op.kind === "patch") { const res = await ucReq(op.path, { method: "PATCH", body: JSON.stringify(op.body) }); if (!res.ok) throw new Error(`HTTP ${res.status}`); }
      else if (op.kind === "sql") { if (!runSqlQ) throw new Error("needs a SQL warehouse ID"); await runSqlQ(op.sql); }
      else { const res = await ucReq(op.path, { method: "PATCH", body: JSON.stringify(op.body) }); if (!res.ok) { if (!runSqlQ) throw new Error(`HTTP ${res.status}`); await runSqlQ(op.sql); } }
      out.push({ ok: true, label: op.label });
    } catch (e) { out.push({ ok: false, label: `${op.label} — ${e.message}` }); }
    if (onProgress) onProgress(out.slice());
  }
  return out;
};
