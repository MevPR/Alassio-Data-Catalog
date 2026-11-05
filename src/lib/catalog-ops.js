/* Catalog mutations as pure functions on a catalog document.
   Every function receives a (cloned) document `s`, mutates it in place and returns a small result;
   the App wraps them in `patch()` which clones the React state first. No React, no fetch — unit-testable. */
import { uid, normCountry, LAYERS, guessLayer, isSourceHub, isSourceHubName } from "./model.js";

export const PROJECT_KEY = "Project";
export const CLASSES = ["C1", "C2", "C3", "C4"];
const norm = (x) => String(x || "").toLowerCase();

/* ── people / domains (find or create by name) ── */
export const findOrCreatePerson = (s, name) => {
  if (!name) return null;
  let p = s.people.find((x) => norm(x.name) === norm(name));
  if (!p) { p = { id: uid(), name: String(name), email: "" }; s.people.push(p); }
  return p.id;
};
export const findOrCreateDomain = (s, name, extra = {}) => {
  const n = String(name || "").trim(); if (!n) return null;
  let dm = s.domains.find((x) => norm(x.name) === norm(n));
  if (!dm) { dm = { id: uid(), name: n, description: "", ownerId: null, stewardId: null, ...extra }; s.domains.push(dm); }
  return dm.id;
};
export const hubByName = (s, name) => {
  const raw = String(name || "").trim();
  const n = raw.toLowerCase();
  if (!n) return s.hubs.find((h) => h.id === "central")?.id || s.hubs[0]?.id;
  let h = s.hubs.find((x) => x.name.toLowerCase() === n);
  if (!h) { h = { id: uid(), name: raw, description: "", ownerId: null, stewardId: null }; s.hubs.push(h); }
  return h.id;
};
export const ensureSourceHub = (s) => {
  let hubS = s.hubs.find((h) => isSourceHubName(h.name));
  if (!hubS) { hubS = { id: "source", name: "SOURCE", description: "Source systems loaded from generic data sources.", ownerId: null, stewardId: null }; s.hubs.push(hubS); }
  return hubS;
};

/* ── delete with cascade ── */
export function removeEntity(s, type, id) {
  s.lineage = s.lineage || [];
  if (type === "database") {
    const scIds = s.schemas.filter((x) => x.databaseId === id).map((x) => x.id);
    const tbIds = s.tables.filter((x) => scIds.includes(x.schemaId)).map((x) => x.id);
    s.databases = s.databases.filter((x) => x.id !== id);
    s.schemas = s.schemas.filter((x) => x.databaseId !== id);
    s.tables = s.tables.filter((x) => !scIds.includes(x.schemaId));
    s.attributes = s.attributes.filter((x) => !tbIds.includes(x.tableId));
    s.lineage = s.lineage.filter((e) => !tbIds.includes(e.from) && !tbIds.includes(e.to));
  } else if (type === "schema") {
    const tbIds = s.tables.filter((x) => x.schemaId === id).map((x) => x.id);
    s.schemas = s.schemas.filter((x) => x.id !== id);
    s.tables = s.tables.filter((x) => x.schemaId !== id);
    s.attributes = s.attributes.filter((x) => !tbIds.includes(x.tableId));
    s.lineage = s.lineage.filter((e) => !tbIds.includes(e.from) && !tbIds.includes(e.to));
  } else if (type === "table") {
    s.tables = s.tables.filter((x) => x.id !== id);
    s.attributes = s.attributes.filter((x) => x.tableId !== id);
    s.lineage = s.lineage.filter((e) => e.from !== id && e.to !== id);
  } else if (type === "edge") {
    s.lineage = s.lineage.filter((e) => e.id !== id);
  } else if (type === "attribute") {
    s.attributes = s.attributes.filter((x) => x.id !== id);
  } else if (type === "hub") {
    s.hubs = s.hubs.filter((x) => x.id !== id);
  } else if (type === "domain") {
    s.domains = s.domains.filter((x) => x.id !== id);
    s.databases.forEach((d) => { if (d.domainId === id) d.domainId = null; });
  } else if (type === "person") {
    s.people = s.people.filter((x) => x.id !== id);
    s.hubs.forEach((h) => { if (h.ownerId === id) h.ownerId = null; if (h.stewardId === id) h.stewardId = null; (h.dataHubs || []).forEach((x) => { if (x.bpoId === id) x.bpoId = null; }); });
    s.domains.forEach((d) => { if (d.ownerId === id) d.ownerId = null; if (d.stewardId === id) d.stewardId = null; });
    s.tables.forEach((t) => { if (t.stewardId === id) t.stewardId = null; });
  }
  return s;
}

