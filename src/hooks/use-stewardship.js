/* Stewardship actions (v1.69 — extracted from App.jsx): the stewardship policy (loaded once per account),
   certification, review cycles, ownership attestation and the "ask the steward for descriptions" request. */
import { useState, useEffect } from "react";
import { effOwnerId, effStewardId } from "../../permissions.js";
import { DEFAULT_POLICY } from "../lib/stewardship.js";
import { apiPost, apiGetOr } from "../lib/api.js";
import * as ops from "../lib/catalog-ops.js";

/* v1.73 (F-F7): inputs grouped — catalog: { state, L }, toast: { flash, prompt } */
/* the "ask for descriptions" prompt, by who receives the request */
const ASK_KEY = {
  steward: "Request business descriptions for the attributes of \"{table}\".\nThe request goes to the data steward ({who}).",
  owner: "Request business descriptions for the attributes of \"{table}\".\nThe request goes to the data owner ({who}) — no steward is defined, the owner will be asked to assign one.",
  admins: "Request business descriptions for the attributes of \"{table}\".\nThe request goes to the admins — neither a steward nor an owner is defined, they will be asked to name a data owner.",
};

export function useStewardship({ me, catalog, patch, toast }) {
  const { state, L } = catalog;
  const { flash, prompt } = toast;
  const { person } = L;
  /* stewardship (v1.56): certification, review cycles, ownership attestation — audited table/object updates */
  const [stewardshipPolicy, setStewardshipPolicy] = useState(DEFAULT_POLICY);
  useEffect(() => { if (me) apiGetOr("/api/stewardship/policy").then((j) => { if (j?.policy) setStewardshipPolicy(j.policy); }); }, [me?.id]);   // eslint-disable-line react-hooks/exhaustive-deps -- once per account
  const certifyTable = (id, status, opts = {}) => {
    patch((s) => ops.certifyTable(s, id, status, { ...opts, user: me }));
    flash(status === "endorsed" ? "Table endorsed" : status === "deprecated" ? "Table marked as deprecated" : "Certification removed");
  };
  const markReviewed = (id, note = "") => { patch((s) => ops.markTableReviewed(s, id, { user: me, note })); flash("Marked as reviewed"); };
  const setReviewCycle = (id, days) => { patch((s) => ops.setReviewCycle(s, id, days)); if (days) flash("Review cycle: every {days} days", { days }); else flash("Review cycle removed"); };
  const attestOwnership = (kind, id) => { patch((s) => ops.attestOwnership(s, kind, id, { user: me })); flash("Ownership confirmed"); };

  const askSteward = async (t) => {
    const sid = effStewardId(state, "table", t.id), oid = effOwnerId(state, "table", t.id);
    const note = await prompt(ASK_KEY[sid ? "steward" : oid ? "owner" : "admins"], { table: t.name, who: person(sid || oid)?.name || "" }, { title: "Ask for descriptions", label: "Optional note", required: false, confirmLabel: "Send" });
    if (note === null) return;
    let j; try { j = await apiPost("/api/messages/request-description", { tableId: t.id, note }); } catch (e) { return flash(e.message || "Could not send the request"); }
    if (j.kind === "steward") flash("Request sent to steward {to}", { to: j.to }); else if (j.kind === "owner") flash("No steward — owner {to} was asked to assign one", { to: j.to }); else flash("No steward or owner — the admins were asked to name a data owner");
  };
  /* setStewardshipPolicy (v1.73, F-F13): the policy card applies a saved policy everywhere without a reload */
  return { stewardshipPolicy, setStewardshipPolicy, certifyTable, markReviewed, setReviewCycle, attestOwnership, askSteward };
}
