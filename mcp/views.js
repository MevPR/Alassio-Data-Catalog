/* Shapes the MCP tools return for databases and tables (v1.69 — moved out of mcp.js). */
import { effDomainId } from "../permissions.js";
import { reviewStatus, nextReviewAt } from "../src/lib/stewardship.js";
import { dbLayer, iso, tablePathById } from "./lookups.js";

export const dbSummary = (c, d) => ({
  hub: c.hubs.find((h) => h.id === d.hubId)?.name, database: d.name,
  country: d.country || "GLOBAL", layer: dbLayer(d), source: d.source || "manual", ...(d.sourceRef ? { source_ref: { kind: d.sourceRef.kind, host: d.sourceRef.host, url: d.sourceRef.url, catalog: d.sourceRef.catalog } } : {}),
  description: d.description || "", schemas: c.schemas.filter((s) => s.databaseId === d.id).length,
});
export const tableDetail = (c, d, sc, tb) => ({
  path: `${d.name}.${sc.name}.${tb.name}`, type: tb.type || "TABLE", layer: dbLayer(d), data_domain: c.domains.find((x) => x.id === effDomainId(c, "table", tb.id))?.name || null,
  description: tb.description || "", business_definition: tb.businessDefinition || "",
  steward: c.people.find((p) => p.id === tb.stewardId)?.name || null, owner: c.people.find((p) => p.id === tb.ownerId)?.name || null, glossary_term: tb.businessTerm || "", tags: tb.tags || "", table_tags: (tb.kvTags || []).reduce((o, k) => (o[k.key] = o[k.key] ? `${o[k.key]}, ${k.value}` : k.value, o), {}),
  certification: { status: tb.certStatus || "none", by: tb.certifiedBy || null, at: iso(tb.certifiedAt), note: tb.certNote || "", successor: tb.successorId ? tablePathById(c, tb.successorId) : null },
  review: { cycle_days: tb.reviewCycleDays || 0, status: reviewStatus(tb), last_reviewed_at: iso(tb.lastReviewedAt), last_reviewed_by: tb.lastReviewedBy || null, next_review_at: iso(nextReviewAt(tb)) },
  owner_attested_at: iso(tb.ownerAttestedAt),
  attributes: c.attributes.filter((a) => a.tableId === tb.id).map((a) => ({
    name: a.name, data_type: a.dataType, nullable: a.nullable !== false, is_pk: !!a.isPK,
    sensitivity: a.sensitivity || "Internal", classification: a.classification || "", description: a.description || "", business_term: a.businessTerm || "",
  })),
  upstream: c.lineage.filter((e) => e.to === tb.id).map((e) => ({ table: tablePathById(c, e.from), attribute_mappings: (e.mappings || []).length })),
  downstream: c.lineage.filter((e) => e.from === tb.id).map((e) => ({ table: tablePathById(c, e.to), attribute_mappings: (e.mappings || []).length })),
});