/* ── restore a record from an audit entry; returns false when the parent no longer exists ── */
const TYPE_TO_KEY = { hub: "hubs", database: "databases", schema: "schemas", table: "tables", attribute: "attributes", domain: "domains", person: "people", lineage: "lineage" };
export function restoreParentOk(s, entry) {
  const snap = entry.action === "deleted" ? entry.before : (entry.after || entry.before);
  if (!snap || !TYPE_TO_KEY[entry.entityType]) return false;
  return entry.entityType === "attribute" ? s.tables.some((t) => t.id === snap.tableId) :
    entry.entityType === "table" ? s.schemas.some((x) => x.id === snap.schemaId) :
    entry.entityType === "schema" ? s.databases.some((x) => x.id === snap.databaseId) :
    entry.entityType === "lineage" ? s.tables.some((t) => t.id === snap.from) && s.tables.some((t) => t.id === snap.to) :
    true;
}
export function restoreRecord(s, entry) {
  const snap = entry.action === "deleted" ? entry.before : (entry.after || entry.before);
  const key = TYPE_TO_KEY[entry.entityType];
  if (!snap || !key) return s;
  const list = s[key] || (s[key] = []);
  const i = list.findIndex((x) => x.id === snap.id);
  if (i >= 0) list[i] = snap; else list.push(snap);
  return s;
}

/* ── shared: merge a schemas/tables/columns payload into a database ── */
function mergeSchemasPayload(s, d, schemasPayload, { tags, fullMap = null, catalogName = "", fill = false } = {}) {
  /* fill: an import that enriches existing objects (dbt, data contracts) fills empty descriptions / business terms
     instead of only adding missing objects */
  const fillText = (obj, key, val) => { if (fill && val && !obj[key]) obj[key] = val; };
  for (const scP of schemasPayload) {
    let sc = s.schemas.find((x) => x.databaseId === d.id && x.name === scP.name);
    if (!sc) { sc = { id: uid(), databaseId: d.id, name: scP.name, description: scP.comment || "" }; s.schemas.push(sc); }
    else fillText(sc, "description", scP.comment);
    for (const tbP of scP.tables || []) {
      let tb = s.tables.find((x) => x.schemaId === sc.id && x.name === tbP.name);
      if (!tb) {
        tb = { id: uid(), schemaId: sc.id, name: tbP.name, type: tbP.type || "TABLE", description: tbP.comment || "", businessDefinition: tbP.businessDefinition || "", stewardId: null, tags };
        s.tables.push(tb);
      } else { fillText(tb, "description", tbP.comment); fillText(tb, "businessDefinition", tbP.businessDefinition); }
      if (fullMap) fullMap[`${catalogName}.${scP.name}.${tbP.name}`] = tb.id;
      for (const c of tbP.columns || []) {
        const at = s.attributes.find((x) => x.tableId === tb.id && x.name === c.name);
        if (!at) {
          s.attributes.push({ id: uid(), tableId: tb.id, name: c.name, dataType: c.type_text || c.type_name || "STRING", nullable: c.nullable !== false, isPK: !!c.isPK, description: c.comment || "", businessTerm: c.businessTerm || "", sensitivity: c.sensitivity || "Internal", /* i18n: data */ ...(c.classification ? { classification: c.classification } : {}) });
        } else if (fill) {
          fillText(at, "description", c.comment); fillText(at, "businessTerm", c.businessTerm);
          if (c.sensitivity && at.sensitivity === "Internal") at.sensitivity = c.sensitivity;
          if (c.classification && !at.classification) at.classification = c.classification;
          if (c.isPK) at.isPK = true;
        }
      }
    }
  }
}

/* table id for a dotted path database.schema.table anywhere in the catalog (first match) */
const tableByPath = (s, key) => {
  const parts = String(key || "").split(".");
  if (parts.length < 3) return null;
  const tbN = parts.pop(), scN = parts.pop(), dbN = parts.join(".");
  for (const d of s.databases.filter((x) => x.name === dbN)) {
    const sc = s.schemas.find((x) => x.databaseId === d.id && x.name === scN);
    const tb = sc && s.tables.find((x) => x.schemaId === sc.id && x.name === tbN);
    if (tb) return tb.id;
  }
  return null;
};

