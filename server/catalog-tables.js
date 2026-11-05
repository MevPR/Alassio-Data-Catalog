/* Relational layout of the catalog document: one table per collection (phase 1 of the scalable data model). */
export const CAT_TABLES = {
  cat_hubs: null, cat_domains: null, cat_people: null, cat_glossary: null,
  cat_databases: "hub_id", cat_schemas: "database_id", cat_tables: "schema_id",
  cat_attributes: "table_id", cat_lineage: "from_id",
};
/* [catalog key, table, audit entityType, parent field in record] */
export const COLL = [
  ["hubs", "cat_hubs", "hub", null], ["domains", "cat_domains", "domain", null], ["people", "cat_people", "person", null],
  ["glossary", "cat_glossary", "glossary_term", null], ["databases", "cat_databases", "database", "hubId"],
  ["schemas", "cat_schemas", "schema", "databaseId"], ["tables", "cat_tables", "table", "schemaId"],
  ["attributes", "cat_attributes", "attribute", "tableId"], ["lineage", "cat_lineage", "lineage", "from"],
];
/* an empty catalog document — every collection present (v1.72) */
export const EMPTY_CATALOG = () => Object.fromEntries(COLL.map(([key]) => [key, []]));
export const TYPE_TO_TABLE = Object.fromEntries(COLL.map(([key, tbl, type, parent]) => [type, { key, tbl, parent }]));
export const searchTextOf = (key, r) => [r.name, r.description, r.businessDefinition, r.businessTerm, r.definition, r.tags, r.country, r.dataType,
  ...(r.kvTags || []).map((k) => `${k.key} ${k.value}`)].filter(Boolean).join(" ").slice(0, 8000) || null;
