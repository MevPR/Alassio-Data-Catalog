/* Marketplace requests: row mapping, the data product design state machine and the tag synchronisation
   between designs and catalog objects. Pure definitions live at the top, DB-touching helpers below. */
import { q } from "./db.js";
import { STATUS_TEXT_L10N } from "./i18n.js";
import { assembleLite, applyChanges } from "./catalog-store.js";
import { changesBetween } from "../catalog-diff.js";

export const reqRow = (r) => ({ id: r.id, kind: r.kind, productRef: r.product_ref, productLabel: r.product_label, name: r.name, hub: r.hub,
  purpose: r.purpose, tagKey: r.tag_key, tagValue: r.tag_value, tableIds: r.table_ids ? JSON.parse(r.table_ids) : [],
  requestedBy: r.requested_by, requesterName: r.requester_name, status: r.status, ts: Number(r.ts), decidedBy: r.decided_by, decidedTs: r.decided_ts ? Number(r.decided_ts) : null,
  reason: r.reason || null, updatedTs: r.updated_ts ? Number(r.updated_ts) : null, history: r.history_json ? JSON.parse(r.history_json) : [],
  advanced: r.advanced_json ? JSON.parse(r.advanced_json) : null, sourcing: r.sourcing_json ? JSON.parse(r.sourcing_json) : null, project: r.project || null, useCase: r.use_case || null,
  approval: r.approval_json ? JSON.parse(r.approval_json) : null, ingestion: r.ingestion_json ? JSON.parse(r.ingestion_json) : null, refinement: r.refine_json ? JSON.parse(r.refine_json) : null, development: r.dev_json ? JSON.parse(r.dev_json) : null,
  refined: r.refined_json ? JSON.parse(r.refined_json) : null, uat: r.uat_json ? JSON.parse(r.uat_json) : null, sit: r.sit_json ? JSON.parse(r.sit_json) : null, release: r.release_json ? JSON.parse(r.release_json) : null });

export const ADVANCED_KEYS = ["refreshFrequency", "classification", "auditTrail", "dataType", "neededBy", "retention"];   /* retention since v1.63 */
export const cleanAdvanced = (a) => a && typeof a === "object" ? Object.fromEntries(ADVANCED_KEYS.map((k) => [k, String(a[k] || "").slice(0, 500)])) : null;
export const SOURCING_KEYS = ["sourceSystem", "bpo", "leanixUrl", "dataSteward"];   /* the BPO approves the data use (v1.47) */
export const CLOSED_STATES = ["done", "withdrawn", "rejected"];

/* Workflow for data product designs (three phases):
   1 Data Sourcing: submitted → refinement_review (automatic) → design_refined → sourcing → refinement_ok (sourcing details) → owner_review
     → owner_approve → ingestion_review (automatic) → ingestion_confirm → refine_review (automatic)
   2 Data Product Refinement: refine_ok (note + files) → development (automatic)
   3 Development & Test / Sign-off: dev_done → uat → uat_done → sit → sit_done → release → release_done → signoff → signoff_done → done.
   Any open state: edit / withdraw (submitter or admin). Manual forward_* actions remain for rejected designs.
   Legacy status ingestion_ok (pre-1.29) behaves like ingestion_confirmed.
   `noteColumn` (v1.73, formerly needsNote): the step requires a note, saved as JSON in that marketplace_requests column —
   the value is interpolated into the UPDATE, so it must only ever come from this table. */