/* ── bundle import (several databases + lineage in one go: Power BI workspaces, dbt projects, data contracts) ──
   databases: [{ name, comment, schemas: [...] }], lineage: [[from, to]] with "database.schema.table" keys; keys that
   are not part of the bundle are resolved against the existing catalog (e.g. dbt sources imported from Unity Catalog).
   hubId "source" → the SOURCE hub (layer other); any other hub keeps `layer` or guesses it per database. */
export function importBundle(s, { hubId = "source", country = "GLOBAL", layer = "", sourceType, databases = [], lineage = [], sourceRef = null }) {
  if (!s.lineage) s.lineage = [];
  const hub = hubId && hubId !== "source" ? (s.hubs.find((h) => h.id === hubId) || ensureSourceHub(s)) : ensureSourceHub(s);
  const isSource = isSourceHub(hub);
  const fullMap = {};
  const out = [];
  for (const dbP of databases) {
    let d = s.databases.find((x) => x.hubId === hub.id && x.name === dbP.name);
    if (!d) {
      d = { id: uid(), name: dbP.name, description: dbP.comment || `Loaded from ${sourceType}.`, hubId: hub.id, country: normCountry(country),
        layer: isSource ? "other" : LAYERS.includes(layer) ? layer : guessLayer(dbP.name, "", dbP.layerHint || ""), domainId: null, source: "external", sourceType };
      s.databases.push(d);
    } else if (dbP.comment && !d.description) d.description = dbP.comment;
    if (sourceRef) d.sourceRef = { ...sourceRef, lastUsed: Date.now() };
    mergeSchemasPayload(s, d, dbP.schemas || [], { tags: String(sourceType || "import").toLowerCase().replace(/[^a-z0-9]+/g, "-"), fullMap, catalogName: dbP.name, fill: true });
    out.push(d);
  }
  let edges = 0;
  for (const [fromF, toF] of lineage) {
    const from = fullMap[fromF] || tableByPath(s, fromF), to = fullMap[toF] || tableByPath(s, toF);
    if (addEdge(s, from, to)) edges++;
  }
  return { databases: out, edges };
}

/* ── Unity Catalog import ── */
export function importUnity(s, { catalogName, schemasPayload, workspace, hubId, lineagePairs = [], country = "GLOBAL", layer = "", sourceRef = null }) {
  if (!s.lineage) s.lineage = [];
  const fullMap = {};
  let d = s.databases.find((x) => x.name === catalogName && x.source === "unity");
  if (!d) {
    d = { id: uid(), name: catalogName, description: `Imported from Unity Catalog${workspace ? ` (${workspace})` : ""}.`, hubId: hubId || "central", country: normCountry(country), layer: LAYERS.includes(layer) ? layer : guessLayer(catalogName), domainId: null, source: "unity" };
    s.databases.push(d);
  }
  if (sourceRef) d.sourceRef = { ...sourceRef, kind: "unity", catalog: catalogName, lastUsed: Date.now() };
  mergeSchemasPayload(s, d, schemasPayload, { tags: "unity-catalog", fullMap, catalogName });
  for (const [fromF, toF] of lineagePairs) {
    const from = fullMap[fromF], to = fullMap[toF];
    if (from && to && from !== to && !s.lineage.some((e) => e.from === from && e.to === to)) s.lineage.push({ id: uid(), from, to });
  }
  return d;
}

/* Governance tags read from Unity Catalog: catalog tags Data Domain / Data Owner / Data Steward → data domain
   with owner/steward, table tags Data Steward → table steward, column tags Sensitivity / classification → attribute. */
