/* "My / All requests" tab of the marketplace (v1.73 — split out of MarketplaceViewC, finding F-F6): the request rows,
   their per-row workflow actions and the step dialogs those actions open. The five dialog slots of the old view are
   one `dialog` state ({ kind, request, action? }). */
import { clickable } from "../ui.jsx";
import React, { useState } from "react";
import { CheckCircle2, Circle, Eye, Loader2, Pencil, Send, Tag, Trash2, X } from "lucide-react";
import { useT } from "../../i18n.jsx";
import { useToast } from "../../toast-context.jsx";
import { fill } from "../../lib/i18n-format.js";
import { apiPatch, apiDelete } from "../../lib/api.js";
import { ADV_FIELDS, DESIGN_ACTIONS, DESIGN_STATUS, PHASES, PHASE_OF, PROCESS_STEPS, STEP_DIALOGS, STEP_NOTES, STEP_RANK, availableActions, phaseState, waitingText } from "../../lib/design-workflow.js";
import { SourcingModalC, OwnerApprovalModalC, IngestionModalC, StepNoteModalC, DesignViewModalC } from "./dialogs.jsx";

const statusOf = (r) => DESIGN_STATUS[r.status] || [r.status, "chip-grey"];
const PHASE_TEXT = { done: "completed", withdrawn: "withdrawn", pending: "not started" };
const DELETE_WARNING = {
  access: "Warning: this permanently deletes the access request \"{name}\" (status: {status}) including its history and notifications. Continue?",
  design: "Warning: this permanently deletes the data product design \"{name}\" (status: {status}) including its history and notifications. Continue?",
};
/* dialogs opened by a workflow action instead of a direct status change */
const ACTION_DIALOG = { refinement_ok: "sourcing", owner_approve: "approval", ingestion_confirm: "ingestion" };

function StepRailC({ status }) {
  const { t } = useT();
  const rank = STEP_RANK[status] ?? -1; const finished = status === "done";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, minWidth: 250, paddingLeft: 14, borderLeft: "1px solid var(--line)" }} aria-label={t("Process steps")}>
      {PROCESS_STEPS.map(([label, need], i) => {
        const done = finished || rank >= need;
        const current = !done && need === rank + 1;
        return (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 26 }}>
            <span title={done ? t("completed") : current ? t("current step") : t("open")} style={{ width: 14, height: 14, borderRadius: 99, flexShrink: 0, background: done ? "var(--green)" : "#D9D9D6", boxShadow: current ? "0 0 0 2px var(--accent)" : "none" }} />
            <span style={{ fontSize: 12, color: done ? "var(--ink)" : "var(--muted)", fontWeight: current ? 600 : 400 }}>{i + 1}. {t(label)}</span>
          </div>
        );
      })}
    </div>
  );
}

