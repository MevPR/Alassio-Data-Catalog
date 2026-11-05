import { useState, useEffect } from "react";
import { BadgeCheck, Ban, ClipboardCheck, CalendarClock, ShieldCheck, ArrowRight, X } from "lucide-react";
import { useT } from "../i18n.jsx";
import { useToast } from "../toast-context.jsx";
import { fmtDate } from "../lib/format.js";
import { useActions, useCatalogData, useNav } from "../catalog-context.jsx";
import { Modal, Field } from "./ui.jsx";
import { apiPut, apiPost } from "../lib/api.js";
import { certOf, reviewStatus, nextReviewAt, attestationDue, stewardshipKpis, REVIEW_CYCLES, DEFAULT_POLICY } from "../lib/stewardship.js";

export const REVIEW_LABEL = { none: "No review cycle", due: "Review pending", overdue: "Review overdue", soon: "Review due soon", ok: "Reviewed" };
const REVIEW_CHIP = { due: "chip-amber", overdue: "chip-red", soon: "chip-amber", ok: "chip-green", none: "chip-grey" };

/* certification badge (table header, cards, search results) */
export function CertChip({ t, size = 12 }) {
  const { t: tr } = useT();
  const c = certOf(t);
  if (c === "endorsed") return <span className="chip chip-green" title={`${tr("Endorsed")} ${fmtDate(t.certifiedAt)} · ${t.certifiedBy || ""}${t.certNote ? ` — ${t.certNote}` : ""}`}><BadgeCheck size={size} /> {tr("Endorsed")}</span>;
  if (c === "deprecated") return <span className="chip chip-red" title={`${tr("Deprecated")} ${fmtDate(t.certifiedAt)} · ${t.certifiedBy || ""}${t.certNote ? ` — ${t.certNote}` : ""}`}><Ban size={size} /> {tr("Deprecated")}</span>;
  return null;
}
export function ReviewChip({ t, policy = DEFAULT_POLICY, size = 12 }) {
  const { t: tr } = useT();
  const st = reviewStatus(t, Date.now(), policy.soonDays);
  if (st === "none") return null;
  return <span className={`chip ${REVIEW_CHIP[st]}`} title={`${tr("Next review")}: ${fmtDate(nextReviewAt(t))}`}><CalendarClock size={size} /> {tr(REVIEW_LABEL[st])}</span>;
}

