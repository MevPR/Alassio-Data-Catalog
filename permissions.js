/**
 * Alassio Data Catalog — permission model (shared by server and browser).
 *
 * Account roles (server/config.js ROLES, eight): admin, steward, guest, the workflow roles pm | ingestion | ba | dpd,
 * and agent (technical MCP accounts). Responsibilities are people-based:
 * a signed-in user is matched to the people directory by e-mail (case-insensitive)
 * or, as fallback, by exact name. "Owner" and "Steward" below refer to those
 * effective responsibilities, which inherit downwards and can be overridden on
 * every level:
 *
 *   owner   : table.ownerId ‖ schema.ownerId ‖ database.ownerId ‖ domain.ownerId ‖ dataHub.bpoId   (the BPO; data hub types have no owner)
 *   steward : table.stewardId ‖ schema.stewardId ‖ database.stewardId ‖ domain.stewardId   (data hubs have no stewards)
 *
 * Rules:
 *   - only admins invite users, change structure (hubs, databases, schemas, domains, people) and set owners
 *   - admins and the owner of an asset set its steward
 *   - stewards (and owners) edit tables and attributes they are responsible for
 *   - lineage between two tables: admin, or owner/steward of either table
 *   - glossary terms: admin, or anyone who is owner/steward of at least one asset
 *   - guests and workflow roles (Project Manager, Data Ingestion, Data Product Development) never edit the catalog
 */

const lower = (s) => String(s || "").trim().toLowerCase();

export const personIdsForUser = (c, user) => {
  if (!user) return new Set();
  const em = lower(user.email), nm = lower(user.name);
  /* v1.66.1: a person with an e-mail is matched by e-mail only; the display-name fallback applies to records without one */
  return new Set((c.people || []).filter((p) => (p.email ? lower(p.email) === em : nm && lower(p.name) === nm)).map((p) => p.id));
};

const KEYS = ["hubs", "databases", "schemas", "tables", "attributes", "domains"];
const buildIdx = (c) => ({
  hub: new Map((c.hubs || []).map((x) => [x.id, x])),
  db: new Map((c.databases || []).map((x) => [x.id, x])),
  sc: new Map((c.schemas || []).map((x) => [x.id, x])),
  tb: new Map((c.tables || []).map((x) => [x.id, x])),
  at: new Map((c.attributes || []).map((x) => [x.id, x])),
  dm: new Map((c.domains || []).map((x) => [x.id, x])),
});
/* id → record maps, cached per catalog object (callers such as the search index or the OKF export ask for
   thousands of chains; rebuilding six maps of a 400,000-attribute catalog per call would be quadratic).
   The cache is invalidated when a collection's length changes; documents are otherwise replaced, not mutated. */
const idxCache = new WeakMap();
const idx = (c) => {
  const sizes = KEYS.map((k) => (c[k] || []).length).join(",");
  const hit = idxCache.get(c);
  if (hit && hit.sizes === sizes) return hit.ix;
  const ix = buildIdx(c);
  idxCache.set(c, { sizes, ix });
  return ix;
};
export const catalogIndex = idx;

/* chain of records from the asset up to its hub: [table, schema, database, domain, hub] (missing levels skipped) */
export const chainOf = (c, type, id, ix = idx(c)) => {
  let tb = null, sc = null, d = null, h = null, dm = null;
  if (type === "attribute") { const a = ix.at.get(id); tb = a && ix.tb.get(a.tableId); }
  if (type === "table") tb = ix.tb.get(id);
  if (tb) sc = ix.sc.get(tb.schemaId);
  if (type === "schema") sc = ix.sc.get(id);
  if (sc) d = ix.db.get(sc.databaseId);
  if (type === "database") d = ix.db.get(id);
  if (d) h = ix.hub.get(d.hubId);
  if (type === "hub") h = ix.hub.get(id);
  if (type === "domain") dm = ix.dm.get(id);
  /* the data hub (free-text level inside a type) carries the BPO — the top of the ownership chain; types have no owner */
  let dh = null;
  if (d && h) { const rec = (h.dataHubs || []).find((x) => x.name === (d.country || "GLOBAL")); if (rec) dh = { ownerId: rec.bpoId || null, stewardId: null, domainId: rec.domainId || null, __datahub: true }; }
  if (type === "datahub") { const hh = ix.hub.get(id?.hubId); const rec = hh && (hh.dataHubs || []).find((x) => x.name === id?.name); if (rec) dh = { ownerId: rec.bpoId || null, stewardId: null, domainId: rec.domainId || null, __datahub: true }; h = hh || null; }
  /* the data domain inherits downwards (data hub → database → schema → table) and can be overridden on every level */
  const dmId = [tb, sc, d, dh, h].find((r) => r && r.domainId)?.domainId;
  if (!dm && dmId) dm = ix.dm.get(dmId);
  const out = [tb, sc, d, dm, dh].filter(Boolean);
  if (type === "hub") return dm ? [dm] : [];
  return out;
};
export const effDomainId = (c, type, id, ix = idx(c)) => {
  const chain = chainOf(c, type, id, ix);
  const dm = chain.find((r) => (c.domains || []).includes(r));
  return dm ? dm.id : null;
};
export const effOwnerId = (c, type, id, ix) => chainOf(c, type, id, ix).map((r) => r.ownerId).find(Boolean) || null;
export const effStewardId = (c, type, id, ix) => chainOf(c, type, id, ix).filter((r) => !r.__datahub).map((r) => r.stewardId).find(Boolean) || null;

