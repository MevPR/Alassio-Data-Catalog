/* Data product design workflow — the UI's view of the state machine (v1.68, moved out of marketplace.jsx so the
   dashboards and the status page share ONE vocabulary; three copies had already drifted). The server executes the
   transitions (server/design-workflow.js); this module only knows labels, phases, ordering and which actions a given
   user may see. Every label is an English dictionary key — render it through t(). */
import { rolesOf } from "./roles.js";
import { fill } from "./i18n-format.js";

/* status → [label, chip class] */
export const DESIGN_STATUS = {
  submitted: ["Submitted", "chip-amber"],
  refinement_review: ["With Business Analyst", "chip-blue"], sourcing: ["Sourcing being documented", "chip-blue"], refinement_ok: ["Refinement approved · sourcing documented", "chip-blue"], refinement_rejected: ["Returned by Business Analyst", "chip-amber"],
  owner_review: ["Waiting for BPO approval", "chip-blue"], owner_approved: ["Data use approved by BPO", "chip-blue"], owner_rejected: ["Declined by BPO", "chip-amber"],
  ingestion_review: ["With Data Ingestion", "chip-blue"], ingestion_confirmed: ["Ingested tables confirmed", "chip-blue"], ingestion_ok: ["Ingested tables confirmed", "chip-blue"], ingestion_rejected: ["Returned by Data Ingestion", "chip-amber"],
  refine_review: ["With Business Analyst · refinement", "chip-blue"], refine_ok: ["Refinement completed", "chip-blue"], refine_rejected: ["Returned by Business Analyst · refinement", "chip-amber"],
  development: ["In development", "chip-blue"], uat: ["In UAT", "chip-blue"], sit: ["In SIT", "chip-blue"], release: ["Releasing to PRD", "chip-blue"], signoff: ["Awaiting sign-off", "chip-blue"], development_done: ["Signed off by Development", "chip-blue"], development_rejected: ["Returned by Development", "chip-amber"],
  done: ["Done", "chip-grey"], withdrawn: ["Withdrawn", "chip-grey"], open: ["Open", "chip-amber"], approved: ["Approved", "chip-blue"], rejected: ["Rejected", "chip-grey"],
};
export const STATUS_LABEL = Object.fromEntries(Object.entries(DESIGN_STATUS).map(([k, [label]]) => [k, label]));
export const statusLabel = (status) => STATUS_LABEL[status] || status;

/* which action is offered in which status and to whom (who: submitter | owner | role name); the server checks the same */
export const DESIGN_ACTIONS = {
  edit:                { from: ["submitted", "refinement_review", "refinement_rejected", "sourcing", "owner_rejected", "owner_approved", "ingestion_rejected", "ingestion_confirmed", "ingestion_ok", "refine_rejected", "refine_ok", "development_rejected"], who: ["submitter", "admin", "ba"], label: "Edit" },
  withdraw:            { from: ["submitted", "refinement_review", "refinement_rejected", "sourcing", "owner_review", "owner_rejected", "owner_approved", "ingestion_review", "ingestion_rejected", "ingestion_confirmed", "ingestion_ok", "refine_review", "refine_rejected", "refine_ok", "development", "uat", "sit", "release", "signoff", "development_rejected", "development_done"], who: ["submitter", "admin"], label: "Withdraw", reason: true, danger: true },
  forward_refinement:  { from: ["submitted", "refinement_rejected"], who: ["submitter", "admin"], label: "Forward to Business Analyst", primary: true },
  design_refined:      { from: ["refinement_review"], who: ["ba", "admin"], label: "Design refined", primary: true },
  refinement_ok:       { from: ["sourcing", "refinement_review"], who: ["ba", "admin"], label: "Document the sourcing", primary: true },
  refinement_reject:   { from: ["refinement_review", "sourcing"], who: ["ba", "admin"], label: "Return", reason: true, danger: true },
  forward_owner:       { from: ["refinement_ok", "owner_rejected"], who: ["submitter", "admin"], label: "Request data owner approval", primary: true },
  owner_approve:       { from: ["owner_review"], who: ["owner", "admin"], label: "Approve data use → Data Ingestion", primary: true },
  owner_reject:        { from: ["owner_review"], who: ["owner", "admin"], label: "Decline → back to Business Analyst", reason: true, danger: true },
  forward_ingestion:   { from: ["owner_approved", "ingestion_rejected"], who: ["submitter", "admin"], label: "Forward to Data Ingestion", primary: true },
  ingestion_confirm:   { from: ["ingestion_review"], who: ["ingestion", "admin"], label: "Confirm ingested tables", primary: true },
  ingestion_reject:    { from: ["ingestion_review"], who: ["ingestion", "admin"], label: "Return", reason: true, danger: true },
  forward_refine:      { from: ["ingestion_confirmed", "ingestion_ok", "refine_rejected"], who: ["submitter", "admin"], label: "Forward to Business Analyst · refinement", primary: true },
  refine_ok:           { from: ["refine_review"], who: ["ba", "admin"], label: "Refinement completed → Development", primary: true },
  refine_reject:       { from: ["refine_review"], who: ["ba", "admin"], label: "Return", reason: true, danger: true },
  forward_development: { from: ["refine_ok", "development_rejected"], who: ["submitter", "admin"], label: "Forward to Data Product Development", primary: true },
  dev_done:            { from: ["development"], who: ["dpd", "admin"], label: "Development completed → UAT", primary: true },
  uat_done:            { from: ["uat"], who: ["dpd", "admin"], label: "UAT completed → SIT", primary: true },
  sit_done:            { from: ["sit"], who: ["dpd", "admin"], label: "SIT completed → Release", primary: true },
  release_done:        { from: ["release"], who: ["dpd", "admin"], label: "Released to PRD → Sign-off", primary: true },
  signoff_done:        { from: ["signoff"], who: ["submitter", "admin"], label: "Sign-off", primary: true },
  development_reject:  { from: ["development", "uat", "sit", "release", "signoff"], who: ["dpd", "admin"], label: "Return", reason: true, danger: true },
  mark_done:           { from: ["development_done"], who: ["submitter", "admin"], label: "Mark done", primary: true },
};
/* the three phases of a data product design and the statuses that belong to each */
export const PHASES = [
  { key: "sourcing", title: "1 · Data Sourcing", who: "Business Analyst documents the sourcing · data owner approves the data use · Data Ingestion confirms the ingested tables", statuses: ["submitted", "refinement_review", "sourcing", "refinement_ok", "refinement_rejected", "owner_review", "owner_approved", "owner_rejected", "ingestion_review", "ingestion_confirmed", "ingestion_ok", "ingestion_rejected"], doneAt: ["ingestion_confirmed", "ingestion_ok"] },
  { key: "refinement", title: "2 · Data Product Refinement", who: "Business Analyst / Req. Engineer refines the data product", statuses: ["refine_review", "refine_ok", "refine_rejected"], doneAt: ["refine_ok"] },
  { key: "development", title: "3 · Development & Test / Sign-off", who: "Data Product Development", statuses: ["development", "uat", "sit", "release", "signoff", "development_done", "development_rejected"], doneAt: ["done"] },
];
export const PHASE_OF = (status) => PHASES.findIndex((p) => p.statuses.includes(status)) + 1 || (status === "done" ? 3 : 0);
/* who has to act next, as a dictionary key plus its placeholder values (v1.73 — F-F9: the sentences used to be template
   strings with the names baked in, so they could not be translated). Render with fill(t(key), vars) — or waitingText(). */
