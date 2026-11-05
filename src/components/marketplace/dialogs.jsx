/* Marketplace dialogs (v1.73 — split out of marketplace.jsx, finding F-F6): the SOURCE table picker, the step dialogs
   of the design workflow (sourcing, BPO approval, ingestion, generic step note) and the read-only design view. */
import React, { useState } from "react";
import { Database, Layers, Table2, ChevronRight, ChevronDown, X, CheckCircle2, Loader2 } from "lucide-react";
import { useT } from "../../i18n.jsx";
import { useToast } from "../../toast-context.jsx";
import { fill } from "../../lib/i18n-format.js";
import { uploadRequestFile } from "../../lib/api.js";
import { ADV_FIELDS, STEP_DIALOGS, STEP_NOTES, TAG_KEY } from "../../lib/design-workflow.js";
import { Modal, Field } from "../ui.jsx";

export function SourceTablePickerC({ tree, selected, onChange, onClose }) {
  const { t } = useT();
  const [sel, setSel] = useState(new Set(selected));
  const [open, setOpen] = useState({});
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleMany = (ids, on) => setSel((s) => { const n = new Set(s); ids.forEach((id) => on ? n.add(id) : n.delete(id)); return n; });
  const total = tree.reduce((n, d) => n + d.schemas.reduce((m, sc) => m + sc.tables.length, 0), 0);
  return (
    <Modal wide title={t("Select SOURCE tables")} sub={t("Only tables from the SOURCE data hub can be tagged for a data product design. Tick the tables that feed the new data product.")} onClose={onClose}>
      {!total && <div className="empty">{t("The SOURCE hub has no tables yet — load source systems first (Import → Load source).")}</div>}
      <div className="panel" style={{ padding: 8, maxHeight: 380, overflow: "auto" }}>
        {tree.map((d) => {
          const ids = d.schemas.flatMap((sc) => sc.tables.map((tb) => tb.id));
          const all = ids.length > 0 && ids.every((id) => sel.has(id)), some = ids.some((id) => sel.has(id));
          const dOpen = open[d.id] ?? true;
          return (
            <div key={d.id}>
              <div className="tree-row">
                <button className="btn btn-ghost btn-sm" style={{ padding: 1 }} onClick={() => setOpen((o) => ({ ...o, [d.id]: !dOpen }))} aria-expanded={dOpen} aria-label={fill(t(dOpen ? "Collapse {name}" : "Expand {name}"), { name: d.name })}>{dOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                <input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = !all && some; }} onChange={(e) => toggleMany(ids, e.target.checked)} aria-label={fill(t("Select all tables of {name}"), { name: d.name })} />
                <Database size={14} /> <b>{d.name}</b> <span className="tree-count">{d.country}</span>
              </div>
              {dOpen && d.schemas.map((sc) => (
                <div key={sc.id} className="tree-kids">
                  <div className="tree-row" style={{ paddingLeft: 22 }}><Layers size={13} /> <span className="mono">{sc.name}</span></div>
                  {sc.tables.map((tb) => (
                    <label key={tb.id} className="tree-row" style={{ paddingLeft: 44, cursor: "pointer" }}>
                      <input type="checkbox" checked={sel.has(tb.id)} onChange={() => toggle(tb.id)} />
                      <Table2 size={13} /> <span className="mono">{tb.name}</span>
                      {tb.kvTags.filter((k) => k.key === TAG_KEY).map((k) => <span key={k.value} className="chip chip-amber" style={{ marginLeft: 6 }}>{k.value}</span>)}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="modal-actions">
        <span className="modal-sub" style={{ marginRight: "auto" }}>{fill(t("{n} of {total} tables selected"), { n: sel.size, total })}</span>
        <button className="btn" onClick={onClose}>{t("Cancel")}</button>
        <button className="btn btn-primary" onClick={() => { onChange([...sel]); onClose(); }}><CheckCircle2 size={15} /> {t("Use selection")}</button>
      </div>
    </Modal>
  );
}

/* the Business Analyst documents the sourcing before giving the Okay (phase 1) */
export function SourcingModalC({ request, people, onSubmit, onClose }) {
  const { t } = useT();
  const [f, setF] = useState({ sourceSystem: "", bpo: "", leanixUrl: "", dataSteward: "", ...(request.sourcing || {}) });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const ok = f.sourceSystem.trim() && f.bpo.trim() && /^https?:\/\//i.test(f.leanixUrl.trim()) && f.dataSteward.trim();
  return (
    <Modal title={t("Document the sourcing")} sub={`${t("All sourcing details are required for")} "${request.name}" — ${t("submitting requests the data owner's approval directly.")}`} onClose={onClose}>
      <div className="field-row">
        <Field label={t("Source system")}><input value={f.sourceSystem} onChange={set("sourceSystem")} placeholder={t("e.g. SAP FS-CD, DB2 CLAIMS")} autoFocus /></Field>
        <Field label={t("BPO (business process owner) — approves the data use")}><input list="src-people" value={f.bpo} onChange={set("bpo")} placeholder={t("Name")} /></Field>
      </div>
      <Field label={t("Link to LeanIX")}><input className="mono" value={f.leanixUrl} onChange={set("leanixUrl")} placeholder="https://company.leanix.net/…" /></Field>
      <div className="field-row">
        <Field label={t("Data steward")}>
          <input list="src-people" value={f.dataSteward} onChange={set("dataSteward")} placeholder={t("Name (people directory suggestions)")} />
        </Field>
        <datalist id="src-people">{people.map((p) => <option key={p.id} value={p.name} />)}</datalist>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>{t("Cancel")}</button>
        <button className="btn btn-primary" disabled={!ok || busy} onClick={async () => { setBusy(true); await onSubmit(f); setBusy(false); }}><CheckCircle2 size={15} /> {t("Submit and request Approval")}</button>
      </div>
    </Modal>
  );
}

/* the data owner approves the use of the data and attaches the confirming document (e.g. an e-mail) */
export function OwnerApprovalModalC({ request, onSubmit, onDecline, onClose }) {
  const { t } = useT();
  const { flash, prompt } = useToast();
  const [note, setNote] = useState(""); const [url, setUrl] = useState(""); const [file, setFile] = useState(null); const [busy, setBusy] = useState(false);
  const ok = note.trim() || url.trim() || file;
  const submit = async () => {
    setBusy(true);
    try {
      const fileId = file ? (await uploadRequestFile(request.id, file)).id : null;
      await onSubmit({ note: note.trim(), url: url.trim(), fileId });
    } catch (e) { flash("Could not approve — {error}", { error: e.message }); }
    setBusy(false);
  };
  const decline = async () => {
    const reason = await prompt("Decline the data use — reason for the Business Analyst:", null, { title: "Decline the data use", confirmLabel: "Decline" });
    if (reason) onDecline(reason);
  };
  return (
    <Modal title={t("BPO approval")} sub={fill(t("Confirm that the data for \"{name}\" may be used. Attach the document that confirms the approval — for example the e-mail."), { name: request.name })} onClose={onClose}>
      {request.sourcing && <div className="modal-sub">{t("Source system")}: {request.sourcing.sourceSystem} · BPO: {request.sourcing.bpo}{request.sourcing.dataOwner ? ` · ${t("Data owner")}: ${request.sourcing.dataOwner}` : ""}</div>}
      <Field label={t("Approval document (e.g. the confirming e-mail as .eml / .msg / .pdf, max 15 MB)")}><input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
      <Field label={t("… or link to the document")}><input className="mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></Field>
      <Field label={t("Note (optional)")}><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("e.g. approved for reporting purposes, no re-distribution")} style={{ width: "100%" }} /></Field>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>{t("Cancel")}</button>
        <button className="btn btn-danger" disabled={busy} onClick={decline}><X size={15} /> {t("Decline → back to Business Analyst")}</button>
        <button className="btn btn-primary" disabled={!ok || busy} onClick={submit}>{busy ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />} {t("Approve → forward to Data Ingestion")}</button>
      </div>
    </Modal>
  );
}

/* the generic step dialog: a required note plus optional attachments (STEP_DIALOGS) */
export function StepNoteModalC({ request, action, onSubmit, onClose }) {
  const { t } = useT();
  const { flash } = useToast();
  const cfg = STEP_DIALOGS[action];
  const [note, setNote] = useState(""); const [files, setFiles] = useState([]); const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const fileIds = [];
      for (const file of files) fileIds.push((await uploadRequestFile(request.id, file)).id);
      await onSubmit({ note: note.trim(), fileIds });
    } catch (e) { flash("Could not complete the step — {error}", { error: e.message }); }
    setBusy(false);
  };
  return (
    <Modal title={t(cfg.title)} sub={`"${request.name}"`} onClose={onClose}>
      <Field label={t(cfg.label)}><textarea rows={5} value={note} onChange={(e) => setNote(e.target.value)} placeholder={cfg.ph} style={{ width: "100%" }} autoFocus /></Field>
      <Field label={t("Attach files (optional, max 15 MB each)")}><input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} /></Field>
      {files.length > 0 && <div className="modal-sub">{files.map((f) => f.name).join(" · ")}</div>}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>{t("Cancel")}</button>
        <button className="btn btn-primary" disabled={!note.trim() || busy} onClick={submit}>{busy ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />} {t(cfg.button)}</button>
      </div>
    </Modal>
  );
}

/* Data Ingestion documents where the ingested tables can be found */
export function IngestionModalC({ request, onSubmit, onClose }) {
  const { t } = useT();
  const [note, setNote] = useState(""); const [busy, setBusy] = useState(false);
  return (
    <Modal title={t("Confirm ingested tables")} sub={fill(t("\"{name}\" — describe where the ingested tables can be found so the Business Analyst and Development can work with them."), { name: request.name })} onClose={onClose}>
      <Field label={t("Location of the ingested tables (required)")}><textarea rows={5} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Unity Catalog sales_bronze.churn.* (workspace adb-…), refreshed daily 04:00; access via group DATA-SALES-BRONZE" style={{ width: "100%" }} autoFocus /></Field>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>{t("Cancel")}</button>
        <button className="btn btn-primary" disabled={!note.trim() || busy} onClick={async () => { setBusy(true); await onSubmit(note.trim()); setBusy(false); }}><CheckCircle2 size={15} /> {t("Confirm ingested tables")}</button>
      </div>
    </Modal>
  );
}

/* read-only view of the design — laid out exactly like the input forms (design form, sourcing, approval, ingestion) */
const RO = ({ label, value, rows }) => (
  <Field label={label}>{rows ? <textarea rows={rows} value={value || ""} readOnly style={{ width: "100%", background: "#F7F7F5" }} /> : <input value={value || ""} readOnly style={{ background: "#F7F7F5" }} />}</Field>
);

export function DesignViewModalC({ request: r, tableLabel, onClose }) {
  const { t } = useT();
  const adv = r.advanced || {};
  return (
    <Modal wide title={`${t("Design")} · ${r.name}`} sub={`${t("Submitted by")} ${r.requesterName} · ${new Date(r.ts).toLocaleString()}${r.updatedTs ? ` · ${t("last edited")} ${new Date(r.updatedTs).toLocaleString()}` : ""}`} onClose={onClose}>
      <h4 style={{ margin: "4px 0 8px" }}>{t("Design a new data product")}</h4>
      <div className="field-row">
        <RO label={t("Name (required)")} value={r.name} />
        <RO label={t("Data hub (required)")} value={r.hub} />
      </div>
      <div className="field-row">
        <RO label={t("Project (required) — inherited as tag Project")} value={r.project} />
        <RO label={t("Use case (required) — inherited as tag Use Case")} value={r.useCase} />
      </div>
      <RO label={t("Description — what should the data product contain and deliver? (required)")} value={r.purpose} rows={4} />
      <RO label={t("Proposed table tag (key · value) — applied to the selected SOURCE tables")} value={r.tagValue ? `${r.tagKey || TAG_KEY} · ${r.tagValue}` : ""} />
      <RO label={t("Source tables that feed the data product (SOURCE hub only)")} value={(r.tableIds || []).map((id) => tableLabel(id)).join("\n")} rows={Math.min(6, Math.max(2, (r.tableIds || []).length))} />
      <div className="panel" style={{ padding: 12, marginTop: 6 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{t("Advanced")}</div>
        <div className="field-row">
          {ADV_FIELDS.slice(0, 3).map(([k, label]) => <RO key={k} label={t(label)} value={adv[k]} />)}
        </div>
        <div className="field-row" style={{ marginBottom: 0 }}>
          <RO label={t("Data type")} value={adv.dataType} />
          <RO label={t("Needed by")} value={adv.neededBy} />
          <RO label={t("Retention")} value={adv.retention} />
        </div>
      </div>
      {r.sourcing && (
        <>
          <h4 style={{ margin: "16px 0 8px" }}>{t("Document the sourcing")}</h4>
          <div className="field-row"><RO label={t("Source system")} value={r.sourcing.sourceSystem} /><RO label={t("BPO (business process owner)")} value={r.sourcing.bpo} /></div>
          <RO label={t("Link to LeanIX")} value={r.sourcing.leanixUrl} />
          <div className="field-row"><RO label={t("Data steward")} value={r.sourcing.dataSteward} />{r.sourcing.dataOwner && <RO label={t("Data owner")} value={r.sourcing.dataOwner} />}</div>
        </>
      )}
      {r.approval && (
        <>
          <h4 style={{ margin: "16px 0 8px" }}>{t("Data owner approval")}</h4>
          <div className="field-row"><RO label={t("Approved by")} value={`${r.approval.approvedBy} · ${new Date(r.approval.ts).toLocaleString()}`} />
            <Field label={t("Approval document")}>{r.approval.fileId ? <a className="btn btn-sm" href={`/api/marketplace/files/${r.approval.fileId}`}>{r.approval.fileName || t("document")}</a> : r.approval.url ? <a className="btn btn-sm" href={r.approval.url} target="_blank" rel="noreferrer noopener">{t("document link")}</a> : <input value="—" readOnly style={{ background: "#F7F7F5" }} />}</Field></div>
          {r.approval.note && <RO label={t("Note (optional)")} value={r.approval.note} rows={2} />}
        </>
      )}
      {r.ingestion && (
        <>
          <h4 style={{ margin: "16px 0 8px" }}>{t("Confirm ingested tables")}</h4>
          <RO label={t("Location of the ingested tables (required)")} value={`${r.ingestion.note}\n— ${r.ingestion.by}, ${new Date(r.ingestion.ts).toLocaleString()}`} rows={4} />
        </>
      )}
      {STEP_NOTES.filter(([k]) => r[k]).map(([k, label]) => (
        <React.Fragment key={k}>
          <h4 style={{ margin: "16px 0 8px" }}>{t(label)}</h4>
          <RO label={t("Notes")} value={`${r[k].note}\n— ${r[k].by}, ${new Date(r[k].ts).toLocaleString()}`} rows={4} />
          {r[k].files?.length > 0 && <Field label={t("Attached files")}><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{r[k].files.map((f) => <a key={f.id} className="btn btn-sm" href={`/api/marketplace/files/${f.id}`}>{f.name}</a>)}</div></Field>}
        </React.Fragment>
      ))}
      <div className="modal-actions"><button className="btn btn-primary" onClick={onClose}>{t("Close")}</button></div>
    </Modal>
  );
}
