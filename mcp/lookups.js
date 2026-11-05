/* Catalog lookups for the MCP tools (v1.69 — moved out of mcp.js): resolve "hub", "hub/database", "database.schema",
   "database.schema.table" and "….attribute" references with readable errors, load attributes on demand on lazy
   documents, build table paths, resolve glossary references and compute the OKF selection. Pure functions over the
   catalog document; exercised through the tools in test/unit/mcp-tools.test.js. */
import { findOrCreatePerson } from "../src/lib/catalog-ops.js";
/* v1.74 (F-M2 of the third review): ids, layers, data-hub names and find-or-create of people come from the shared
   domain modules (src/lib/model.js, src/lib/catalog-ops.js) — the private copies here had drifted (guessLayer knew
   only bronze/silver/gold, so "raw_claims" became "other" via MCP but "bronze" in the UI). */

/* v1.73 (F-M4): the small shared idioms of the tool modules — names compare case-insensitively, timestamps leave as ISO
   strings (or null when unset), table ids become "database.schema.table" paths (a dangling id keeps the id as the
   table name), and "resolve this table, then act on it" for reads and mutations. */
export const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
export const iso = (ts) => (ts ? new Date(ts).toISOString() : null);

/* ── catalog lookups (throw readable errors) ── */
export const findHub = (c, ref) => {
  const hits = c.hubs.filter((h) => sameName(h.name, ref) || h.id === ref);
  if (!hits.length) throw new Error(`Data hub "${ref}" not found. Available: ${c.hubs.map((h) => h.name).join(", ")}`);
  return hits[0];
};
export const findDb = (c, ref) => {
  const [a, b] = String(ref).split("/").map((s) => s.trim());
  let hits = c.databases.filter((d) => sameName(d.name, b ? b : a));
  if (b) { const h = findHub(c, a); hits = hits.filter((d) => d.hubId === h.id); }
  if (!hits.length) throw new Error(`Database "${ref}" not found`);
  if (hits.length > 1) {
    const opts = hits.map((d) => `${c.hubs.find((h) => h.id === d.hubId)?.name}/${d.name}`);
    throw new Error(`Database name "${ref}" is ambiguous — qualify it as hub/database: ${opts.join(", ")}`);
  }
  return hits[0];
};
export const findSchema = (c, ref) => {
  const parts = String(ref).split(".").map((s) => s.trim());
  if (parts.length < 2) throw new Error(`Schema reference must be "database.schema" (got "${ref}")`);
  const d = findDb(c, parts.slice(0, -1).join("."));
  const sc = c.schemas.find((s) => s.databaseId === d.id && sameName(s.name, parts.at(-1)));
  if (!sc) throw new Error(`Schema "${ref}" not found. Schemas in ${d.name}: ${c.schemas.filter((s) => s.databaseId === d.id).map((s) => s.name).join(", ") || "none"}`);
  return { d, sc };
};
export const findTable = (c, ref) => {
  const parts = String(ref).split(".").map((s) => s.trim());
  if (parts.length < 3) throw new Error(`Table reference must be "database.schema.table" (got "${ref}")`);
  const { d, sc } = findSchema(c, parts.slice(0, -1).join("."));
  const tb = c.tables.find((t) => t.schemaId === sc.id && sameName(t.name, parts.at(-1)));
  if (!tb) throw new Error(`Table "${ref}" not found. Tables in ${d.name}.${sc.name}: ${c.tables.filter((t) => t.schemaId === sc.id).map((t) => t.name).join(", ") || "none"}`);
  return { d, sc, tb };
};
export const findAttr = async (c, ref) => {
  const parts = String(ref).split(".").map((s) => s.trim());
  if (parts.length < 4) throw new Error(`Attribute reference must be "database.schema.table.attribute" (got "${ref}")`);
  const { d, sc, tb } = findTable(c, parts.slice(0, -1).join("."));
  await load(c, [tb.id]);
  const at = c.attributes.find((a) => a.tableId === tb.id && sameName(a.name, parts.at(-1)));
  if (!at) throw new Error(`Attribute "${ref}" not found. Attributes of ${tb.name}: ${c.attributes.filter((a) => a.tableId === tb.id).map((a) => a.name).join(", ") || "none"}`);
  return { d, sc, tb, at };
};
/* read tools: `const { c, d, sc, tb } = await readTable(readCatalog, a.table)`;
   write tools: `mutate(withTable(a.table, (c, { d, sc, tb }) => …))` — the change function receives the resolved table */
export const readTable = async (readCatalog, ref) => { const { catalog: c } = await readCatalog(); return { c, ...findTable(c, ref) }; };
export const withTable = (ref, fn) => (c) => fn(c, findTable(c, ref));
/* v1.71 (F-M3): one uniqueness rule for every create_* and every rename — names are unique case-insensitively within
   their parent (the caller passes the sibling list); `exceptId` skips the record being renamed. */
export const assertUniqueName = (list, name, { exceptId = null, label = "Object", where = "" } = {}) => {
  if ((list || []).some((x) => x.id !== exceptId && sameName(x.name, name))) throw new Error(`${label} "${name}" already exists${where ? ` ${where}` : ""}`);
};
/* attributes on demand: lazy documents expose $load, full documents (tests) already carry everything */
export const load = async (c, tableIds) => { if (typeof c.$load === "function") await c.$load(tableIds); return c.attributes; };
export const attrCount = (c, tableId) => c.$stats ? (c.$stats.perTable?.[tableId] || 0) : c.attributes.filter((x) => x.tableId === tableId).length;
/* v1.73 (F-M6): people by name. `findOrCreatePerson` is what create_table documents (find-or-create); the update tools
   use `personIdFor`, which creates only on an explicit `create_person: true` and otherwise rejects an unknown name with
   the closest existing names — a typo used to create a ghost person silently. An empty name clears (null). */
