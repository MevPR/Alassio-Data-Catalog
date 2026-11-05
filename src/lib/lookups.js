/* Read-only lookups over a catalog document.
   `makeLookups(state, lazy)` returns plain functions (no React) that the views, the search index,
   the CSV export and the context share. Everything here is pure — it never mutates `state`. */

import { isSourceHub as isSourceHubOf } from "./model.js";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
export const byName = (a, b) => collator.compare(a?.name || "", b?.name || "");
export const sortByName = (list) => [...list].sort(byName);

export function makeLookups(state, lazy = { on: false, loaded: new Set(), stats: null }) {
  const { hubs = [], people = [], domains = [], databases = [], schemas = [], tables = [], attributes = [], lineage = [] } = state;
  const glossary = state.glossary || [];

  const hub = (id) => hubs.find((h) => h.id === id);
  const person = (id) => people.find((p) => p.id === id);
  const domain = (id) => domains.find((d) => d.id === id);
  const db = (id) => databases.find((d) => d.id === id);
  const schema = (id) => schemas.find((s) => s.id === id);
  const table = (id) => tables.find((t) => t.id === id);
  const attribute = (id) => attributes.find((a) => a.id === id);
  /* children are listed alphabetically (natural order: TABLE_2 before TABLE_10); attributes keep their column order */
  const dbsOf = (hubId) => sortByName(databases.filter((d) => d.hubId === hubId));
  const schemasOf = (dbId) => sortByName(schemas.filter((s) => s.databaseId === dbId));
  const tablesOf = (scId) => sortByName(tables.filter((t) => t.schemaId === scId));
  const attrsOf = (tbId) => attributes.filter((a) => a.tableId === tbId);
  const attrCount = (tbId) => (lazy.on && !lazy.loaded.has(tbId)) ? (lazy.stats?.perTable?.[tbId] || 0) : attrsOf(tbId).length;
  const upstreamOf = (tbId) => lineage.filter((e) => e.to === tbId);
  const downstreamOf = (tbId) => lineage.filter((e) => e.from === tbId);

  const isSourceHub = isSourceHubOf;
  const dbLayer = (d) => d?.layer || "other";
  const isSourceHubDb = (d) => isSourceHub(hub(d?.hubId));
  const layerOf = (t) => {
    const d = db(schema(t?.schemaId)?.databaseId);
    return isSourceHubDb(d) ? "source" : dbLayer(d);
  };
  const isGoldSchema = (sc) => dbLayer(db(sc.databaseId)) === "gold";
  const isDataProduct = isGoldSchema;

  /* data hubs of a type: the declared ones plus the ones implied by databases (database.country) */
  const dataHubsOf = (h) => {
    const names = new Set([...(h.dataHubs || []).map((x) => x.name), ...dbsOf(h.id).map((x) => x.country || "GLOBAL")]);
    return [...names].sort((a, b) => a.localeCompare(b)).map((name) => (h.dataHubs || []).find((x) => x.name === name) || { name, description: "" });
  };

  /* dotted path of a catalog object, e.g. DB.SCHEMA.TABLE.ATTRIBUTE */
  const refLabel = (r) => {
    if (!r) return null;
    if (r.type === "hub") return hub(r.id)?.name;
    if (r.type === "database") { const d = db(r.id); return d && `${hub(d.hubId)?.name} · ${d.name}`; }
    if (r.type === "schema") { const sc = schema(r.id); const d = db(sc?.databaseId); return sc && `${d?.name}.${sc.name}`; }
    if (r.type === "table") { const t = table(r.id); const sc = schema(t?.schemaId); const d = db(sc?.databaseId); return t && `${d?.name}.${sc?.name}.${t.name}`; }
    if (r.type === "attribute") { const a = attribute(r.id); const t = table(a?.tableId); const sc = schema(t?.schemaId); const d = db(sc?.databaseId); return a && `${d?.name}.${sc?.name}.${t?.name}.${a.name}`; }
    return null;
  };
  const tablePath = (tb) => { const sc = schema(tb?.schemaId); const d = db(sc?.databaseId); return `${d?.name}.${sc?.name}.${tb?.name}`; };

  /* breadcrumb path for a selection: [[type, object], …] */
  const co = (d) => d ? { id: `co:${d.id}`, name: d.country || "GLOBAL" } : null;
  const pathOf = (s) => {
    if (!s) return [];
    if (s.type === "hub") return [["hub", hub(s.id)]];
    if (s.type === "datahub") return [["hub", hub(s.hubId)], ["country", { id: `dh:${s.hubId}:${s.name}`, name: s.name, hubId: s.hubId }]];
    if (s.type === "database") { const d = db(s.id); return [["hub", hub(d?.hubId)], ["country", co(d)], ["database", d]]; }
    if (s.type === "schema") { const sc = schema(s.id); const d = db(sc?.databaseId); return [["hub", hub(d?.hubId)], ["country", co(d)], ["database", d], ["schema", sc]]; }
    if (s.type === "table") { const tb = table(s.id); const sc = schema(tb?.schemaId); const d = db(sc?.databaseId); return [["hub", hub(d?.hubId)], ["country", co(d)], ["database", d], ["schema", sc], ["table", tb]]; }
    return [];
  };

  return {
    hubs, people, domains, databases, schemas, tables, attributes, lineage, glossary,
    hub, person, domain, db, schema, table, attribute,
    dbsOf, schemasOf, tablesOf, attrsOf, attrCount, upstreamOf, downstreamOf,
    isSourceHub, dbLayer, isSourceHubDb, layerOf, isGoldSchema, isDataProduct,
    dataHubsOf, refLabel, tablePath, pathOf,
  };
}
