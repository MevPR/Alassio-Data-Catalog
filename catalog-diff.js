/**
 * Alassio Data Catalog — shared change engine (server + browser).
 * diffCatalogs(prev, next, user) → audit-style entries (created/updated/deleted)
 * with field-level changes. Used by the server for audit + row persistence and
 * by the UI to send only deltas (phase 2 of the scalable data model).
 */
const newId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Math.random().toString(16).slice(2) + Date.now().toString(16));
export const auditUserRef = (u) => ({ id: u.id, name: u.name, email: u.email });
export const AUDIT_COLL = [
  ["hub", "hubs"], ["database", "databases"], ["schema", "schemas"],
  ["table", "tables"], ["attribute", "attributes"], ["domain", "domains"],
  ["person", "people"], ["lineage", "lineage"], ["glossary_term", "glossary"],
];
export const recChanges = (a, b) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = [];
  for (const k of keys) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push({ field: k, from: a[k] ?? null, to: b[k] ?? null });
  return out;
};
/* id → record maps of one catalog, built once per diff (never per entry — bulk imports would be quadratic otherwise) */
export const catalogMaps = (c) => ({
  db: new Map((c?.databases || []).map((x) => [x.id, x])),
  sc: new Map((c?.schemas || []).map((x) => [x.id, x])),
  tb: new Map((c?.tables || []).map((x) => [x.id, x])),
});
const scopeAndContext = (type, rec, m) => {
  if (type === "attribute") {
    const tb = m.tb.get(rec.tableId), sc = tb && m.sc.get(tb.schemaId), d = sc && m.db.get(sc.databaseId);
    return { scope: [rec.id, rec.tableId, tb?.schemaId, sc?.databaseId].filter(Boolean), context: [d?.name, sc?.name, tb?.name].filter(Boolean).join(".") };
  }
  if (type === "table") {
    const sc = m.sc.get(rec.schemaId), d = sc && m.db.get(sc.databaseId);
    return { scope: [rec.id, rec.schemaId, sc?.databaseId].filter(Boolean), context: [d?.name, sc?.name].filter(Boolean).join(".") };
  }
  if (type === "schema") return { scope: [rec.id, rec.databaseId].filter(Boolean), context: m.db.get(rec.databaseId)?.name || "" };
  if (type === "database") return { scope: [rec.id, rec.hubId].filter(Boolean), context: rec.hubId || "" };
  if (type === "lineage") return { scope: [rec.id, rec.from, rec.to].filter(Boolean), context: "lineage" };
  return { scope: [rec.id], context: "" };
};
const nameOfRec = (type, rec, m) => {
  if (type !== "lineage") return rec.name || rec.id;
  return `${m.tb.get(rec.from)?.name || rec.from} → ${m.tb.get(rec.to)?.name || rec.to}`;
};
/* audit entries for records that are known to be new (bulk imports) — no full diff needed */
export const entriesForCreated = (next, user, created) => {
  const m = catalogMaps(next);
  const base = { ts: Date.now(), user: auditUserRef(user) };
  const out = [];
  for (const [type, key] of AUDIT_COLL) {
    for (const rec of created[key] || []) {
      const { scope, context } = scopeAndContext(type, rec, m);
      out.push({ id: newId(), ...base, action: "created", entityType: type, entityId: rec.id, name: nameOfRec(type, rec, m), context, scope, after: rec });
    }
  }
  return out;
};
/* audit entries for an explicit delta ({ entityType, action, id, before?, after? }) — no full diff, no clone:
   field changes come from before/after, scope/context from the document after the changes were applied */
