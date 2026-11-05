/* People directory helpers shared by the server modules that notify or describe catalog objects (v1.72, F-S5):
   person → account e-mail, and the readable path of a catalog object ("database.schema.table"). Pure functions. */
import { catalogIndex } from "../permissions.js";

/* the person record with this id, or null */
export const personById = (catalog, id) => (id && catalog ? (catalog.people || []).find((p) => p.id === id) || null : null);

/* the person's e-mail in lower case — only when it belongs to an account (`accounts`: Set of lower-case e-mails);
   without `accounts` any e-mail on the person record counts. null when there is none. */
export const accountEmailOf = (catalog, personId, accounts = null) => {
  const e = personById(catalog, personId)?.email;
  const email = e ? String(e).toLowerCase() : null;
  return email && (!accounts || accounts.has(email)) ? email : null;
};

/* readable path of a catalog object: tables "db.schema.table", schemas "db.schema", everything else its name (glossary
   terms: term); the id when the object is unknown */
export const entityPath = (catalog, type, id, ix = catalog ? catalogIndex(catalog) : null) => {
  if (!catalog) return id;
  if (type === "table") { const t = ix.tb.get(id) || (catalog.tables || []).find((x) => x.id === id); if (!t) return id; const sc = ix.sc.get(t.schemaId), d = sc && ix.db.get(sc.databaseId); return [d?.name, sc?.name, t.name].filter(Boolean).join("."); }
  if (type === "schema") { const sc = ix.sc.get(id); const d = sc && ix.db.get(sc.databaseId); return sc ? [d?.name, sc.name].filter(Boolean).join(".") : id; }
  const list = { database: catalog.databases, domain: catalog.domains, hub: catalog.hubs, glossary: catalog.glossary }[type] || [];
  const o = list.find((x) => x.id === id);
  return o?.name || o?.term || id;
};