const WAITING_KEYS = {
  submitted: "{name} — forward to the Business Analyst", refinement_review: "Business Analyst / Req. Engineer — refine the design", sourcing: "Business Analyst / Req. Engineer — document the sourcing",
  refinement_rejected: "{name} — rework and forward again", refinement_ok: "{name} — request data owner approval", owner_review: "BPO {bpo} — approve or decline", owner_rejected: "{name} — rework",
  owner_approved: "{name} — forward to Data Ingestion", ingestion_review: "Data Ingestion — confirm ingested tables", ingestion_rejected: "{name} — rework and forward again",
  ingestion_confirmed: "{name} — forward to the Business Analyst for refinement", ingestion_ok: "{name} — forward to the Business Analyst for refinement",
  refine_review: "Business Analyst / Req. Engineer — refinement", refine_rejected: "{name} — rework and forward again", refine_ok: "{name} — forward to Development",
  development: "Data Product Development — development", uat: "Data Product Development — user acceptance test (UAT)", sit: "Data Product Development — system integration test (SIT)",
  release: "Data Product Development — release to PRD", signoff: "{name} — sign-off", development_rejected: "{name} — rework and forward again", development_done: "{name} — mark done",
};
export const WAITING_FOR = (r) => {
  if (r.kind === "access") return [r.status === "open" ? "Admin / data owner (approve or reject)" : r.status === "approved" ? "Admin (provision access, mark done)" : "—", {}];
  const key = WAITING_KEYS[r.status];
  return key ? [key, { name: r.requesterName || "", bpo: r.sourcing?.bpo || r.sourcing?.dataOwner || "" }] : ["—", {}];
};
/* the translated sentence; `t` is the i18n lookup */
export const waitingText = (r, t) => { const [key, vars] = WAITING_FOR(r); return fill(t(key), vars); };
/* true when the next step is the requester's own (the sentence starts with their name) */
export const waitsForRequester = (r) => WAITING_FOR(r)[0].startsWith("{name}");
export const PHASE_LABEL = Object.fromEntries(PHASES.map((p, i) => [i + 1, p.title]));
export const ORDER = ["submitted", "refinement_review", "refinement_rejected", "sourcing", "refinement_ok", "owner_review", "owner_rejected", "owner_approved", "ingestion_review", "ingestion_rejected", "ingestion_confirmed", "ingestion_ok", "refine_review", "refine_rejected", "refine_ok", "development", "uat", "sit", "release", "signoff", "development_rejected", "development_done", "done"];
export const phaseState = (r, ph) => {
  if (r.status === "withdrawn") return "withdrawn";
  if (r.status === "done") return "done";
  const pos = ORDER.indexOf(r.status);
  const first = ORDER.indexOf(ph.statuses[0]);
  const lastDone = Math.max(...ph.doneAt.map((x) => ORDER.indexOf(x)));
  if (pos > lastDone) return "done";
  if (pos >= first && pos <= lastDone) return ph.doneAt.includes(r.status) ? "done" : "current";
  return "pending";
};