export function applyUnityTags(s, catalogName, tagData) {
  const d = s.databases.find((x) => x.name === catalogName && x.source === "unity");
  if (!d || !tagData) return s;
  const ct = tagData.catalogTags || {};
  const domName = ct["Data Domain"] || (ct["Data Owner"] || ct["Data Steward"] ? catalogName : null);
  if (domName) {
    let dm = s.domains.find((x) => norm(x.name) === norm(domName));
    if (!dm) { dm = { id: uid(), name: domName, ownerId: null, stewardId: null }; s.domains.push(dm); }
    if (ct["Data Owner"]) dm.ownerId = findOrCreatePerson(s, ct["Data Owner"]);
    if (ct["Data Steward"]) dm.stewardId = findOrCreatePerson(s, ct["Data Steward"]);
    d.domainId = dm.id;
  }
  const scByName = Object.fromEntries(s.schemas.filter((x) => x.databaseId === d.id).map((x) => [x.name, x]));
  const tableByKey = (key) => { const [scN, tbN] = key.split("."); const sc = scByName[scN]; return sc ? s.tables.find((x) => x.schemaId === sc.id && x.name === tbN) : null; };
  const attrByKey = (key) => { const [scN, tbN, colN] = key.split("."); const tb = tableByKey(`${scN}.${tbN}`); return tb ? s.attributes.find((x) => x.tableId === tb.id && x.name === colN) : null; };
  for (const [key, val] of Object.entries(tagData.tableTags || {})) { if (!val) continue; const tb = tableByKey(key); if (tb) tb.stewardId = findOrCreatePerson(s, val); }
  for (const [key, val] of Object.entries(tagData.columnTags || {})) { if (!val) continue; const at = attrByKey(key); if (at) at.sensitivity = val; }
  for (const [key, val] of Object.entries(tagData.columnClass || {})) { if (!val) continue; const at = attrByKey(key); if (at && CLASSES.includes(String(val).toUpperCase())) at.classification = String(val).toUpperCase(); }
  return s;
}

/* ── generic source loader → SOURCE hub ── */
export function importExternal(s, { dbName, sourceType, schemasPayload, country = "GLOBAL", sourceRef = null }) {
  const hubS = ensureSourceHub(s);
  let d = s.databases.find((x) => x.hubId === hubS.id && x.name === dbName);
  if (!d) {
    d = { id: uid(), name: dbName, description: `Loaded from ${sourceType}.`, hubId: hubS.id, country: normCountry(country), layer: "other", domainId: null, source: "external", sourceType };
    s.databases.push(d);
  }
  if (sourceRef) d.sourceRef = { ...sourceRef, lastUsed: Date.now() };
  mergeSchemasPayload(s, d, schemasPayload, { tags: sourceType.toLowerCase().replace(/[^a-z0-9]+/g, "-") });
  return d;
}

/* ── lineage ── */
export function addEdge(s, from, to) {
  if (!s.lineage) s.lineage = [];
  if (from && to && from !== to && !s.lineage.some((e) => e.from === from && e.to === to)) { s.lineage.push({ id: uid(), from, to }); return true; }
  return false;
}
export function addEdgeMapping(s, edgeId, fromAttrId, toAttrId) {
  const e = (s.lineage || []).find((x) => x.id === edgeId); if (!e) return s;
  e.mappings = e.mappings || [];
  if (!e.mappings.some((m) => m.from === fromAttrId && m.to === toAttrId)) e.mappings.push({ id: uid(), from: fromAttrId, to: toAttrId });
  return s;
}
export function removeEdgeMapping(s, edgeId, mapId) {
  const e = (s.lineage || []).find((x) => x.id === edgeId); if (!e) return s;
  e.mappings = (e.mappings || []).filter((m) => m.id !== mapId);
  return s;
}

/* ── key/value tags (Project, Use Case, Data Product …) ── */
const kvRecord = (s, kind, id) => (kind === "table" ? s.tables : s.schemas).find((x) => x.id === id);
export function addProjectTag(s, kind, id, value) {
  const v = String(value || "").trim(); if (!v) return s;
  const rec = kvRecord(s, kind, id);
  if (rec) { rec.kvTags = rec.kvTags || []; if (!rec.kvTags.some((k) => k.key === PROJECT_KEY && k.value === v)) rec.kvTags.push({ key: PROJECT_KEY, value: v }); }
  return s;
}
export function removeProjectTag(s, kind, id, value) {
  const rec = kvRecord(s, kind, id);
  if (rec) rec.kvTags = (rec.kvTags || []).filter((k) => !(k.key === PROJECT_KEY && k.value === value));
  return s;
}
/* sets one single-valued tag on the given tables (replacing an existing value of the same key) */
export function setKvTag(s, tableIds, key, value) {
  for (const t of s.tables) if (tableIds.includes(t.id)) t.kvTags = [...(t.kvTags || []).filter((k) => k.key !== key), { key, value }];
  return s;
}
export const kvValuesOf = (state, key) => [...new Set([...(state.tables || []), ...(state.schemas || [])].flatMap((x) => (x.kvTags || []).filter((k) => k.key === key).map((k) => k.value)))].sort();