export const entriesForChanges = (next, user, changes) => {
  const m = catalogMaps(next);
  const base = { ts: Date.now(), user: auditUserRef(user) };
  const out = [];
  for (const ch of changes) {
    const type = ch.entityType;
    if (ch.action === "deleted") {
      if (!ch.before) continue;
      const { scope, context } = scopeAndContext(type, ch.before, m);
      out.push({ id: newId(), ...base, action: "deleted", entityType: type, entityId: ch.id, name: nameOfRec(type, ch.before, m), context, scope, before: ch.before });
    } else if (ch.action === "created") {
      if (!ch.after) continue;
      const { scope, context } = scopeAndContext(type, ch.after, m);
      out.push({ id: newId(), ...base, action: "created", entityType: type, entityId: ch.id, name: nameOfRec(type, ch.after, m), context, scope, after: ch.after });
    } else {
      if (!ch.after) continue;
      const changesList = recChanges(ch.before || {}, ch.after);
      if (!changesList.length) continue;
      const { scope, context } = scopeAndContext(type, ch.after, m);
      out.push({ id: newId(), ...base, action: "updated", entityType: type, entityId: ch.id, name: nameOfRec(type, ch.after, m), context, scope, changes: changesList, before: ch.before, after: ch.after });
    }
  }
  return out;
};

/* entries of one collection: prev/next record lists, context maps of both documents (databases, schemas, tables) */
export const diffCollection = (type, prevList, nextList, user, mPrev, mNext) => {
  const entries = [];
  const base = { ts: Date.now(), user: auditUserRef(user) };
  const a = new Map((prevList || []).map((x) => [x.id, x]));
  const b = new Map((nextList || []).map((x) => [x.id, x]));
  for (const [id, recB] of b) {
    const recA = a.get(id);
    if (!recA) {
      const { scope, context } = scopeAndContext(type, recB, mNext);
      entries.push({ id: newId(), ...base, action: "created", entityType: type, entityId: id, name: nameOfRec(type, recB, mNext), context, scope, after: recB });
    } else {
      const changes = recChanges(recA, recB);
      if (changes.length) {
        const { scope, context } = scopeAndContext(type, recB, mNext);
        entries.push({ id: newId(), ...base, action: "updated", entityType: type, entityId: id, name: nameOfRec(type, recB, mNext), context, scope, changes, before: recA, after: recB });
      }
    }
  }
  for (const [id, recA] of a) if (!b.has(id)) {
    const { scope, context } = scopeAndContext(type, recA, mPrev);
    entries.push({ id: newId(), ...base, action: "deleted", entityType: type, entityId: id, name: nameOfRec(type, recA, mPrev), context, scope, before: recA });
  }
  return entries;
};
export const diffCatalogs = (prev, next, user) => {
  const mNext = catalogMaps(next), mPrev = catalogMaps(prev);
  return AUDIT_COLL.flatMap(([type, key]) => diffCollection(type, (prev || {})[key] || [], (next || {})[key] || [], user, mPrev, mNext));
};

/* ── change list between two documents (v1.56 MCP lazy writes, moved here in v1.68) ──
   created / updated / deleted records per collection, comparing canonical JSON (key order independent); attributes
   are compared against the records that were loaded on demand ($snapshot) so a lazy document never reports the
   unloaded ones as deleted. Used by the MCP mutate path, UC sync, server-side imports and the start-up migration. */
export const canon = (o) => JSON.stringify(Object.keys(o || {}).sort().reduce((a, k) => (a[k] = o[k], a), {}));
export const changesBetween = (before, after) => {
  const out = [];
  for (const [type, key] of AUDIT_COLL) {
    const prevList = key === "attributes" ? (after.$snapshot || before.attributes || []) : before[key] || [];
    const a = new Map(prevList.map((x) => [x.id, x])), b = new Map((after[key] || []).map((x) => [x.id, x]));
    for (const [id, rec] of b) {
      const old = a.get(id);
      if (!old) out.push({ entityType: type, action: "created", id, after: rec });
      else if (canon(old) !== canon(rec)) out.push({ entityType: type, action: "updated", id, before: old, after: rec });
    }
    for (const [id, old] of a) if (!b.has(id)) out.push({ entityType: type, action: "deleted", id, before: old });
  }
  return out;
};
