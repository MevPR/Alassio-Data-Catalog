/* dbt import — turns manifest.json (+ optional catalog.json) from `dbt docs generate` / `dbt build` into the bundle
   import format: one database per warehouse database, models/seeds/snapshots/sources as tables, documented columns
   as attributes (types from catalog.json when present) and lineage from depends_on. Pure — runs in the browser and
   in unit tests. */

const TABLE_KINDS = new Set(["model", "seed", "snapshot", "source"]);
const typeOf = (node, catNode) => {
  const t = String(catNode?.metadata?.type || "").toUpperCase();
  if (t.includes("VIEW")) return "VIEW";
  if (node.resource_type === "source") return "TABLE";
  const mat = String(node.config?.materialized || "").toLowerCase();
  return mat === "view" ? "VIEW" : mat === "materialized_view" ? "MATERIALIZED VIEW" : "TABLE";
};
const testsByColumn = (manifest) => {
  /* generic tests (not_null, unique, primary key) tell us nullability and keys */
  const out = {};
  for (const n of Object.values(manifest.nodes || {})) {
    if (n.resource_type !== "test" || !n.column_name || !n.test_metadata?.name) continue;
    const parent = (n.depends_on?.nodes || []).find((id) => !id.startsWith("test."));
    if (!parent) continue;
    (out[parent] ||= {})[n.column_name] ||= new Set();
    out[parent][n.column_name].add(n.test_metadata.name);
  }
  return out;
};
const tableKey = (n) => `${n.database || "default"}.${n.schema || "default"}.${n.alias || n.identifier || n.name}`;

export function parseDbt(manifest, catalog = null) {
  if (!manifest || typeof manifest !== "object" || !manifest.nodes) throw new Error("not a dbt manifest.json (nodes missing)");
  const catNodes = { ...(catalog?.nodes || {}), ...(catalog?.sources || {}) };
  const tests = testsByColumn(manifest);
  const all = { ...(manifest.sources || {}), ...(manifest.nodes || {}) };
  const dbs = {};
  const keyOf = {};
  let tableCount = 0;
  for (const [id, n] of Object.entries(all)) {
    if (!TABLE_KINDS.has(n.resource_type)) continue;
    if (n.config?.materialized === "ephemeral") continue;                 /* no relation in the warehouse */
    const cat = catNodes[id];
    const key = tableKey(n); keyOf[id] = key;
    const dbN = n.database || "default", scN = n.schema || "default", tbN = n.alias || n.identifier || n.name;
    const db = (dbs[dbN] ||= { name: dbN, comment: "", schemas: {} });
    const sc = (db.schemas[scN] ||= { name: scN, comment: "", tables: [] });
    if (sc.tables.some((t) => t.name === tbN)) continue;
    const colOrder = Object.keys(cat?.columns || {}).length ? Object.values(cat.columns).sort((a, b) => (a.index || 0) - (b.index || 0)).map((c) => c.name) : Object.keys(n.columns || {});
    const seen = new Set();
    const columns = [];
    for (const cn of colOrder) {
      if (seen.has(cn)) continue; seen.add(cn);
      const doc = n.columns?.[cn] || Object.values(n.columns || {}).find((c) => c.name?.toLowerCase() === cn.toLowerCase()) || {};
      const cc = cat?.columns?.[cn] || Object.values(cat?.columns || {}).find((c) => c.name?.toLowerCase() === cn.toLowerCase());
      const ts = tests[id]?.[cn] || tests[id]?.[doc.name] || new Set();
      const isPK = (ts.has("unique") && ts.has("not_null")) || ts.has("primary_key") || ts.has("dbt_constraints.primary_key") || (n.constraints || []).some((c) => c.type === "primary_key" && (c.columns || []).includes(cn)) || (doc.constraints || []).some((c) => c.type === "primary_key");
      columns.push({
        name: cn, type_text: String(cc?.type || doc.data_type || "STRING").toUpperCase(),
        nullable: !(ts.has("not_null") || isPK || (doc.constraints || []).some((c) => c.type === "not_null")), isPK,
        comment: doc.description || cc?.comment || "",
        ...(doc.meta?.business_term ? { businessTerm: String(doc.meta.business_term) } : {}),
        ...(doc.meta?.sensitivity ? { sensitivity: String(doc.meta.sensitivity) } : {}),
      });
    }
    const tags = (n.tags || []).length ? ` Tags: ${n.tags.join(", ")}.` : "";
    const src = n.resource_type === "source" ? `dbt source ${n.source_name}.${n.name}` : `dbt ${n.resource_type} ${n.name}${n.package_name ? ` (${n.package_name})` : ""}`;
    sc.tables.push({ name: tbN, type: typeOf(n, cat), comment: n.description || cat?.metadata?.comment || "", businessDefinition: `${src}.${tags}`.trim(), columns });
    tableCount++;
  }
  const lineage = [];
  for (const [id, n] of Object.entries(manifest.nodes || {})) {
    if (!keyOf[id]) continue;
    for (const parent of n.depends_on?.nodes || []) { if (keyOf[parent] && keyOf[parent] !== keyOf[id]) lineage.push([keyOf[parent], keyOf[id]]); }
  }
  if (!tableCount) throw new Error("the manifest contains no models, seeds, snapshots or sources");
  const databases = Object.values(dbs).map((d) => ({ ...d, schemas: Object.values(d.schemas).sort((a, b) => a.name.localeCompare(b.name)).map((sc) => ({ ...sc, tables: sc.tables.sort((a, b) => a.name.localeCompare(b.name)) })) }));
  return { databases, lineage, project: manifest.metadata?.project_name || "", tables: tableCount, dbtVersion: manifest.metadata?.dbt_version || "" };
}