/* ── data hubs (free-text level below the data hub type) ── */
export function saveDataHub(s, hubTypeId, { name, description, bpoId, domainId, leanixUrl }, editName) {
  const ht = s.hubs.find((x) => x.id === hubTypeId); if (!ht) return s;
  ht.dataHubs = ht.dataHubs || [];
  const cur = editName ? ht.dataHubs.find((x) => x.name === editName) : null;
  if (cur) { cur.name = name; cur.description = description || ""; cur.bpoId = bpoId; cur.domainId = domainId || null; cur.leanixUrl = leanixUrl || null; }
  else ht.dataHubs.push({ name, description: description || "", bpoId, domainId: domainId || null, leanixUrl: leanixUrl || null });
  if (editName && editName !== name) for (const d of s.databases) if (d.hubId === hubTypeId && (d.country || "GLOBAL") === editName) d.country = name;
  return s;
}
export function deleteDataHub(s, hubTypeId, name) {
  const ht = s.hubs.find((x) => x.id === hubTypeId); if (ht) ht.dataHubs = (ht.dataHubs || []).filter((x) => x.name !== name);
  return s;
}
export function setDataHubBpo(s, hubTypeId, name, personId) {
  const ht = s.hubs.find((x) => x.id === hubTypeId); if (!ht) return s;
  ht.dataHubs = ht.dataHubs || [];
  let dh = ht.dataHubs.find((x) => x.name === name); if (!dh) { dh = { name, description: "" }; ht.dataHubs.push(dh); }
  dh.bpoId = personId || null;
  return s;
}
export function assignPerson(s, kind, id, field, personId) {
  const list = { hub: s.hubs, domain: s.domains }[kind];
  const rec = list?.find((x) => x.id === id); if (rec) rec[field] = personId || null;
  return s;
}

/* ── entity create / edit (hub, database, schema, table, attribute, domain, person) ──
   Returns the name of a glossary term that was created on the fly (or null). */
export function saveEntity(s, { kind, edit, parentId }, f, newId = uid()) {
  const isSourceHubId = (hubId) => isSourceHubName(s.hubs.find((h) => h.id === hubId)?.name);
  const list = { hub: s.hubs, database: s.databases, schema: s.schemas, table: s.tables, attribute: s.attributes, domain: s.domains, person: s.people }[kind];
  let createdTerm = null;
  if (edit) {
    const i = list.findIndex((x) => x.id === edit.id);
    list[i] = { ...list[i], ...f, ...(kind === "hub" ? { id: list[i].id } : {}) };
    if (kind === "database") { list[i].country = normCountry(list[i].country); if (isSourceHubId(list[i].hubId)) list[i].layer = "other"; }
    if (["table", "database", "schema", "domain"].includes(kind)) { list[i].ownerId = f.ownerId || null; list[i].stewardId = f.stewardId || null; }
    if (["table", "database", "schema", "hub"].includes(kind)) list[i].domainId = f.domainId || null;
    if (kind === "hub") { list[i].ownerId = f.ownerId || null; list[i].stewardId = null; }
  } else {
    const base = { id: newId, name: f.name.trim() };
    if (kind === "hub") list.push({ ...base, description: f.description, ownerId: f.ownerId || null, stewardId: null, domainId: f.domainId || null });
    if (kind === "database") list.push({ ...base, description: f.description, hubId: f.hubId || s.hubs[0]?.id || "central", country: normCountry(f.country), layer: isSourceHubId(f.hubId || s.hubs[0]?.id) ? "other" : (f.layer || guessLayer(f.name)), domainId: f.domainId || null, ownerId: f.ownerId || null, stewardId: f.stewardId || null, source: "manual" });
    if (kind === "schema") list.push({ ...base, databaseId: parentId, description: f.description, ownerId: f.ownerId || null, stewardId: f.stewardId || null, domainId: f.domainId || null });
    if (kind === "table") list.push({ ...base, schemaId: parentId, type: f.type, description: f.description, businessDefinition: f.businessDefinition || "", businessTerm: f.businessTerm || "", ownerId: f.ownerId || null, stewardId: f.stewardId || null, domainId: f.domainId || null, tags: f.tags });
    if (kind === "attribute") list.push({ ...base, tableId: parentId, dataType: f.dataType, nullable: !!f.nullable, isPK: !!f.isPK, description: f.description, businessTerm: f.businessTerm, sensitivity: f.sensitivity, classification: f.classification || "" });
    if (kind === "domain") list.push({ ...base, description: f.description, ownerId: f.ownerId || null, stewardId: f.stewardId || null });
    if (kind === "person") list.push({ ...base, email: f.email });
  }
  /* glossary term typed on a table or attribute: create it if unknown, and link it to the object */
  if ((kind === "table" || kind === "attribute") && String(f.businessTerm || "").trim()) {
    const name = f.businessTerm.trim(); const objId = edit ? edit.id : newId;
    s.glossary = s.glossary || [];
    let g = s.glossary.find((x) => norm(x.name) === norm(name));
    if (!g) { g = { id: uid(), name, definition: "", refs: [], urls: [] }; s.glossary.push(g); createdTerm = name; }
    g.refs = g.refs || [];
    if (!g.refs.some((r) => r.type === kind && r.id === objId)) g.refs.push({ type: kind, id: objId });
  }
  return createdTerm;
}