/* the expanded detail of a design: phases, advanced fields, approval, sourcing, recent history, step rail */
function DesignDetail({ r }) {
  const { t } = useT();
  return (
    <div style={{ margin: "4px 0 10px 12px", padding: "10px 12px", borderLeft: "3px solid var(--accent)", background: "#FAFAF8", borderRadius: 8, display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 320 }}>
        {PHASES.map((ph) => {
          const st = phaseState(r, ph); const color = st === "done" ? "var(--green)" : st === "current" ? "var(--accent)" : "var(--muted)";
          return (
            <div key={ph.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", opacity: st === "pending" ? .6 : 1 }}>
              {st === "done" ? <CheckCircle2 size={16} style={{ color, flexShrink: 0 }} /> : st === "current" ? <Loader2 size={16} className="spin" style={{ color, flexShrink: 0 }} /> : <Circle size={16} style={{ color, flexShrink: 0 }} />}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: st === "current" ? "var(--accent)" : "inherit" }}>{t(ph.title)} <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12 }}>· {t(ph.who)}</span></div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{t(st === "current" ? statusOf(r)[0] : PHASE_TEXT[st])}</div>
              </div>
            </div>
          );
        })}
        {r.advanced && Object.values(r.advanced).some(Boolean) && (
          <div style={{ fontSize: 12, marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {ADV_FIELDS.filter(([k]) => r.advanced[k]).map(([k, label]) => <span key={k} className="chip chip-grey">{t(label)}: {r.advanced[k]}</span>)}
          </div>
        )}
        {r.approval && (
          <div style={{ fontSize: 12, marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span className="chip chip-blue"><CheckCircle2 size={11} /> {t("Data use approved by")} {r.approval.approvedBy} · {new Date(r.approval.ts).toLocaleDateString()}</span>
            {r.approval.fileId && <a className="chip chip-grey" href={`/api/marketplace/files/${r.approval.fileId}`}>{r.approval.fileName || t("document")}</a>}
            {r.approval.url && <a className="chip chip-grey" href={r.approval.url} target="_blank" rel="noreferrer noopener">{t("document link")}</a>}
            {r.approval.note && <span style={{ color: "var(--muted)" }}>{r.approval.note}</span>}
          </div>
        )}
        {r.sourcing && (
          <div style={{ fontSize: 12, marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span className="chip chip-blue">{t("Source:")} {r.sourcing.sourceSystem}</span><span className="chip chip-blue">BPO: {r.sourcing.bpo}</span>
            <a className="chip chip-blue" href={r.sourcing.leanixUrl} target="_blank" rel="noreferrer noopener">LeanIX</a>
            {r.sourcing.dataOwner && <span className="chip chip-amber">{t("Owner:")} {r.sourcing.dataOwner}</span>}<span className="chip chip-grey">{t("Steward:")} {r.sourcing.dataSteward}</span>
          </div>
        )}
        {(r.history || []).length > 0 && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{r.history.slice(-4).map((h, i) => <div key={i}>{new Date(h.ts).toLocaleString()} · {h.by} · {h.action}{h.reason ? ` — ${h.reason}` : ""}</div>)}</div>}
      </div>
      <StepRailC status={r.status} />
    </div>
  );
}

/* one request row: status, summary, notes and the buttons the signed-in user may press */
function RequestRow({ r, selected, actions, isAdmin, onToggle, onAction, onView, onSetStatus, onDelete }) {
  const { t, tn } = useT();
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  const phase = r.kind === "design" ? PHASE_OF(r.status) : 0;
  return (
    <div className={`role-row edge-row ${selected ? "sel" : ""}`} style={{ alignItems: "flex-start", flexWrap: "wrap" }} {...clickable(onToggle)}>
      <span className={`chip ${statusOf(r)[1]}`}>{t(statusOf(r)[0])}</span>
      <span className="chip chip-grey">{r.kind === "access" ? t("access") : t("design")}</span>
      {phase > 0 && <span className="chip chip-blue" title={t(PHASES[phase - 1]?.title)}>{t("Phase")} {phase} · {t(PHASES[phase - 1]?.title).replace(/^\d+ · /, "")}</span>}
      <div style={{ flex: 1, minWidth: 260 }}>
        <div style={{ fontWeight: 600 }}>{r.kind === "access" ? r.productLabel : `${r.name} → ${r.hub}`}
          {r.kind === "design" && r.tagValue && <span className="chip chip-amber" style={{ marginLeft: 8 }}><Tag size={11} /> {r.tagKey}: {r.tagValue}</span>}
          {r.kind === "design" && r.project && <span className="chip chip-blue" style={{ marginLeft: 6 }}><Tag size={11} /> {t("Project")}: {r.project}</span>}
          {r.kind === "design" && r.useCase && <span className="chip chip-blue" style={{ marginLeft: 6 }}><Tag size={11} /> {t("Use Case")}: {r.useCase}</span>}</div>
        <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{r.purpose}</div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>{r.requesterName} · {new Date(r.ts).toLocaleString()}{r.kind === "design" ? ` · ${tn(["{n} SOURCE table", "{n} SOURCE tables"], r.tableIds.length)}` : ""}{r.decidedBy ? ` · ${fill(t("last step by {name}"), { name: r.decidedBy })}${r.updatedTs ? ` (${new Date(r.updatedTs).toLocaleString()})` : ""}` : ""}</div>
        {r.reason && <div style={{ fontSize: 12, color: "var(--red)" }}>{t("Reason:")} {r.reason}</div>}
        {!["done", "withdrawn", "rejected"].includes(r.status) && <div style={{ fontSize: 12, marginTop: 2 }}><span className="chip chip-grey"><Send size={11} /> {t("waiting for:")} {waitingText(r, t)}</span></div>}
        {STEP_NOTES.filter(([k]) => r[k]).map(([k, label]) => <div key={k} style={{ fontSize: 12, marginTop: 4 }}><span className="chip chip-blue">{t(label)}</span> <span style={{ whiteSpace: "pre-wrap" }}>{r[k].note}</span> {(r[k].files || []).map((f) => <a key={f.id} className="chip chip-grey" href={`/api/marketplace/files/${f.id}`}>{f.name}</a>)} <span style={{ color: "var(--muted)" }}>— {r[k].by}, {new Date(r[k].ts).toLocaleDateString()}</span></div>)}
        {r.ingestion && <div style={{ fontSize: 12, marginTop: 4 }}><span className="chip chip-blue">{t("Ingested tables")}</span> <span style={{ whiteSpace: "pre-wrap" }}>{r.ingestion.note}</span> <span style={{ color: "var(--muted)" }}>— {r.ingestion.by}, {new Date(r.ingestion.ts).toLocaleDateString()}</span></div>}
      </div>
      {r.kind === "design" && r.status !== "submitted" && <button className="btn btn-sm" onClick={stop(onView)} title={t("View the original design entries")}><Eye size={13} /> {t("View")}</button>}
      {r.kind === "design" && actions.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {actions.map(([k, s]) => <button key={k} className={`btn btn-sm ${s.primary ? "btn-primary" : ""} ${s.danger ? "btn-danger" : ""}`} onClick={stop(() => onAction(k))}>{k === "edit" ? <Pencil size={13} /> : s.danger ? <X size={13} /> : <CheckCircle2 size={13} />} {t(s.label)}</button>)}
        </div>
      )}
      {r.kind === "access" && isAdmin && r.status === "open" && (
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn btn-sm" onClick={stop(() => onSetStatus("approved"))}><CheckCircle2 size={13} /> {t("Approve")}</button>
          <button className="btn btn-sm btn-danger" onClick={stop(() => onSetStatus("rejected"))}><X size={13} /> {t("Reject")}</button>
        </div>
      )}
      {r.kind === "access" && isAdmin && r.status === "approved" && <button className="btn btn-sm" onClick={stop(() => onSetStatus("done"))}>{t("Mark done")}</button>}
      {isAdmin && <button className="btn btn-ghost btn-sm btn-danger" title={t("Delete request (admins)")} aria-label={t("Delete request")} onClick={stop(onDelete)}><Trash2 size={13} /></button>}
    </div>
  );
}

/* requests: list of rows; me / isAdmin / isOwnerOf decide the buttons; onEdit(r) loads a design into the form;
   onChanged({ catalog }) reloads the list (and the catalog when tags may have changed) */
export function RequestList({ requests, me, isAdmin, isOwnerOf, people, sourceTree, onEdit, onChanged }) {
  const { t } = useT();
  const { flash, confirm, prompt } = useToast();
  const [selReq, setSelReq] = useState(null);
  const [dialog, setDialog] = useState(null);   /* { kind: sourcing | approval | ingestion | step | view, request, action? } */
  const close = () => setDialog(null);
  const patch = (id, body) => apiPatch(`/api/marketplace/requests/${id}`, body);
  const done = (catalog = false) => onChanged({ catalog });

  const act = async (r, action) => {
    const spec = DESIGN_ACTIONS[action];
    if (action === "edit") return onEdit(r);
    if (ACTION_DIALOG[action]) return setDialog({ kind: ACTION_DIALOG[action], request: r });
    if (STEP_DIALOGS[action]) return setDialog({ kind: "step", request: r, action });
    let reason;
    if (spec.reason) { reason = await prompt("{action} \"{name}\" — please give a reason:", { action: t(spec.label), name: r.name }, { title: spec.label, confirmLabel: spec.label, danger: !!spec.danger }); if (!reason) return; }
    try { const j = await patch(r.id, { action, reason }); done(true); flash("\"{name}\": {status}", { name: r.name, status: t(DESIGN_STATUS[j.request?.status]?.[0] || j.request?.status) }); } catch (e) { flash(e.message || "Could not update request"); }
  };
  const submitSourcing = async (f) => {
    const r = dialog.request;
    try { await patch(r.id, { action: "refinement_ok", sourcing: f }); close(); done(); flash("\"{name}\": refinement approved, sourcing documented", { name: r.name }); } catch (e) { flash(e.message || "Could not give the Okay"); }
  };
  const submitApproval = async (f) => {
    const r = dialog.request;
    await patch(r.id, { action: "owner_approve", ...f });   /* errors propagate to the dialog */
    close(); done(); flash("\"{name}\": data use approved — forwarded to Data Ingestion", { name: r.name });
  };
  const declineApproval = async (reason) => {
    const r = dialog.request;
    try { await patch(r.id, { action: "owner_reject", reason }); close(); done(); flash("\"{name}\": declined — back with the Business Analyst", { name: r.name }); } catch { flash("Could not decline"); }
  };
  const submitIngestion = async (note) => {
    const r = dialog.request;
    try { await patch(r.id, { action: "ingestion_confirm", note }); close(); done(true); flash("\"{name}\": ingested tables confirmed", { name: r.name }); } catch (e) { flash(e.message || "Could not confirm"); }
  };
  const submitStep = async ({ note, fileIds }) => {
    const { request: r, action } = dialog;
    const j = await patch(r.id, { action, note, fileIds });   /* errors propagate to the dialog */
    close(); done(j.request?.status === "done"); flash("\"{name}\": {status}", { name: r.name, status: t(STEP_DIALOGS[action].title) });
  };
  const deleteRequest = async (r) => {
    const label = r.kind === "access" ? r.productLabel : r.name;
    if (!(await confirm(DELETE_WARNING[r.kind === "access" ? "access" : "design"], { name: label, status: t(statusOf(r)[0]) }, { danger: true, confirmLabel: "Continue" }))) return;
    if (!(await confirm("Please confirm once more: delete \"{name}\" for good?", { name: label }, { danger: true }))) return;
    try { await apiDelete(`/api/marketplace/requests/${r.id}`); flash("Request deleted"); if (selReq === r.id) setSelReq(null); done(true); } catch { flash("Could not delete request"); }
  };
  const setStatus = async (r, status) => {
    let reason;
    if (status === "rejected") { reason = await prompt("Reason for rejecting:", null, { title: "Reject the request", confirmLabel: "Reject", danger: true, required: false }); if (reason === null) return; }
    try { await patch(r.id, { status, reason }); done(); flash(status === "approved" ? "Request approved" : "Request rejected"); } catch { flash("Could not update request"); }
  };
  const tableLabel = (id) => { for (const d of sourceTree) for (const sc of d.schemas) { const tb = sc.tables.find((x) => x.id === id); if (tb) return `${d.name}.${sc.name}.${tb.name}`; } return id; };

  const r = dialog?.request;
  return (
    <div className="panel" style={{ padding: 10, marginTop: 14 }}>
      {!requests.length && <div className="empty">{t("No requests yet.")}</div>}
      {requests.map((req) => (
        <React.Fragment key={req.id}>
          <RequestRow r={req} selected={selReq === req.id} actions={req.kind === "design" ? availableActions(req, me, isOwnerOf) : []} isAdmin={isAdmin}
            onToggle={() => setSelReq(selReq === req.id ? null : req.id)} onAction={(k) => act(req, k)} onView={() => setDialog({ kind: "view", request: req })}
            onSetStatus={(status) => setStatus(req, status)} onDelete={() => deleteRequest(req)} />
          {selReq === req.id && req.kind === "design" && <DesignDetail r={req} />}
        </React.Fragment>
      ))}
      {dialog?.kind === "sourcing" && <SourcingModalC request={r} people={people} onSubmit={submitSourcing} onClose={close} />}
      {dialog?.kind === "approval" && <OwnerApprovalModalC request={r} onSubmit={submitApproval} onDecline={declineApproval} onClose={close} />}
      {dialog?.kind === "ingestion" && <IngestionModalC request={r} onSubmit={submitIngestion} onClose={close} />}
      {dialog?.kind === "step" && <StepNoteModalC request={r} action={dialog.action} onSubmit={submitStep} onClose={close} />}
      {dialog?.kind === "view" && <DesignViewModalC request={r} tableLabel={tableLabel} onClose={close} />}
    </div>
  );
}