/* progress of a design as individual process steps */
export const STEP_RANK = { submitted: 1, refinement_review: 1, refinement_rejected: 1, sourcing: 2, refinement_ok: 3, owner_review: 3, owner_rejected: 3, owner_approved: 4, ingestion_review: 4, ingestion_rejected: 4,
  ingestion_confirmed: 5, ingestion_ok: 5, refine_review: 5, refine_rejected: 5, refine_ok: 6, development: 6, development_rejected: 6, uat: 7, sit: 8, release: 9, signoff: 10, development_done: 10, done: 11 };
export const PROCESS_STEPS = [
  ["Design submitted · tags on source tables", 1], ["Refined by Business Analyst", 2], ["Sourcing documented", 3], ["Data use approved", 4], ["Tables ingested", 5],
  ["Refinement completed", 6], ["Development", 7], ["UAT", 8], ["SIT", 9], ["Released to PRD", 10], ["Sign-off", 11],
];
/* generic step dialog: free text (required) plus optional file attachments — used for Design refined, Refinement completed,
   Development / UAT / SIT completed and Released to PRD */
export const STEP_DIALOGS = {
  design_refined: { title: "Design refined", label: "Refinement notes (required) — what was refined and why", ph: "e.g. clarified scope with the BPO, added two claims tables, sharpened the description", button: "Design refined → Document the sourcing" },
  refine_ok:      { title: "Refinement completed", label: "Refinement notes (required) — e.g. where the refinement is documented (Confluence …)", ph: "e.g. Refined data model and mappings documented in Confluence: https://confluence.company.example/…", button: "Refinement completed → Development" },
  dev_done:       { title: "Development completed", label: "Development notes (required) — e.g. repository, deployed version", ph: "e.g. Pipelines in repo company/data-pipelines, deployed to DEV workspace adb-…", button: "Development completed → UAT" },
  uat_done:       { title: "UAT completed", label: "UAT notes (required) — test report, findings, acceptance", ph: "e.g. UAT protocol in Confluence, 3 findings fixed, accepted by business on …", button: "UAT completed → SIT" },
  sit_done:       { title: "SIT completed", label: "SIT notes (required) — integration test report, findings", ph: "e.g. SIT report attached, interfaces to Reporting and FS-CD verified", button: "SIT completed → Release" },
  release_done:   { title: "Released to PRD", label: "Release notes (required) — version, date, what was released", ph: "e.g. Release 1.0 deployed to PRD on …, release notes attached", button: "Released to PRD → Sign-off" },
};

/* actions the signed-in user may take on a request: by submitter, by data owner / BPO (isOwnerOf decides the person
   match), or by role; a Business Analyst may edit only while the design is in a BA stage */
export const availableActions = (r, me, isOwnerOf) => {
  const roles = rolesOf(me);
  return Object.entries(DESIGN_ACTIONS).filter(([k, s]) => s.from.includes(r.status) && s.who.some((w) =>
    (w === "submitter" && r.requestedBy === me?.email) || (w === "owner" && isOwnerOf(r))
    || (w === "ba" && k === "edit" ? roles.includes("ba") && ["refinement_review", "sourcing", "refine_review"].includes(r.status) : (w !== "owner" && w !== "submitter" && roles.includes(w)))));
};

/* ── design form vocabulary (v1.73 — shared by the form hook, the request list and the read-only view) ── */
export const TAG_KEY = "Data Product";   /* the table tag a design proposes; also the key the source-table picker shows */
export const EMPTY_ADV = { refreshFrequency: "", classification: "", auditTrail: "", dataType: "", neededBy: "", retention: "" };
/* [field, label, placeholder] — labels and placeholders are dictionary keys */
export const ADV_FIELDS = [["refreshFrequency", "Refresh frequency", "e.g. daily, weekly, monthly"], ["classification", "Classification", "e.g. C1 – C4"],
  ["auditTrail", "Audit trail / historization", "e.g. full history, SCD2, none"], ["dataType", "Data type", "structured / unstructured"], ["neededBy", "Needed by", "e.g. 2026-12-31 or Q1 2027"],
  ["retention", "Retention", "e.g. 3 months, 10 years, unlimited"]];   /* v1.63: how long the data product keeps its data */
export const RETENTION_SUGGESTIONS = ["1 month", "3 months", "6 months", "1 year", "3 years", "10 years", "unlimited"];
/* notes recorded per step, in workflow order (key on the request, label) */
export const STEP_NOTES = [["refined", "Design refined"], ["refinement", "Refinement completed"], ["development", "Development"], ["uat", "UAT"], ["sit", "SIT"], ["release", "Released to PRD"]];