export const DESIGN_ACTIONS = {
  /* phase 1 — Data Sourcing */
  edit:                { from: ["submitted", "refinement_review", "refinement_rejected", "sourcing", "owner_rejected", "owner_approved", "ingestion_rejected", "ingestion_confirmed", "ingestion_ok", "refine_rejected", "refine_ok", "development_rejected"], who: ["submitter", "admin", "ba"], to: null },
  withdraw:            { from: ["submitted", "refinement_review", "refinement_rejected", "sourcing", "owner_review", "owner_rejected", "owner_approved", "ingestion_review", "ingestion_rejected", "ingestion_confirmed", "ingestion_ok", "refine_review", "refine_rejected", "refine_ok", "development", "uat", "sit", "release", "signoff", "development_rejected", "development_done"], who: ["submitter", "admin"], to: "withdrawn", needsReason: true },
  forward_refinement:  { from: ["submitted", "refinement_rejected"], who: ["submitter", "admin"], to: "refinement_review", notifyRole: "ba" },
  design_refined:      { from: ["refinement_review"], who: ["ba", "admin"], to: "sourcing", noteColumn: "refined_json", noteError: "Please describe the refinement of the design" },
  refinement_ok:       { from: ["sourcing", "refinement_review"], who: ["ba", "admin"], to: "owner_review", needsSourcing: true, notifyOwner: true },
  refinement_reject:   { from: ["refinement_review", "sourcing"], who: ["ba", "admin"], to: "refinement_rejected", needsReason: true },
  forward_owner:       { from: ["refinement_ok", "owner_rejected"], who: ["submitter", "admin"], to: "owner_review", requiresSourcing: true, notifyOwner: true },
  owner_approve:       { from: ["owner_review"], who: ["owner", "admin"], to: "ingestion_review", approval: true, notifyRole: "ingestion" },
  owner_reject:        { from: ["owner_review"], who: ["owner", "admin"], to: "refinement_review", needsReason: true, notifyRole: "ba" },
  forward_ingestion:   { from: ["owner_approved", "ingestion_rejected"], who: ["submitter", "admin"], to: "ingestion_review", notifyRole: "ingestion", requiresSourcing: true },
  ingestion_confirm:   { from: ["ingestion_review"], who: ["ingestion", "admin"], to: "refine_review", needsIngestionNote: true, notifyRole: "ba" },
  ingestion_reject:    { from: ["ingestion_review"], who: ["ingestion", "admin"], to: "ingestion_rejected", needsReason: true },
  /* phase 2 — Data Product Refinement by the Business Analyst; completion forwards to Development automatically */
  forward_refine:      { from: ["ingestion_confirmed", "ingestion_ok", "refine_rejected"], who: ["submitter", "admin"], to: "refine_review", notifyRole: "ba" },
  refine_ok:           { from: ["refine_review"], who: ["ba", "admin"], to: "development", notifyRole: "dpd", noteColumn: "refine_json", noteError: "Please describe the refinement (e.g. where it is documented, such as Confluence)" },
  refine_reject:       { from: ["refine_review"], who: ["ba", "admin"], to: "refine_rejected", needsReason: true },
  /* phase 3 — Development & Test / Sign-off: Development → UAT → SIT → Release by Data Product Development, Sign-off by the Project Manager */
  forward_development: { from: ["refine_ok", "development_rejected"], who: ["submitter", "admin"], to: "development", notifyRole: "dpd" },
  dev_done:            { from: ["development"], who: ["dpd", "admin"], to: "uat", noteColumn: "dev_json", noteError: "Please describe the development result (e.g. repository, deployed version, notes)" },
  uat_done:            { from: ["uat"], who: ["dpd", "admin"], to: "sit", noteColumn: "uat_json", noteError: "Please describe the UAT result (test report, findings, acceptance)" },
  sit_done:            { from: ["sit"], who: ["dpd", "admin"], to: "release", noteColumn: "sit_json", noteError: "Please describe the SIT result (integration test report, findings)" },
  release_done:        { from: ["release"], who: ["dpd", "admin"], to: "signoff", notifyRole: "pm", noteColumn: "release_json", noteError: "Please describe the release to PRD (version, date, release notes)" },
  signoff_done:        { from: ["signoff"], who: ["submitter", "admin"], to: "done" },
  development_done:    { from: ["development"], who: ["admin"], to: "development_done" },
  development_reject:  { from: ["development", "uat", "sit", "release", "signoff"], who: ["dpd", "admin"], to: "development_rejected", needsReason: true },
  mark_done:           { from: ["development_done"], who: ["submitter", "admin"], to: "done" },
};
/* the English status texts (v1.70: one source — the l10n table in server/i18n.js; the other languages via statusText(lang, status)) */
export const STATUS_TEXT = STATUS_TEXT_L10N.en;

/* the BPO named in the sourcing details (legacy: dataOwner), resolved to a person record and its e-mail */
export const approverName = (r) => { const src = r.sourcing_json ? JSON.parse(r.sourcing_json) : null; return src ? (src.bpo || src.dataOwner || null) : null; };
const designOwnerPerson = async (r) => {
  const name = approverName(r);
  if (!name) return null;
  const { catalog } = await assembleLite();   /* v1.71: people only — never the attribute rows */
  return (catalog?.people || []).find((x) => x.name.trim().toLowerCase() === String(name).trim().toLowerCase()) || null;
};
export const designOwnerEmail = async (r) => { const p = await designOwnerPerson(r); return p?.email ? p.email.toLowerCase() : null; };
/* v1.66.1 (security review): the BPO is matched by e-mail; a display-name match counts only while the person record
   has no e-mail (an invitee could otherwise register under the BPO's name and approve data use) */
export const isDesignOwner = async (r, user) => {
  const name = approverName(r);
  if (!name) return false;
  const p = await designOwnerPerson(r);
  if (p?.email) return p.email.toLowerCase() === String(user.email || "").toLowerCase();
  return String(name).trim().toLowerCase() === String(user.name || "").trim().toLowerCase();
};

