/* Informatica Enterprise Data Catalog (Catalog Search API /access/2/catalog/data/search) — ported from inspector/app.py
   (v1.60, Option B). Tables/Views and Columns/ViewColumns are searched per class type; EDC object ids are hierarchical
   (resource://db/schema/table[/column]), so the schema name is the second-to-last path segment. */
import { request as httpRequest, ConnectorError } from "./http.js";

const lower = (s) => String(s || "").toLowerCase();

/* Read a fact value from an EDC search item by attributeId suffix (version-tolerant). */
export const fact = (item, ...suffixes) => {
  for (const v of item.values || []) {
    const aid = lower(v.attributeId);
    for (const s of suffixes) if (aid === lower(s) || aid.endsWith("." + lower(s))) return v.value || "";
  }
  return "";
};

async function searchAll(transport, base, q, opts, pageSize = 100, maxItems = 100000) {
  const items = []; let offset = 0;
  for (;;) {
    const r = await transport(`${base}/access/2/catalog/data/search`, { ...opts, params: { q, offset, pageSize } });
    if (r.status === 401) throw new ConnectorError("Informatica: authentication failed (401) — check user and password (for LDAP users include the security domain, e.g. LDAP/jdoe)");
    if (!r.ok) throw new ConnectorError(`Informatica search failed: HTTP ${r.status}`);
    const data = r.json();
    const batch = data.items || data.hits || [];
    items.push(...batch);
    const total = Number(data.totalCount || data.total || 0);
    offset += batch.length;
    if (!batch.length || (total && offset >= total) || offset >= maxItems) return items;
  }
}

export async function inspectInformatica({ url, user, password, resource, schema: onlySchema, tlsVerify = true } = {}, { transport = httpRequest } = {}) {
  const base = String(url || "").trim().replace(/\/+$/, "");
  const opts = { headers: { Accept: "application/json" }, auth: { user: user || "", password: password || "" }, tlsVerify, timeoutMs: 45000 };
  const resQ = resource ? ` AND core.resourceName:"${resource}"` : "";
  const tblItems = []; const colItems = [];
  for (const ct of ["com.infa.ldm.relational.Table", "com.infa.ldm.relational.View"]) {
    for (const i of await searchAll(transport, base, `core.classType:${ct}${resQ}`, opts)) tblItems.push([i, ct.endsWith("View")]);
  }
  for (const ct of ["com.infa.ldm.relational.Column", "com.infa.ldm.relational.ViewColumn"]) colItems.push(...await searchAll(transport, base, `core.classType:${ct}${resQ}`, opts));
  const path = (id) => String(id).split("://").pop().split("/").filter(Boolean);
  const colsByTable = new Map();
  for (const c of colItems) {
    const cid = c.id || "";
    const parent = cid.includes("/") ? cid.slice(0, cid.lastIndexOf("/")) : "";
    const nullableRaw = fact(c, "nullable").trim().toUpperCase();
    if (!colsByTable.has(parent)) colsByTable.set(parent, []);
    colsByTable.get(parent).push({
      name: fact(c, "name") || (path(cid).length ? path(cid).at(-1) : "?"),
      type_text: (fact(c, "datatype") || "STRING").toUpperCase(),
      nullable: !["NO", "FALSE", "N", "0"].includes(nullableRaw),
      comment: fact(c, "description", "businessDescription"),
      isPK: Boolean(fact(c, "primaryKeyColumn", "primarykey")),
      _pos: fact(c, "position") || "0",
    });
  }
  const bySchema = new Map();
  for (const [t, isView] of tblItems) {
    const tid = t.id || "";
    const segs = path(tid);
    const schema = segs.length >= 2 ? segs.at(-2) : "default";
    if (onlySchema && lower(schema) !== lower(onlySchema)) continue;
    const cols = (colsByTable.get(tid) || []).sort((a, b) => a._pos.length - b._pos.length || (a._pos < b._pos ? -1 : a._pos > b._pos ? 1 : 0));
    for (const c of cols) delete c._pos;
    if (!bySchema.has(schema)) bySchema.set(schema, []);
    bySchema.get(schema).push({ name: fact(t, "name") || (segs.length ? segs.at(-1) : "?"), type: isView ? "VIEW" : "TABLE", comment: fact(t, "description", "businessDescription"), columns: cols });
  }
  return [...bySchema.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([sc, tbs]) => ({ name: sc, comment: "", tables: tbs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) }));
}
