/**
 * Alassio Data Catalog — CSV export rows (shared, pure).
 * csvRowsOf(catalog, selection) yields one row per attribute (containers without children yield one row each) using
 * hash-map lookups, so 400,000 attributes stream in seconds. The column set is fixed (CSV_COLUMNS) and re-imports 1:1.
 * selection: { tableIds: string[]|null, schemaIds: string[], databaseIds: string[] } — tableIds null = everything.
 */
import { effDomainId, catalogIndex } from "./permissions.js";

export const CSV_COLUMNS = ["data_hub_type", "data_hub", "database", "database_description", "domain", "domain_owner", "domain_steward", "source", "layer",
  "schema", "schema_description", "table", "table_type", "table_description", "business_definition", "table_owner", "table_steward", "table_glossary_term", "table_domain", "project", "tags",
  "attribute", "data_type", "nullable", "primary_key", "attribute_description", "business_term", "sensitivity", "classification"];

const groupBy = (list, key) => { const m = new Map(); for (const x of list || []) { const k = x[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };

/* `attrsOf(tableId)` (sync or async) overrides the catalog's attribute array — exporters stream attributes per table (v1.59) */
export async function* csvRowsOf(catalog, { tableIds = null, schemaIds = [], databaseIds = [] } = {}, attrsOf = null) {
  const c = catalog;
  const ix = catalogIndex(c);
  const selTb = tableIds ? new Set(tableIds) : null;
  const selSc = new Set(schemaIds), selDb = new Set(databaseIds);
  const scsOf = groupBy(c.schemas, "databaseId"), tbsOf = groupBy(c.tables, "schemaId"), atsOf = attrsOf ? null : groupBy(c.attributes, "tableId");
  const attrs = attrsOf || ((id) => atsOf.get(id) || []);
  const people = new Map((c.people || []).map((p) => [p.id, p]));
  const pname = (id) => (id && people.get(id)?.name) || "";
  const scIncluded = (sc) => selTb === null || selSc.has(sc.id) || (tbsOf.get(sc.id) || []).some((t) => selTb.has(t.id));
  for (const d of c.databases || []) {
    const scs = scsOf.get(d.id) || [];
    if (!(selTb === null || selDb.has(d.id) || scs.some(scIncluded))) continue;
    const h = ix.hub.get(d.hubId); const dm = ix.dm.get(effDomainId(c, "database", d.id, ix));
    const base = { data_hub_type: h?.name || "Central", data_hub: d.country || "GLOBAL", database: d.name, database_description: d.description || "",
      domain: dm?.name || "", domain_owner: pname(dm?.ownerId), domain_steward: pname(dm?.stewardId), source: d.source || "manual" };
    const scsIn = scs.filter(scIncluded);
    if (!scsIn.length) { yield { ...base, schema: "", table: "", attribute: "" }; continue; }
    for (const sc of scsIn) {
      const tbs = (tbsOf.get(sc.id) || []).filter((t) => selTb === null || selTb.has(t.id));
      if (!tbs.length) { yield { ...base, schema: sc.name, schema_description: sc.description || "", table: "", attribute: "" }; continue; }
      for (const tb of tbs) {
        const tbase = { ...base, schema: sc.name, schema_description: sc.description || "", table: tb.name, table_type: tb.type, table_description: tb.description || "",
          business_definition: tb.businessDefinition || "", table_owner: pname(tb.ownerId), table_steward: pname(tb.stewardId), table_glossary_term: tb.businessTerm || "",
          table_domain: ix.dm.get(effDomainId(c, "table", tb.id, ix))?.name || "", project: (tb.kvTags || []).filter((k) => k.key === "Project").map((k) => k.value).join("; "), tags: tb.tags || "", layer: d.layer || "other" };
        const ats = (await attrs(tb.id)) || [];
        if (!ats.length) { yield { ...tbase, attribute: "" }; continue; }
        for (const a of ats) yield { ...tbase, attribute: a.name, data_type: a.dataType, nullable: a.nullable ? "true" : "false", primary_key: a.isPK ? "true" : "false",
          attribute_description: a.description || "", business_term: a.businessTerm || "", sensitivity: a.sensitivity || "", classification: a.classification || "" };
      }
    }
  }
}
export const csvRows = async (catalog, selection, attrsOf = null) => { const out = []; for await (const r of csvRowsOf(catalog, selection, attrsOf)) out.push(r); return out; };