/* multi-value key/value tags */
export const removeTagValue = (rec, key, value) => { if (!rec.kvTags || !value) return false; const n = rec.kvTags.filter((k) => !(k.key === key && k.value === value)); const changed = n.length !== rec.kvTags.length; rec.kvTags = n; return changed; };
export const addTagMulti = (rec, key, value) => { rec.kvTags = rec.kvTags || []; if (value && !rec.kvTags.some((k) => k.key === key && k.value === value)) rec.kvTags.push({ key, value }); };

/* v1.71 (F-S1): tag changes are saved as a delta on the lite document — the attribute rows are never read or
   rewritten for a tag on a handful of tables or schemas */
const saveTagDelta = async (before, after, user) => {
  const changes = changesBetween(before, after);
  if (!changes.length) return;
  await applyChanges(user, changes, { authorize: false });   /* a refusal throws with its status (v1.73, F-S2) */
};

/* keep the "Data Product", "Project" and "Use Case" tags of SOURCE tables in sync with a design's table selection:
   tables added get the tags, tables removed lose them, changed values are swapped; other values stay untouched */
export const syncDesignTags = async (prev, next, user) => {
  const ids = (r) => (r && r.table_ids ? JSON.parse(r.table_ids) : []);
  const pIds = new Set(ids(prev)), nIds = new Set(ids(next));
  const pKey = prev?.tag_key || "Data Product", nKey = next?.tag_key || "Data Product";
  if (!pIds.size && !nIds.size) return;
  const { catalog: before } = await assembleLite();
  if (!before) return;
  const catalog = structuredClone(before);
  let changed = false;
  for (const t of catalog.tables) {
    const wasIn = pIds.has(t.id), isIn = nIds.has(t.id);
    if (wasIn && (!isIn || (prev.tag_value && prev.tag_value !== next?.tag_value) || pKey !== nKey)) { changed = removeTagValue(t, pKey, prev.tag_value) || changed; }
    if (wasIn && (!isIn || (prev.project && prev.project !== next?.project))) { changed = removeTagValue(t, "Project", prev.project) || changed; }
    if (wasIn && (!isIn || (prev.use_case && prev.use_case !== next?.use_case))) { changed = removeTagValue(t, "Use Case", prev.use_case) || changed; }
    if (isIn) {
      if (next.tag_value && !(t.kvTags || []).some((k) => k.key === nKey && k.value === next.tag_value)) { addTagMulti(t, nKey, next.tag_value); changed = true; }
      if (next.project && !(t.kvTags || []).some((k) => k.key === "Project" && k.value === next.project)) { addTagMulti(t, "Project", next.project); changed = true; }
      if (next.use_case && !(t.kvTags || []).some((k) => k.key === "Use Case" && k.value === next.use_case)) { addTagMulti(t, "Use Case", next.use_case); changed = true; }
    }
  }
  if (changed) await saveTagDelta(before, catalog, user);
};

/* "done" tags the finished data product only: the schema named after the design inside a gold-layer database
   of the hub gets Data Product, Project and Use Case (SOURCE tables were tagged at submission by syncDesignTags) */
export const applyDesignTags = async (r, user) => {
  const { catalog: before } = await assembleLite();
  if (!before || !(r.project || r.use_case || r.tag_value)) return;
  const catalog = structuredClone(before);
  const slug = String(r.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 40);
  const hub = catalog.hubs.find((h) => h.name.toLowerCase() === String(r.hub || "").toLowerCase());
  let changed = false;
  for (const sc of catalog.schemas) {
    const d = catalog.databases.find((x) => x.id === sc.databaseId);
    if (d && hub && d.hubId === hub.id && (d.layer || "other") === "gold" && sc.name.toLowerCase().replace(/[^a-z0-9]+/g, "") === slug) {
      if (r.project) addTagMulti(sc, "Project", r.project);
      if (r.use_case) addTagMulti(sc, "Use Case", r.use_case);
      if (r.tag_value) addTagMulti(sc, r.tag_key || "Data Product", r.tag_value);
      changed = true;
    }
  }
  if (changed) await saveTagDelta(before, catalog, user);
};

export const logHistory = async (id, entry) => {
  const rows = await q("SELECT history_json FROM marketplace_requests WHERE id = ?", [id]);
  const h = rows.length && rows[0].history_json ? JSON.parse(rows[0].history_json) : [];
  h.push(entry);
  await q("UPDATE marketplace_requests SET history_json = ? WHERE id = ?", [JSON.stringify(h.slice(-50)), id]);
};
export const loadRequest = async (id) => (await q("SELECT * FROM marketplace_requests WHERE id = ?", [id]))[0] || null;
/* the request row, or a 404 "Request not found" for ah() (v1.72) */
export const requireRequest = async (id) => { const row = await loadRequest(id); if (!row) throw Object.assign(new Error("Request not found"), { status: 404 }); return row; };
