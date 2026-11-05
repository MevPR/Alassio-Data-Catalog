/* MCP tools: certification, reviews and the stewardship task list. */
import { findTable, withTable, tablePath, tablePathById, iso } from "../lookups.js";
import { S, str, boolT, int, enumT } from "../schema.js";
import { reviewStatus, nextReviewAt } from "../../src/lib/stewardship.js";
import { certifyTable, markTableReviewed, setReviewCycle } from "../../src/lib/catalog-ops.js";

/* v1.71 (F-M1): certification and review rules live in catalog-ops (what the UI does, audited the same way); the tools
   only resolve paths and word the answer. catalog-ops records the actor as name ‖ email. */
const actor = (u) => ({ name: u?.name, email: u?.email });

export default ({ readCatalog, mutate, currentUser }) => [
  /* ── stewardship (v1.56) ── */
  { name: "certify_table", mutating: true, description: "Set a table's certification: 'endorsed' (trusted, reviewed), 'deprecated' (optionally with a successor table) or 'none'. Endorsing counts as a review.",
    inputSchema: S({ table: str("Table path 'database.schema.table'"), status: enumT(["endorsed", "deprecated", "none"], "endorsed | deprecated | none"), note: str("Reason / note (optional)"), successor: str("Successor table path for deprecations (optional)") }, ["table", "status"]),
    run: async (a) => mutate(withTable(a.table, (c, { tb }) => {
      const status = a.status === "none" ? "" : a.status;   /* the schema enum rejects anything else (v1.71) */
      const successorId = a.successor ? findTable(c, a.successor).tb.id : null;
      if (!status) { certifyTable(c, tb.id, ""); return `Certification removed from ${a.table}.`; }
      certifyTable(c, tb.id, status, { note: a.note, successorId, user: actor(currentUser()) });
      return `Table ${a.table} ${status}${tb.successorId ? ` (successor ${a.successor})` : ""}.`; })) },
  { name: "review_table", mutating: true, description: "Mark a table as reviewed today and/or set its review cycle (0 = no cycle, e.g. 90/180/365 days). Due and overdue reviews appear on the responsible people's dashboard.",
    inputSchema: S({ table: str("Table path 'database.schema.table'"), reviewed: boolT("Mark as reviewed now (default true)"), cycle_days: int("Review cycle in whole days (optional; 0 removes it, max 3650)", { min: 0, max: 3650 }), note: str("Review note (optional)") }, ["table"]),
    run: async (a) => mutate(withTable(a.table, (c, { tb }) => {
      if (a.cycle_days !== undefined) setReviewCycle(c, tb.id, a.cycle_days);
      if (a.reviewed !== false) markTableReviewed(c, tb.id, { user: actor(currentUser()), note: a.note || "" });
      return `Table ${a.table}: ${a.reviewed !== false ? "reviewed" : "unchanged"}${a.cycle_days !== undefined ? `, review cycle ${tb.reviewCycleDays || 0} days` : ""} (status ${reviewStatus(tb)}).`; })) },
  { name: "list_stewardship_tasks", description: "Tables whose review is due or overdue, deprecated tables (with successors) and objects whose ownership attestation is older than the policy allows.",
    inputSchema: S({ attest_days: int("Attestation interval in days (default 180, max 3650)", { min: 1, max: 3650 }) }),
    run: async (a) => { const { catalog: c } = await readCatalog(); const days = a.attest_days || 180, now = Date.now();
      return {
        reviews_due: c.tables.filter((t) => ["due", "overdue"].includes(reviewStatus(t))).map((t) => ({ table: tablePath(c, t), status: reviewStatus(t), next_review_at: iso(nextReviewAt(t)), last_reviewed_by: t.lastReviewedBy || null })),
        deprecated: c.tables.filter((t) => t.certStatus === "deprecated").map((t) => ({ table: tablePath(c, t), successor: t.successorId ? tablePathById(c, t.successorId) : null, note: t.certNote || "" })),
        attestations_due: [["table", c.tables], ["schema", c.schemas], ["database", c.databases], ["domain", c.domains]].flatMap(([kind, list]) => list.filter((o) => o.ownerId && (!o.ownerAttestedAt || now - o.ownerAttestedAt > days * 86400000))
          .map((o) => ({ kind, name: kind === "table" ? tablePath(c, o) : o.name, owner: c.people.find((p) => p.id === o.ownerId)?.name || null, last_attested_at: iso(o.ownerAttestedAt) }))),
      }; } },
];
