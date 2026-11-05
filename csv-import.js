/**
 * Alassio Data Catalog — CSV import merge (shared, pure).
 * mergeCsvRows(catalog, rows) merges parsed CSV rows (keys normalised with csvHeader) into a catalog document:
 * existing objects are matched by name (hub type / database / schema / table / attribute), missing ones are created.
 * All lookups go through hash maps, so 400,000 rows merge in well under a second.
 *
 * Returns { next, created, counts } where `next` shares the untouched arrays with `catalog` and holds new arrays for
 * the collections that received records, `created` lists the new records per collection (for audit entries and
 * row persistence) and `counts` sums them up.
 */
import { uid, normCountry, LAYERS, guessLayer } from "./src/lib/model.js";

export const CSV_CLASSES = ["C1", "C2", "C3", "C4"];
const norm = (x) => String(x || "").trim().toLowerCase();

/* ids of the EXISTING tables the rows address (database / schema / table matched by name) — the server loads only
   their attributes before merging into the lite document (v1.56: the full document is never assembled) */
export function csvTouchedTableIds(catalog, rows) {
  const c = catalog || {};
  const dbByName = new Map((c.databases || []).map((d) => [d.name, d]));
  const key = (a, b) => `${a}\u0000${b}`;
  const scByKey = new Map((c.schemas || []).map((s) => [key(s.databaseId, s.name), s]));
  const tbByKey = new Map((c.tables || []).map((t) => [key(t.schemaId, t.name), t]));
  const out = new Set();
  for (const r of rows) {
    if (!r.database || !r.schema || !r.table) continue;
    const d = dbByName.get(r.database); if (!d) continue;
    const sc = scByKey.get(key(d.id, r.schema)); if (!sc) continue;
    const tb = tbByKey.get(key(sc.id, r.table)); if (tb) out.add(tb.id);
  }
  return [...out];
}

export function mergeCsvRows(catalog, rows, { idGen = uid } = {}) {
  const c = catalog || {};
  const next = { ...c };
  for (const k of ["hubs", "domains", "people", "databases", "schemas", "tables", "attributes"]) next[k] = [...(c[k] || [])];
  const created = { hubs: [], domains: [], people: [], databases: [], schemas: [], tables: [], attributes: [] };
  const add = (key, rec) => { next[key].push(rec); created[key].push(rec); return rec; };

  /* indexes */
  const hubByName = new Map(next.hubs.map((h) => [norm(h.name), h]));
  const hubById = new Map(next.hubs.map((h) => [h.id, h]));
  const domainByName = new Map(next.domains.map((d) => [norm(d.name), d]));
  const personByName = new Map(next.people.map((p) => [norm(p.name), p]));
  const dbByName = new Map(next.databases.map((d) => [d.name, d]));
  const scKey = (dbId, name) => `${dbId}\u0000${name}`;
  const scByKey = new Map(next.schemas.map((s) => [scKey(s.databaseId, s.name), s]));
  const tbByKey = new Map(next.tables.map((t) => [scKey(t.schemaId, t.name), t]));
  const atByKey = new Map(next.attributes.map((a) => [scKey(a.tableId, a.name), a]));

  const findOrPerson = (name) => {
    const n = norm(name); if (!n) return null;
    let p = personByName.get(n);
    if (!p) { p = add("people", { id: idGen(), name: String(name).trim(), email: "" }); personByName.set(n, p); }
    return p.id;
  };
  const findOrDomain = (name) => {
    const raw = String(name || "").trim(); const n = norm(raw); if (!n) return null;
    let dm = domainByName.get(n);
    if (!dm) { dm = add("domains", { id: idGen(), name: raw, description: "", ownerId: null, stewardId: null }); domainByName.set(n, dm); }
    return dm.id;
  };
  const hubIdFor = (name) => {
    const raw = String(name || "").trim(); const n = raw.toLowerCase();
    if (!n) return hubById.get("central")?.id || next.hubs[0]?.id;
    let h = hubByName.get(n) || (n === "p&c" ? hubById.get("pc") : null);
    if (!h) { h = add("hubs", { id: idGen(), name: raw, description: "", ownerId: null, stewardId: null }); hubByName.set(n, h); hubById.set(h.id, h); }
    return h.id;
  };

  for (const r of rows) {
    if (!r.database) continue;
    let dmId = null;
    if (r.domain) {   /* owner / steward persons are only created together with a new domain */
      const n = norm(r.domain); let dm = domainByName.get(n);
      if (!dm) { dm = add("domains", { id: idGen(), name: String(r.domain).trim(), description: "", ownerId: findOrPerson(r.domain_owner), stewardId: findOrPerson(r.domain_steward) }); domainByName.set(n, dm); }
      dmId = dm.id;
    }
    let d = dbByName.get(r.database);
    if (!d) {
      d = add("databases", { id: idGen(), name: r.database, description: r.database_description || "", hubId: hubIdFor(r.data_hub_type !== undefined ? r.data_hub_type : r.data_hub), country: normCountry(r.data_hub_type !== undefined ? r.data_hub : r.country), layer: LAYERS.includes(r.layer) ? r.layer : guessLayer(r.database), domainId: dmId, source: r.source || "csv" });
      dbByName.set(d.name, d);
    }
    if (!r.schema) continue;
    let sc = scByKey.get(scKey(d.id, r.schema));
    if (!sc) { sc = add("schemas", { id: idGen(), databaseId: d.id, name: r.schema, description: r.schema_description || "" }); scByKey.set(scKey(d.id, sc.name), sc); }
    if (!r.table) continue;
    let tb = tbByKey.get(scKey(sc.id, r.table));
    if (!tb) {
      tb = add("tables", { id: idGen(), schemaId: sc.id, name: r.table, type: r.table_type || "TABLE", description: r.table_description || "", businessDefinition: r.business_definition || "", ownerId: findOrPerson(r.table_owner), stewardId: findOrPerson(r.table_steward), businessTerm: r.table_glossary_term || "", domainId: r.table_domain ? findOrDomain(r.table_domain) : null, tags: r.tags || "", kvTags: String(r.project || "").split(";").map((x) => x.trim()).filter(Boolean).map((v) => ({ key: "Project", value: v })) });
      tbByKey.set(scKey(sc.id, tb.name), tb);
    }
    if (!r.attribute) continue;
    const ak = scKey(tb.id, r.attribute);
    if (!atByKey.has(ak)) {
      atByKey.set(ak, add("attributes", {
        id: idGen(), tableId: tb.id, name: r.attribute, dataType: r.data_type || "STRING",
        nullable: String(r.nullable).toLowerCase() !== "false", isPK: String(r.primary_key).toLowerCase() === "true",
        description: r.attribute_description || "", businessTerm: r.business_term || "", sensitivity: r.sensitivity || "Internal",
        classification: CSV_CLASSES.includes(String(r.classification || "").toUpperCase()) ? String(r.classification).toUpperCase() : "",
      }));
    }
  }
  const counts = Object.fromEntries(Object.entries(created).map(([k, v]) => [k, v.length]));
  counts.total = Object.values(created).reduce((n, v) => n + v.length, 0);
  return { next, created, counts };
}
