/* "Design a new data product" tab of the marketplace (v1.73 — split out of MarketplaceViewC, finding F-F6). The form
   state comes from useDesignForm() in the composer (a request row's "Edit" loads a design into it); this component
   renders it, owns the SOURCE table picker and submits. */
import { useState } from "react";
import { ChevronDown, ChevronRight, CheckCircle2, Loader2, Tag } from "lucide-react";
import { useT } from "../../i18n.jsx";
import { useToast } from "../../toast-context.jsx";
import { apiPost, apiPatch } from "../../lib/api.js";
import { ADV_FIELDS, RETENTION_SUGGESTIONS, TAG_KEY } from "../../lib/design-workflow.js";
import { Field } from "../ui.jsx";
import { SourceTablePickerC } from "./dialogs.jsx";

export function DesignForm({ design, hubs, projectValues = [], useCaseValues = [], sourceTree, onSubmitted }) {
  const { t, tn } = useT();
  const { flash } = useToast();
  const { form, set, setAdv, setTag, resetTag, reset, tagValue, valid, payload } = design;
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const fields = payload();
      if (form.editingId) {
        await apiPatch(`/api/marketplace/requests/${form.editingId}`, { action: "edit", fields });
        flash("Design \"{name}\" updated — tags on the selected SOURCE tables synchronised", { name: fields.name });
      } else {
        await apiPost("/api/marketplace/requests", { kind: "design", ...fields });
        flash("Data product \"{name}\" submitted — forwarded to the Business Analyst; the selected SOURCE tables now carry the Data Product, Project and Use Case tags", { name: fields.name });
      }
      reset(); onSubmitted();
    } catch (e) { flash("Could not submit — {error}", { error: e.message }); }
    setBusy(false);
  };
  const advInput = (k) => ({ value: form.adv[k], onChange: (e) => setAdv(k, e.target.value), maxLength: 200 });
  return (
    <div className="panel" style={{ padding: 18, marginTop: 14, maxWidth: 760 }}>
      <div className="field-row">
        <Field label={t("Name (required)")}><input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={t("e.g. Churn list")} /></Field>
        <Field label={t("Data hub (required)")}>
          <select value={form.hubName} onChange={(e) => set("hubName", e.target.value)}>{hubs.map((h) => <option key={h.id} value={h.name}>{h.name}</option>)}</select>
        </Field>
      </div>
      <div className="field-row">
        <Field label={t("Project (required) — inherited as tag Project")}>
          <input list="design-projects" value={form.project} onChange={(e) => set("project", e.target.value)} placeholder={t("e.g. GenAI, Customer360")} />
          <datalist id="design-projects">{projectValues.map((v) => <option key={v} value={v} />)}</datalist>
        </Field>
        <Field label={t("Use case (required) — inherited as tag Use Case")}>
          <input list="design-usecases" value={form.useCase} onChange={(e) => set("useCase", e.target.value)} placeholder={t("e.g. Claims fraud detection")} maxLength={250} />
          <datalist id="design-usecases">{useCaseValues.map((v) => <option key={v} value={v} />)}</datalist>
        </Field>
      </div>
      <Field label={t("Description — what should the data product contain and deliver? (required)")}><textarea rows={5} value={form.desc} onChange={(e) => set("desc", e.target.value)} style={{ width: "100%" }} /></Field>
      <Field label={t("Proposed table tag (key · value) — applied to the selected SOURCE tables")}>
        <div className="field-row" style={{ marginBottom: 0 }}>
          <input className="mono" value={TAG_KEY} readOnly style={{ maxWidth: 160 }} />
          <input className="mono" value={tagValue} onChange={(e) => setTag(e.target.value)} placeholder={t("Sales Gold.churn_list (Churn list)")} />
          {form.tagTouched && <button className="btn btn-sm" onClick={resetTag}>{t("Reset")}</button>}
        </div>
      </Field>
      <Field label={t("Source tables that feed the data product (SOURCE hub only)")}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="btn" onClick={() => setPicker(true)}><Tag size={14} /> {t("Select SOURCE tables…")}</button>
          <span className="modal-sub" style={{ margin: 0 }}>{tn(["{n} table selected", "{n} tables selected"], form.tableIds.length)}</span>
        </div>
      </Field>
      <div className="modal-sub">{t("The selected SOURCE tables receive the Data Product, Project and Use Case tags as soon as the design is submitted; removing a table from the selection removes them again. Existing tag values on a table are kept.")}</div>
      <button className="btn btn-ghost btn-sm" style={{ marginTop: 6, color: "var(--accent)" }} onClick={() => set("advOpen", !form.advOpen)}>{form.advOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {t("Advanced")}</button>
      {form.advOpen && (
        <div className="panel" style={{ padding: 12, marginTop: 6 }}>
          <div className="field-row">
            {ADV_FIELDS.slice(0, 3).map(([k, label, ph]) => <Field key={k} label={t(label)}><input {...advInput(k)} placeholder={t(ph)} /></Field>)}
          </div>
          <div className="field-row" style={{ marginBottom: 0 }}>
            <Field label={t("Data type")}><input list="adv-datatype" {...advInput("dataType")} placeholder={t("structured / unstructured")} /><datalist id="adv-datatype"><option value="structured" /><option value="unstructured" /><option value="semi-structured" /></datalist></Field>
            <Field label={t("Needed by")}><input {...advInput("neededBy")} placeholder={t("e.g. 2026-12-31 or Q1 2027")} /></Field>
            <Field label={t("Retention")}><input list="adv-retention" {...advInput("retention")} placeholder={t("e.g. 3 months, 10 years, unlimited")} /><datalist id="adv-retention">{RETENTION_SUGGESTIONS.map((v) => <option key={v} value={v} />)}</datalist></Field>
          </div>
        </div>
      )}
      <div className="modal-actions">
        {form.editingId && <button className="btn" onClick={reset}>{t("Cancel edit")}</button>}
        <button className="btn btn-primary" disabled={busy || !valid} onClick={submit}>{busy ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />} {form.editingId ? t("Save changes") : t("Submit data product design")}</button>
      </div>
      {picker && <SourceTablePickerC tree={sourceTree} selected={form.tableIds} onChange={(ids) => set("tableIds", ids)} onClose={() => setPicker(false)} />}
    </div>
  );
}
