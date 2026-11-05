/* Full-text search over the catalog: index building and ranking (pure functions, no React). */
import { effDomainId } from "../../permissions.js";

/* One flat document per catalog object; `fields` are the searchable texts. */
export function buildSearchDocs(state, L) {
  const docs = [];
  for (const h of L.hubs) docs.push({ type: "hub", id: h.id, name: h.name, context: "", hubId: h.id, fields: { name: h.name, description: h.description || "" } });
  for (const d of L.databases) docs.push({ type: "database", id: d.id, name: d.name, context: L.hub(d.hubId)?.name || "", hubId: d.hubId, layer: L.dbLayer(d), fields: { name: d.name, description: d.description || "", domain: L.domain(d.domainId)?.name || "", country: d.country || "GLOBAL" } });
  for (const sc of L.schemas) { const d = L.db(sc.databaseId); docs.push({ type: "schema", id: sc.id, name: sc.name, context: d?.name || "", hubId: d?.hubId, layer: L.dbLayer(d), fields: { name: sc.name, description: sc.description || "" } }); }
  for (const t of L.tables) {
    const sc = L.schema(t.schemaId); const d = L.db(sc?.databaseId);
    docs.push({ type: "table", id: t.id, name: t.name, context: `${d?.name || "?"}.${sc?.name || "?"}`, hubId: d?.hubId, layer: L.dbLayer(d), fields: { domain: L.domain(effDomainId(state, "table", t.id))?.name || "", name: t.name, description: t.description || "", business: t.businessDefinition || "", tags: t.tags || "", steward: L.person(t.stewardId)?.name || "" } });
  }
  for (const a of L.attributes) docs.push(attributeDoc(L, a));
  return docs;
}
/* one attribute document — also used for attributes the server found that the lazy document does not hold (v1.66) */
export const attributeDoc = (L, a) => {
  const t = L.table(a.tableId); const sc = L.schema(t?.schemaId); const d = L.db(sc?.databaseId);
  return { type: "attribute", id: a.id, tableId: a.tableId, name: a.name, context: `${d?.name || "?"}.${sc?.name || "?"}.${t?.name || "?"}`, hubId: d?.hubId, layer: L.dbLayer(d), sensitivity: a.sensitivity, fields: { name: a.name, description: a.description || "", business: a.businessTerm || "", dataType: a.dataType || "" } };
};

const FIELD_WEIGHTS = { name: 10, business: 6, tags: 4, steward: 3, domain: 3, dataType: 3, country: 3, description: 2 };
export const EMPTY_FACETS = { type: "", hub: "", layer: "", sensitivity: "" };

const passesFacets = (doc, f) =>
  !(f.type && doc.type !== f.type) && !(f.hub && doc.hubId !== f.hub) && !(f.layer && doc.layer !== f.layer) && !(f.sensitivity && doc.sensitivity !== f.sensitivity);

/* Ranks the documents for a query. When the server returned a FULLTEXT ranking for exactly this query
   (`serverHits = { q, order: Map(id → rank) }`) that order wins; otherwise a weighted client-side ranking is used. */
export function rankSearch(docs, query, facets = EMPTY_FACETS, serverHits = null, limit = 100) {
  const qq = String(query || "").trim().toLowerCase();
  if (!qq) return [];
  const terms = qq.split(/\s+/).filter(Boolean);
  if (serverHits && serverHits.q.toLowerCase() === qq && serverHits.order.size) {
    const out = [];
    for (const doc of docs) {
      const rank = serverHits.order.get(doc.id);
      if (rank === undefined || !passesFacets(doc, facets)) continue;
      const m = Object.entries(doc.fields).find(([f, v]) => f !== "name" && v && terms.some((t) => String(v).toLowerCase().includes(t)));
      out.push({ ...doc, score: 1000 - rank, match: m ? { field: m[0], value: m[1] } : null });
    }
    if (out.length) return out.sort((a, b) => b.score - a.score);
  }
  const out = [];
  for (const doc of docs) {
    if (!passesFacets(doc, facets)) continue;
    let total = 0, match = null, ok = true;
    for (const term of terms) {
      let best = 0;
      for (const [f, w] of Object.entries(FIELD_WEIGHTS)) {
        const v = (doc.fields[f] || "").toLowerCase();
        if (!v || !v.includes(term)) continue;
        const s = v === term ? w * 3 : v.startsWith(term) ? w * 2 : w;
        if (s > best) best = s;
        if (f !== "name" && !match) match = { field: f, value: doc.fields[f] };
      }
      if (!best) { ok = false; break; }
      total += best;
    }
    if (ok) out.push({ ...doc, score: total, match });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