export function buildPerms(c, user) {
  const role = user?.role || "guest";
  const isAdmin = role === "admin";
  const mine = isAdmin ? new Set() : personIdsForUser(c, user);
  const ix = idx(c);
  const isOwner = (type, id) => isAdmin || mine.has(effOwnerId(c, type, id, ix));
  const isSteward = (type, id) => isAdmin || mine.has(effStewardId(c, type, id, ix));
  const responsible = (type, id) => isOwner(type, id) || isSteward(type, id);
  const anyResponsibility = isAdmin || (mine.size > 0 && [...(c.tables || []).map((t) => ["table", t.id]), ...(c.schemas || []).map((s) => ["schema", s.id]),
    ...(c.databases || []).map((d) => ["database", d.id]), ...(c.domains || []).map((d) => ["domain", d.id]), ...(c.hubs || []).map((h) => ["hub", h.id])]
    .some(([t, id]) => responsible(t, id)));
  const guest = !(role === "admin" || role === "steward"); /* workflow roles (pm, ingestion, dpd) and guests do not edit the catalog */
  return {
    role, isAdmin, mine,
    canEditStructure: isAdmin,                                     // hubs, databases, schemas, domains, people
    canSetOwner: isAdmin,
    canSetSteward: (type, id) => !guest && isOwner(type, id),
    canEditTable: (id) => !guest && responsible("table", id),
    canCreateTableIn: (schemaId) => !guest && responsible("schema", schemaId),
    canEditAttribute: (id) => !guest && responsible("attribute", id),
    canEditLineage: (fromId, toId) => !guest && (responsible("table", fromId) || responsible("table", toId)),
    canEditGlossary: !guest && anyResponsibility,
    canEditAnything: !guest && (isAdmin || anyResponsibility),
    isOwner, isSteward, responsible,
  };
}