/* the stewardship block on a table's Governance tab */
export function StewardshipPanel({ t }) {
  const { t: tr } = useT();
  const { perm, table, tables, stewardshipPolicy: policy, me } = useCatalogData();
  const { setSel, setModal } = useNav();
  const { certifyTable, markReviewed, setReviewCycle, attestOwnership } = useActions();
  const may = perm.canEditTable(t.id);
  const owner = perm.isOwner("table", t.id);
  const c = certOf(t);
  const st = reviewStatus(t, Date.now(), policy.soonDays);
  const successor = t.successorId ? table(t.successorId) : null;
  const deprecatedBy = (tables || []).filter((x) => x.successorId === t.id);
  return (
    <div className="panel" style={{ padding: 14, marginBottom: 14 }}>
      <h3 style={{ margin: "0 0 10px", fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}><ShieldCheck size={16} style={{ color: "var(--accent)" }} /> {tr("Stewardship")}</h3>
      <div className="kv-grid">
        <div className="kv-k">{tr("Certification")}</div>
        <div className="kv-v" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {c ? <CertChip t={t} /> : <span className="chip chip-grey">{tr("Not certified")}</span>}
          {c && <span style={{ fontSize: 12, color: "var(--muted)" }}>{fmtDate(t.certifiedAt)} · {t.certifiedBy}{t.certNote ? ` — ${t.certNote}` : ""}</span>}
          {c === "deprecated" && successor && <button className="btn btn-ghost btn-sm mono" onClick={() => setSel({ type: "table", id: successor.id })}><ArrowRight size={13} /> {tr("Successor")}: {successor.name}</button>}
          {may && c !== "endorsed" && <button className="btn btn-sm" onClick={() => certifyTable(t.id, "endorsed")}><BadgeCheck size={13} /> {tr("Endorse")}</button>}
          {may && c !== "deprecated" && <button className="btn btn-sm" onClick={() => setModal({ kind: "deprecate", tableId: t.id })}><Ban size={13} /> {tr("Deprecate…")}</button>}
          {may && c && <button className="btn btn-ghost btn-sm" onClick={() => certifyTable(t.id, "")}><X size={13} /> {tr("Remove")}</button>}
        </div>
        {deprecatedBy.length > 0 && <><div className="kv-k">{tr("Succeeds")}</div><div className="kv-v">{deprecatedBy.map((x) => <button key={x.id} className="btn btn-ghost btn-sm mono" onClick={() => setSel({ type: "table", id: x.id })}>{x.name}</button>)}</div></>}
        <div className="kv-k">{tr("Review")}</div>
        <div className="kv-v" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span className={`chip ${REVIEW_CHIP[st]}`}><CalendarClock size={12} /> {tr(REVIEW_LABEL[st])}</span>
          {t.lastReviewedAt && <span style={{ fontSize: 12, color: "var(--muted)" }}>{tr("Last reviewed")} {fmtDate(t.lastReviewedAt)} · {t.lastReviewedBy}{t.lastReviewNote ? ` — ${t.lastReviewNote}` : ""}</span>}
          {t.reviewCycleDays > 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>· {tr("next")} {fmtDate(nextReviewAt(t))}</span>}
          {may && <button className="btn btn-sm" onClick={() => markReviewed(t.id)}><ClipboardCheck size={13} /> {tr("Mark as reviewed")}</button>}
          {may && (
            <select className="btn btn-sm" value={t.reviewCycleDays || 0} onChange={(e) => setReviewCycle(t.id, Number(e.target.value))} aria-label={tr("Review cycle")}>
              {REVIEW_CYCLES.map((d) => <option key={d} value={d}>{d ? `${tr("every")} ${d} ${tr("days")}` : tr("no review cycle")}</option>)}
            </select>
          )}
        </div>
        <div className="kv-k">{tr("Ownership")}</div>
        <div className="kv-v" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {!t.ownerId ? <span style={{ fontSize: 12, color: "var(--muted)" }}>{tr("Owner inherited — attestation happens on the level where the owner is set")}</span>
            : attestationDue(t, policy.attestDays) ? <span className="chip chip-amber">{t.ownerAttestedAt ? `${tr("Attestation overdue — last")} ${fmtDate(t.ownerAttestedAt)}` : tr("Ownership never confirmed")}</span>
            : <span className="chip chip-green"><ShieldCheck size={12} /> {tr("Ownership confirmed")} {fmtDate(t.ownerAttestedAt)} · {t.ownerAttestedBy}</span>}
          {t.ownerId && owner && <button className="btn btn-sm" onClick={() => attestOwnership("table", t.id)} title={me?.name}><ShieldCheck size={13} /> {tr("Confirm ownership")}</button>}
        </div>
      </div>
    </div>
  );
}

/* one line on databases / schemas / domains: attestation state + the owner's confirm button */
export function AttestationLine({ kind, obj }) {
  const { t: tr } = useT();
  const { perm, stewardshipPolicy: policy } = useCatalogData();
  const { attestOwnership } = useActions();
  if (!obj?.ownerId) return null;
  const due = attestationDue(obj, policy.attestDays);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
      {due ? <span className="chip chip-amber">{obj.ownerAttestedAt ? `${tr("Ownership attestation overdue — last")} ${fmtDate(obj.ownerAttestedAt)}` : tr("Ownership never confirmed")}</span>
        : <span className="chip chip-green"><ShieldCheck size={12} /> {tr("Ownership confirmed")} {fmtDate(obj.ownerAttestedAt)} · {obj.ownerAttestedBy}</span>}
      {perm.isOwner(kind, obj.id) && <button className="btn btn-sm" onClick={() => attestOwnership(kind, obj.id)}><ShieldCheck size={13} /> {tr("Confirm ownership")}</button>}
    </div>
  );
}

/* deprecate dialog: successor (optional) + reason */
export function DeprecateModalC({ tableId, onClose }) {
  const { t: tr } = useT();
  const { table, tables, tablePath } = useCatalogData();
  const { certifyTable } = useActions();
  const t = table(tableId);
  const [q, setQ] = useState("");
  const [successorId, setSuccessorId] = useState(t?.successorId || "");
  const [note, setNote] = useState(t?.certNote || "");
  if (!t) return null;
  const cands = tables.filter((x) => x.id !== t.id && (!q.trim() || tablePath(x).toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 200);
  return (
    <Modal title={`${tr("Deprecate")} ${t.name}`} sub={tr("Marks the table as deprecated. Consumers see the badge, the successor and your reason; lineage and attributes stay untouched. Deprecating is audited.")} onClose={onClose}>
      <Field label={tr("Successor table (optional)")}>
        <input className="mono" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("filter by database.schema.table")} />
        <select className="mono" size={6} value={successorId} onChange={(e) => setSuccessorId(e.target.value)} style={{ width: "100%", marginTop: 6 }}>
          <option value="">— {tr("no successor")} —</option>
          {cands.map((x) => <option key={x.id} value={x.id}>{tablePath(x)}</option>)}
        </select>
      </Field>
      <Field label={tr("Reason (shown to consumers)")}><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} style={{ width: "100%" }} placeholder={tr("e.g. replaced by the gold model in 2026; data frozen at 2025-12-31")} /></Field>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>{tr("Cancel")}</button>
        <button className="btn btn-primary" onClick={() => { certifyTable(t.id, "deprecated", { note, successorId: successorId || null }); onClose(); }}><Ban size={14} /> {tr("Deprecate")}</button>
      </div>
    </Modal>
  );
}