export const findPerson = (c, name) => c.people.find((x) => sameName(x.name, name)) || null;
const editDistance = (a, b) => {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
};
/* up to five existing names that are a small edit away or share a word (≥ 3 letters) with `name` */
export const closePeople = (c, name, max = 5) => {
  const n = String(name).toLowerCase().trim(), words = n.split(/\s+/).filter((w) => w.length >= 3);
  return c.people.map((p) => ({ name: p.name, l: String(p.name).toLowerCase(), d: editDistance(n, String(p.name).toLowerCase()) }))
    .filter((p) => p.d <= Math.max(2, Math.floor(n.length / 4)) || words.some((w) => p.l.split(/\s+/).includes(w)))
    .sort((x, y) => x.d - y.d).slice(0, max).map((p) => p.name);
};
export const personIdFor = (c, name, { create = false, role = "Person" } = {}) => {
  if (!name) return null;
  const p = findPerson(c, name);
  if (p) return p.id;
  if (create) return findOrCreatePerson(c, name);
  const close = closePeople(c, name);
  throw new Error(`${role} "${name}" is not a known person${close.length ? ` — did you mean: ${close.join(", ")}?` : "."} Pass create_person: true to create a new person with this name.`);
};
export const dbLayer = (d) => d?.layer || "other";
export const tablePath = (c, tb) => {
  const sc = c.schemas.find((s) => s.id === tb.schemaId);
  const d = sc && c.databases.find((x) => x.id === sc.databaseId);
  return `${d?.name}.${sc?.name}.${tb.name}`;
};
export const tablePathById = (c, id) => tablePath(c, c.tables.find((t) => t.id === id) || { name: id });
export const isUnityDb = (c, tb) => {
  const sc = c.schemas.find((s) => s.id === tb.schemaId);
  return c.databases.find((x) => x.id === sc?.databaseId)?.source === "unity";
};

/* ── glossary helpers ── */
export const glossFind = (c, name) => {
  const g = (c.glossary || []).find((x) => sameName(x.name, name));
  if (!g) throw new Error(`Glossary term "${name}" not found. Available: ${(c.glossary || []).map((x) => x.name).join(", ") || "none"}`);
  return g;
};
export const resolveRef = (c, r) => {
  const t = String(r.type || "").toLowerCase();
  if (t === "hub") return { type: "hub", id: findHub(c, r.path).id };
  if (t === "database") return { type: "database", id: findDb(c, r.path).id };
  if (t === "schema") return { type: "schema", id: findSchema(c, r.path).sc.id };
  if (t === "table") return { type: "table", id: findTable(c, r.path).tb.id };
  if (t === "attribute") throw new Error("internal: attribute references are resolved by resolveRefs");
  throw new Error(`Unknown reference type "${r.type}" — use hub, database, schema, table or attribute`);
};
export const resolveRefs = async (c, refs) => {
  const out = [];
  for (const r of refs || []) {
    if (String(r.type || "").toLowerCase() === "attribute") { const { at } = await findAttr(c, r.path); out.push({ type: "attribute", id: at.id }); }
    else out.push(resolveRef(c, r));
  }
  return out;
};
export const refPath = (c, r) => {
  if (r.type === "hub") return c.hubs.find((h) => h.id === r.id)?.name || null;
  if (r.type === "database") return c.databases.find((d) => d.id === r.id)?.name || null;
  if (r.type === "schema") { const s = c.schemas.find((x) => x.id === r.id); const d = s && c.databases.find((x) => x.id === s.databaseId); return s ? `${d?.name}.${s.name}` : null; }
  if (r.type === "table") { const t = c.tables.find((x) => x.id === r.id); return t ? tablePath(c, t) : null; }
  if (r.type === "attribute") { const a = c.attributes.find((x) => x.id === r.id); const t = a && c.tables.find((x) => x.id === a.tableId); return t ? `${tablePath(c, t)}.${a.name}` : null; }
  return null;
};

/* ── OKF selection from optional filters ── */
export const okfSelection = (c, a) => {
  if (!a.hub && !a.database && !a.schema && !a.table) return { tableIds: null };
  let dbs = [], scs = [], tbs = [];
  if (a.table) { const { tb } = findTable(c, a.table); tbs = [tb]; }
  else if (a.schema) { const { sc } = findSchema(c, a.schema); scs = [sc]; tbs = c.tables.filter((t) => t.schemaId === sc.id); }
  else if (a.database) { const d = findDb(c, a.database); dbs = [d]; scs = c.schemas.filter((s) => s.databaseId === d.id); }
  else { const h = findHub(c, a.hub); dbs = c.databases.filter((d) => d.hubId === h.id); scs = c.schemas.filter((s) => dbs.some((d) => d.id === s.databaseId)); }
  if (!a.table && !a.schema) tbs = c.tables.filter((t) => scs.some((s) => s.id === t.schemaId));
  return { tableIds: tbs.map((t) => t.id), schemaIds: scs.map((s) => s.id), databaseIds: dbs.map((d) => d.id) };
};