/* Server-side gate for delta saves: returns a list of violations (empty = allowed). `prev` is the catalog before the changes. */
export function authorizeChanges(prev, user, changes) {
  const p = buildPerms(prev, user);
  if (p.isAdmin) return [];
  const v = [];
  const deny = (ch, why) => v.push({ id: ch.id, entityType: ch.entityType, name: ch.after?.name || ch.before?.name, reason: why });
  const ownerChanged = (ch) => (ch.before?.ownerId ?? null) !== (ch.after?.ownerId ?? null);
  const stewardChanged = (ch) => (ch.before?.stewardId ?? null) !== (ch.after?.stewardId ?? null);
  const onlyTagsChanged = (ch) => { const a = { ...ch.before, kvTags: null }, b = { ...ch.after, kvTags: null }; return JSON.stringify(a) === JSON.stringify(b); };
  const onlyStewardChanged = (ch) => { const a = { ...ch.before, stewardId: null }, b = { ...ch.after, stewardId: null }; return JSON.stringify(a) === JSON.stringify(b); };
  const ATTEST = ["ownerAttestedAt", "ownerAttestedBy"];
  const attestChanged = (ch) => ATTEST.some((k) => JSON.stringify(ch.before?.[k] ?? null) !== JSON.stringify(ch.after?.[k] ?? null));
  const onlyAttestChanged = (ch) => { const strip = (o) => { const x = { ...o }; for (const k of ATTEST) delete x[k]; return x; }; return JSON.stringify(strip(ch.before || {})) === JSON.stringify(strip(ch.after || {})); };
  for (const ch of changes) {
    const t = ch.entityType;
    if (p.role === "guest") { deny(ch, "guests cannot edit"); continue; }
    if (ch.after && ownerChanged(ch) && ch.action !== "deleted") { deny(ch, "only admins set data owners"); continue; }
    /* ownership attestation is the owner's own statement (v1.56) */
    if (ch.action === "updated" && attestChanged(ch) && !p.isOwner(t, ch.id)) { deny(ch, "only the data owner attests ownership"); continue; }
    if (["hub", "database", "schema", "domain", "person"].includes(t)) {
      if (ch.action === "updated" && onlyStewardChanged(ch) && p.canSetSteward(t, ch.id)) continue;
      if (ch.action === "updated" && onlyAttestChanged(ch) && p.isOwner(t, ch.id)) continue;
      if (t === "schema" && ch.action === "updated" && onlyTagsChanged(ch) && p.responsible("schema", ch.id)) continue;
      deny(ch, ch.action === "updated" && stewardChanged(ch) ? "only admins or the data owner set the steward" : "only admins change hubs, databases, schemas, domains and people");
      continue;
    }
    if (t === "table") {
      if (ch.action === "created") { if (!p.canCreateTableIn(ch.after?.schemaId)) deny(ch, "not owner/steward of this schema"); continue; }
      if (!p.canEditTable(ch.id)) { deny(ch, "not owner/steward of this table"); continue; }
      /* v1.66.1: moving a table needs the responsibility for the target schema as well */
      if (ch.action === "updated" && (ch.before?.schemaId ?? null) !== (ch.after?.schemaId ?? null) && !p.canCreateTableIn(ch.after?.schemaId)) { deny(ch, "not owner/steward of the target schema"); continue; }
      if (ch.action === "updated" && (ch.before?.domainId ?? null) !== (ch.after?.domainId ?? null) && !p.isOwner("table", ch.id)) { deny(ch, "only admins or the data owner set the data domain"); continue; }
      if (ch.action === "updated" && stewardChanged(ch) && !p.canSetSteward("table", ch.id)) deny(ch, "only admins or the data owner set the steward");
      continue;
    }
    if (t === "attribute") {
      /* v1.66.1: both the table the attribute belongs to and the table it would move to must be the user's */
      const fromId = ch.before?.tableId, toId = ch.after?.tableId;
      if ((fromId && !p.canEditTable(fromId)) || (toId && !p.canEditTable(toId)) || (!fromId && !toId)) deny(ch, "not owner/steward of this table");
      continue;
    }
    if (t === "lineage") {
      const rec = ch.after || ch.before || {};
      if (!p.canEditLineage(rec.from, rec.to)) deny(ch, "not owner/steward of either table");
      continue;
    }
    if (t === "glossary_term") { if (!p.canEditGlossary) deny(ch, "glossary editing requires an owner or steward responsibility"); continue; }
    deny(ch, "unknown entity type");
  }
  return v;
}

/* Which assignment fields a create / edit dialog offers (v1.73 — moved here from the UI's modal host so the rules sit
   next to the ones the server enforces). `p` = buildPerms(…). The server still authorises every change. */
/* entity dialog: dialog = { kind, edit?, parentId? }. A new table / schema may get a steward from the owner of its
   parent; the data domain is a table-level field for admins and the table's (or new table's schema's) owner. */
export function entityDialogPerms(p, { kind, edit = null, parentId = null } = {}) {
  const canSetSteward = p.isAdmin || (edit ? p.canSetSteward(kind, edit.id)
    : kind === "table" ? p.isOwner("schema", parentId) : kind === "schema" ? p.isOwner("database", parentId) : false);
  const canSetDomain = p.isAdmin || (kind === "table" && (edit ? p.isOwner("table", edit.id) : p.isOwner("schema", parentId)));
  return { canSetOwner: p.canSetOwner, canSetSteward, canSetDomain };
}
/* glossary term dialog: a new term may name its steward; an existing one only by admins or the term's owner */
export const glossaryDialogPerms = (p, edit = null) => ({
  canSetOwner: p.canSetOwner,
  canSetSteward: p.isAdmin || (edit?.ownerId ? p.mine.has(edit.ownerId) : !edit),
});