/* Governance Overview: stewardship KPIs and (admins) the policy — attestation interval and reminder cadence */
export function StewardshipPolicyCard() {
  const { t: tr } = useT();
  const { state, isAdmin, stewardshipPolicy: policy } = useCatalogData();
  const { setStewardshipPolicy } = useActions();
  const { flash } = useToast();
  const [p, setP] = useState(policy);
  const [busy, setBusy] = useState(false);
  const [remind, setRemind] = useState(null);
  useEffect(() => { setP(policy); }, [policy]);
  const k = stewardshipKpis(state, policy);
  const save = async () => {
    setBusy(true);
    try { const j = await apiPut("/admin/stewardship/policy", p); setStewardshipPolicy(j?.policy || p); flash("Stewardship policy saved"); }   /* v1.73: applied at once — dashboards and review chips read the shared policy */
    catch (e) { flash("Failed: {error}", { error: e.message }); }
    setBusy(false);
  };
  const remindNow = async () => {
    setBusy(true);
    try { const j = await apiPost("/admin/stewardship/remind", { force: true }); setRemind(j); flash("{n} reminder message(s) sent", { n: j.messages }); }
    catch (e) { flash("Failed: {error}", { error: e.message }); }
    setBusy(false);
  };
  return (
    <div className="panel" style={{ marginTop: 20, padding: 16 }}>
      <h3 style={{ marginTop: 0 }}><BadgeCheck size={17} style={{ color: "var(--green)" }} /> {tr("Stewardship")}</h3>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <span className="chip chip-green"><BadgeCheck size={12} /> {k.endorsed} {tr("endorsed tables")}</span>
        <span className={`chip ${k.deprecated ? "chip-red" : "chip-grey"}`}><Ban size={12} /> {k.deprecated} {tr("deprecated")}</span>
        <span className={`chip ${k.reviewsOverdue ? "chip-amber" : "chip-grey"}`}><CalendarClock size={12} /> {k.reviewsOverdue} / {k.withReviewCycle} {tr("reviews due")}</span>
        <span className={`chip ${k.attestationsDue ? "chip-amber" : "chip-grey"}`}><ShieldCheck size={12} /> {k.attestationsDue} / {k.owned} {tr("ownership attestations due")}</span>
      </div>
      {isAdmin && (
        <div className="field-row" style={{ alignItems: "end" }}>
          <Field label={tr("Owners confirm ownership every (days)")}><input className="mono" type="number" min={1} max={3650} value={p.attestDays} onChange={(e) => setP({ ...p, attestDays: Number(e.target.value) })} /></Field>
          <Field label={tr("Remind at most every (days)")}><input className="mono" type="number" min={1} max={365} value={p.remindEveryDays} onChange={(e) => setP({ ...p, remindEveryDays: Number(e.target.value) })} /></Field>
          <Field label={tr("\"Due soon\" warning (days before)")}><input className="mono" type="number" min={0} max={365} value={p.soonDays} onChange={(e) => setP({ ...p, soonDays: Number(e.target.value) })} /></Field>
          <button className="btn" onClick={save} disabled={busy}>{tr("Save policy")}</button>
          <button className="btn" onClick={remindNow} disabled={busy} title={tr("Sends the due reminders now (otherwise once a day)")}>{tr("Send reminders now")}</button>
        </div>
      )}
      {remind && <div className="modal-sub">{tr("Reminders")}: {remind.reviews} {tr("reviews")}, {remind.attestations} {tr("attestations")}, {remind.messages} {tr("messages")}</div>}
      <div className="modal-sub">{tr("Endorse, deprecate (with successor) and review tables on their Governance tab; owners confirm ownership on tables, schemas, databases and domains. Due items appear on My Dashboard and are sent as in-app reminders once a day.")}</div>
    </div>
  );
}