/* ── glossary ── */
export function saveGlossaryTerm(s, f, editId, { termId, canSetOwner, createdBy }) {
  s.glossary = s.glossary || [];
  const prev = editId ? s.glossary.find((g) => g.id === editId) : null;
  const rec = {
    name: String(f.name || "").trim(), definition: f.definition || "",
    refs: (f.refs || []).map((r) => ({ type: r.type, id: r.id })), urls: (f.urls || []).map((u) => ({ name: u.name, url: u.url })),
    domainId: f.domainId || null, ownerId: canSetOwner ? (f.ownerId || null) : (prev?.ownerId || null),
    stewardId: f.stewardId || null, ...(editId ? {} : { createdBy: createdBy || null }),
  };
  if (editId) { const i = s.glossary.findIndex((g) => g.id === editId); if (i >= 0) s.glossary[i] = { ...s.glossary[i], ...rec }; }
  else s.glossary.push({ id: termId, ...rec });
  return s;
}
export function deleteGlossaryTerm(s, id) { s.glossary = (s.glossary || []).filter((x) => x.id !== id); return s; }

export const recordSource = (s, dbId, ref) => { const d = s.databases.find((x) => x.id === dbId); if (d) d.sourceRef = { ...ref, lastUsed: Date.now() }; return s; };

/* ── stewardship (v1.56): certification, review cycles, ownership attestation ── */
const byRef = (u) => u?.name || u?.email || "unknown";
export function certifyTable(s, tableId, status, { note = "", successorId = null, user = null, now = Date.now() } = {}) {
  const t = s.tables.find((x) => x.id === tableId); if (!t) return s;
  if (!["", "endorsed", "deprecated"].includes(status)) throw new Error("status must be endorsed, deprecated or empty");
  if (status === "deprecated" && successorId && successorId === tableId) throw new Error("a table cannot be its own successor");
  if (!status) { delete t.certStatus; delete t.certifiedBy; delete t.certifiedAt; delete t.certNote; delete t.successorId; return s; }
  t.certStatus = status; t.certifiedBy = byRef(user); t.certifiedAt = now; t.certNote = String(note || "").slice(0, 2000);
  if (status === "deprecated") { if (successorId) t.successorId = successorId; else delete t.successorId; } else delete t.successorId;
  if (status === "endorsed") { t.lastReviewedAt = now; t.lastReviewedBy = byRef(user); }   /* endorsing is a review */
  return s;
}
export function markTableReviewed(s, tableId, { user = null, now = Date.now(), note = "" } = {}) {
  const t = s.tables.find((x) => x.id === tableId); if (!t) return s;
  t.lastReviewedAt = now; t.lastReviewedBy = byRef(user);
  if (note) t.lastReviewNote = String(note).slice(0, 2000); else delete t.lastReviewNote;
  return s;
}
export function setReviewCycle(s, tableId, days) {
  const t = s.tables.find((x) => x.id === tableId); if (!t) return s;
  const d = Math.max(0, Math.min(3650, Number(days) || 0));
  if (d) t.reviewCycleDays = d; else delete t.reviewCycleDays;
  return s;
}
const KIND_KEY = { table: "tables", schema: "schemas", database: "databases", domain: "domains" };
export function attestOwnership(s, kind, id, { user = null, now = Date.now() } = {}) {
  const o = (s[KIND_KEY[kind]] || []).find((x) => x.id === id); if (!o || !o.ownerId) return s;
  o.ownerAttestedAt = now; o.ownerAttestedBy = byRef(user);
  return s;
}
