/* Stewardship processes (v1.56) — pure helpers shared by the UI, the server reminders and MCP.
   Certification: table.certStatus "" | "endorsed" | "deprecated" (+ certifiedBy/At, certNote, successorId).
   Review cycles: table.reviewCycleDays (0 = none), lastReviewedAt/By → next review = last + cycle.
   Ownership attestation: obj.ownerAttestedAt/By on tables, schemas, databases and domains with an explicit owner;
   due again after policy.attestDays. */
import { effOwnerId, effStewardId, catalogIndex } from "../../permissions.js";

export const DAY = 86400000;
export const REVIEW_CYCLES = [0, 90, 180, 365];
export const CERT_STATUSES = ["", "endorsed", "deprecated"];
export const DEFAULT_POLICY = { attestDays: 180, remindEveryDays: 7, soonDays: 14 };

export const certOf = (t) => t?.certStatus || "";
export const nextReviewAt = (t) => t?.reviewCycleDays && t.lastReviewedAt ? t.lastReviewedAt + Number(t.reviewCycleDays) * DAY : null;
/* none | due (cycle set, never reviewed) | overdue | soon | ok */
export const reviewStatus = (t, now = Date.now(), soonDays = DEFAULT_POLICY.soonDays) => {
  if (!t?.reviewCycleDays) return "none";
  if (!t.lastReviewedAt) return "due";
  const next = nextReviewAt(t);
  return now > next ? "overdue" : now > next - soonDays * DAY ? "soon" : "ok";
};
export const attestationDue = (obj, attestDays = DEFAULT_POLICY.attestDays, now = Date.now()) =>
  !!obj?.ownerId && (!obj.ownerAttestedAt || now - obj.ownerAttestedAt > Number(attestDays) * DAY);

/* the stewardship to-dos of a person set (owner / steward responsibilities incl. inheritance) */
export const stewardshipTasks = (state, mine, policy = DEFAULT_POLICY, now = Date.now()) => {
  const ix = catalogIndex(state);
  const reviews = [], attestations = [];
  const isMine = (id) => id && mine.has(id);
  for (const t of state.tables || []) {
    const st = reviewStatus(t, now, policy.soonDays);
    if (!["due", "overdue", "soon"].includes(st)) continue;
    if (isMine(effStewardId(state, "table", t.id, ix)) || isMine(effOwnerId(state, "table", t.id, ix))) reviews.push({ table: t, status: st, nextReviewAt: nextReviewAt(t) });
  }
  for (const [kind, key] of [["table", "tables"], ["schema", "schemas"], ["database", "databases"], ["domain", "domains"]]) {
    for (const o of state[key] || []) if (isMine(o.ownerId) && attestationDue(o, policy.attestDays, now)) attestations.push({ kind, obj: o, attestedAt: o.ownerAttestedAt || null });
  }
  const order = { overdue: 0, due: 1, soon: 2 };
  reviews.sort((a, b) => (order[a.status] - order[b.status]) || ((a.nextReviewAt || 0) - (b.nextReviewAt || 0)));
  return { reviews, attestations };
};

/* catalogue-wide KPIs for the governance overview */
export const stewardshipKpis = (state, policy = DEFAULT_POLICY, now = Date.now()) => {
  const tables = state.tables || [];
  const withCycle = tables.filter((t) => t.reviewCycleDays);
  const owned = [...(state.tables || []), ...(state.schemas || []), ...(state.databases || []), ...(state.domains || [])].filter((o) => o.ownerId);
  return {
    endorsed: tables.filter((t) => certOf(t) === "endorsed").length,
    deprecated: tables.filter((t) => certOf(t) === "deprecated").length,
    withReviewCycle: withCycle.length,
    reviewsOverdue: withCycle.filter((t) => ["due", "overdue"].includes(reviewStatus(t, now, policy.soonDays))).length,
    owned: owned.length,
    attestationsDue: owned.filter((o) => attestationDue(o, policy.attestDays, now)).length,
  };
};
