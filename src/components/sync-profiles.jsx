import { useState, useEffect } from "react";
import { useT } from "../i18n.jsx";
import { useToast } from "../toast-context.jsx";
import { apiGetOr } from "../lib/api.js";
import { fmtTs } from "../lib/format.js";
import { useApiCall } from "../hooks/use-api-call.js";
import { RefreshCw, Plus, Pencil, Trash2, Play, Loader2, CheckCircle2, AlertTriangle, Plug, Save, UploadCloud } from "lucide-react";
import { Field, Modal } from "./ui.jsx";
import { WriteBackModalC } from "./writeback.jsx";
import { useContext } from "react";
import { CatalogDataContext } from "../catalog-context.jsx";

/* Scheduled Unity Catalog synchronisation (v1.59): profiles, last runs, run now, connection test */
const EMPTY = { name: "", host: "", catalog: "", hubId: "", country: "GLOBAL", layer: "", mode: "report", schedule: "manual", time: "03:00", deleteMissing: false, lineage: false, updateTypes: true, enabled: true, warehouseId: "", importTags: true, auth: { type: "pat", token: "", clientId: "", clientSecret: "" }, writeBack: { enabled: false, comments: true, roles: true, columns: true, owner: false } };
const SCHEDULE_LABEL = { manual: "Manual", hourly: "Hourly", daily: "Daily" };

export function SyncProfilesC() {
  const { t } = useT();
  const { confirm } = useToast();
  const hubs = useContext(CatalogDataContext)?.hubs || [];
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const load = async () => { const j = await apiGetOr("/admin/sync/profiles"); if (j) setData(j); };
  useEffect(() => { load(); }, []);
  const { busy, call } = useApiCall(load);
  const save = async () => {
    const j = await call("save", "/admin/sync/profiles", { method: "PUT", body: edit }, t("Sync profile saved"));
    if (j) setEdit(null);
  };
  const run = (p) => call(`run-${p.id}`, `/admin/sync/profiles/${p.id}/run`, { method: "POST", body: {} }, (j) => j.result.ok ? `${p.name}: ${j.result.total} ${t("difference(s)")}${j.result.applied ? `, ${j.result.applied} ${t("change(s) applied")}` : ""}` : `${p.name}: ${j.result.error}`);
  /* v1.64 server-side write-back; v1.77: preview-first dialog, the admin's own changes (+ the unattributed ones) */
  const [wbFor, setWbFor] = useState(null);
  const test = async (p) => { setTestResult(null); const j = await call(`test-${p.id}`, `/admin/sync/profiles/${p.id}/test`, { method: "POST", body: {} }); setTestResult(j ? { id: p.id, ...j } : { id: p.id, ok: false }); };
  const remove = async (p) => { if (!(await confirm("Delete sync profile {name}? The imported objects stay in the catalog.", { name: p.name }, { danger: true }))) return; call(`del-${p.id}`, `/admin/sync/profiles/${p.id}`, { method: "DELETE" }, t("Sync profile deleted")); };
  const set = (k) => (e) => setEdit({ ...edit, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const setAuth = (k) => (e) => setEdit({ ...edit, auth: { ...edit.auth, [k]: e.target.value } });
  const setWb = (k) => (e) => setEdit({ ...edit, writeBack: { ...edit.writeBack, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value } });
  const profiles = data?.profiles || [];
  return (
    <div className="panel" style={{ marginTop: 18, padding: 16 }} data-testid="sync-profiles">
      <h3 style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}><RefreshCw size={17} /> {t("Scheduled synchronisation")}
        <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => setEdit({ ...EMPTY, hubId: hubs[0]?.id || "central" })}><Plus size={13} /> {t("New sync profile")}</button>
      </h3>
      <div className="modal-sub">{t("Reads schemas, tables and columns of a Unity Catalog catalog on a schedule, compares them with the catalog and either applies the differences or only reports them. The responsible stewards and owners are notified about drift in their language (admins when nobody is responsible).")}{data?.scheduler === "external" ? ` ${t("Scheduler: external — runs are triggered via POST /admin/tasks/uc-sync/run.")}` : ""}</div>
      {data && !profiles.length && <div className="modal-sub">{t("No sync profiles yet.")}</div>}
      {profiles.map((p) => (
        <div key={p.id} className="role-row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontWeight: 600, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>{p.name}
              <span className="chip chip-grey mono">{p.catalog}</span>
              <span className={`chip ${p.mode === "apply" ? "chip-blue" : "chip-amber"}`}>{p.mode === "apply" ? t("apply") : t("report only")}</span>
              <span className="chip chip-grey">{t(SCHEDULE_LABEL[p.schedule] || p.schedule)}{p.schedule === "daily" ? ` ${p.time}` : ""}</span>
              {p.writeBack?.enabled && <span className="chip chip-blue">{t("write-back")}</span>}
              {!p.enabled && <span className="chip chip-red">{t("disabled")}</span>}
              {data.due?.includes(p.id) && <span className="chip chip-amber">{t("due")}</span>}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{p.auth.type === "app" ? t("app identity") : p.host} · {hubs.find((h) => h.id === p.hubId)?.name || p.hubId} · {p.country}{p.layer ? ` · ${p.layer}` : ""}{p.deleteMissing ? ` · ${t("removes missing objects")}` : ""}{p.lineage ? ` · ${t("lineage")}` : ""}</div>
            {p.lastRun && (
              <div style={{ fontSize: 12, marginTop: 4, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {p.lastRun.ok ? <CheckCircle2 size={13} style={{ color: "var(--green)" }} /> : <AlertTriangle size={13} style={{ color: "var(--red)" }} />}
                <span>{t("Last run")} {fmtTs(p.lastRun.at)}</span>
                {p.lastRun.ok ? <span>· {p.lastRun.total} {t("difference(s)")}{p.lastRun.applied ? `, ${p.lastRun.applied} ${t("change(s) applied")}` : ""}{p.lastRun.notified ? `, ${p.lastRun.notified} ${t("notified")}` : ""}</span> : <span style={{ color: "var(--red)" }}>· {p.lastRun.error}</span>}
                {p.lastRun.ok && p.lastRun.total > 0 && <details style={{ width: "100%" }}><summary className="modal-sub" style={{ cursor: "pointer", margin: 0 }}>{t("Details")}</summary>
                  <div className="mono" style={{ fontSize: 11.5, whiteSpace: "pre-wrap" }}>{Object.entries(p.lastRun.counts || {}).filter(([, n]) => n).map(([k, n]) => `${k}: ${n}`).join(" · ")}
                    {["newTables", "newColumns", "removedTables", "removedColumns"].flatMap((k) => (p.lastRun.samples?.[k] || []).map((x) => `\n${k}: ${x}`)).join("")}
                    {(p.lastRun.samples?.changedTypes || []).map((x) => `\nchangedType: ${x.path} ${x.from} → ${x.to}`).join("")}</div></details>}
              </div>
            )}
            {p.lastWriteBack && (
              <div style={{ fontSize: 12, marginTop: 4, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {p.lastWriteBack.ok ? <CheckCircle2 size={13} style={{ color: "var(--green)" }} /> : <AlertTriangle size={13} style={{ color: "var(--red)" }} />}
                <span>{t("Last write-back")} {fmtTs(p.lastWriteBack.at)}</span>
                {p.lastWriteBack.error ? <span style={{ color: "var(--red)" }}>· {p.lastWriteBack.error}</span> : <span>· {p.lastWriteBack.written} {t("change(s) written to Unity Catalog")}{p.lastWriteBack.failed ? `, ${p.lastWriteBack.failed} ${t("failed")}` : ""}{p.lastWriteBack.skipped ? `, ${p.lastWriteBack.skipped} ${t("skipped (no SQL warehouse)")}` : p.lastWriteBack.tagsReadable === false ? ` · ${t("tags skipped (no SQL warehouse)")}` : ""}</span>}
              </div>
            )}
            {testResult?.id === p.id && <div className={`notice ${testResult.ok ? "notice-ok" : "notice-err"}`} style={{ marginTop: 6 }}><span>{testResult.ok ? `${t("Connection OK")}: ${testResult.schemas} ${t("schemas")}, ${testResult.tables} ${t("tables")}, ${testResult.columns} ${t("columns")}` : testResult.error || t("Connection failed")}</span></div>}
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button className="btn btn-sm" onClick={() => test(p)} disabled={!!busy} title={t("Test connection")}>{busy === `test-${p.id}` ? <Loader2 size={13} className="spin" /> : <Plug size={13} />}</button>
            <button className="btn btn-sm btn-primary" onClick={() => run(p)} disabled={!!busy}>{busy === `run-${p.id}` ? <Loader2 size={13} className="spin" /> : <Play size={13} />} {t("Run now")}</button>
            <button className="btn btn-sm" onClick={() => setWbFor(p.id)} disabled={!!busy} title={t("Write back")} aria-label={`${t("Write back")} ${p.name}`}><UploadCloud size={13} /> {t("Write back")}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ ...EMPTY, ...p, auth: { ...EMPTY.auth, ...p.auth }, writeBack: { ...EMPTY.writeBack, ...(p.writeBack || {}) } })} aria-label={`${t("Edit")} ${p.name}`}><Pencil size={13} /></button>
            <button className="btn btn-ghost btn-sm btn-danger" onClick={() => remove(p)} aria-label={`${t("Delete")} ${p.name}`}><Trash2 size={13} /></button>
          </div>
        </div>
      ))}
      {wbFor && <WriteBackModalC profileId={wbFor} isAdmin onClose={() => setWbFor(null)} onWritten={load} />}
      {edit && (
        <Modal title={edit.id ? t("Edit sync profile") : t("New sync profile")} sub={t("Credentials are stored in the catalog settings and used only for this synchronisation.")} onClose={() => setEdit(null)}>
          <div className="field-row">
            <Field label={t("Name")}><input value={edit.name} onChange={set("name")} autoFocus /></Field>
            <Field label={t("Unity Catalog catalog")}><input className="mono" value={edit.catalog} onChange={set("catalog")} placeholder="main" /></Field>
          </div>
          <div className="field-row">
            <Field label={t("Authentication")}>
              <select value={edit.auth.type} onChange={setAuth("type")}>
                <option value="pat">{t("Personal access token")}</option>
                <option value="sp">{t("Service principal (client credentials)")}</option>
                <option value="app" disabled={!data?.appIdentity}>{t("App identity (Databricks Apps)")}</option>
              </select>
            </Field>
            {edit.auth.type !== "app" && <Field label={t("Workspace host")}><input className="mono" value={edit.host} onChange={set("host")} placeholder="adb-123.4.azuredatabricks.net" /></Field>}
          </div>
          {edit.auth.type === "pat" && <Field label={t("Personal access token")}><input type="password" className="mono" value={edit.auth.token} onChange={setAuth("token")} placeholder={edit.auth.hasToken ? "••••••••" : "dapi…"} /></Field>}
          {edit.auth.type === "sp" && <div className="field-row">
            <Field label={t("Client ID")}><input className="mono" value={edit.auth.clientId} onChange={setAuth("clientId")} /></Field>
            <Field label={t("Client secret")}><input type="password" className="mono" value={edit.auth.clientSecret} onChange={setAuth("clientSecret")} placeholder={edit.auth.hasSecret ? "••••••••" : ""} /></Field>
          </div>}
          <Field label={t("SQL warehouse ID (optional — governance tags on import, tags and column comments on write-back)")}><input className="mono" value={edit.warehouseId || ""} onChange={set("warehouseId")} placeholder="1234abcd5678ef90" /></Field>
          <div className="field-row">
            <Field label={t("Data hub type")}><select value={edit.hubId} onChange={set("hubId")}>{hubs.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
            <Field label={t("Data hub (country)")}><input className="mono" value={edit.country} onChange={set("country")} placeholder="GLOBAL" /></Field>
            <Field label={t("Medallion layer")}><select value={edit.layer} onChange={set("layer")}><option value="">{t("guess from the name")}</option><option value="bronze">bronze</option><option value="silver">silver</option><option value="gold">gold</option><option value="other">other</option></select></Field>
          </div>
          <div className="field-row">
            <Field label={t("Mode")}><select value={edit.mode} onChange={set("mode")}><option value="report">{t("Report only — notify, change nothing")}</option><option value="apply">{t("Apply — import new objects and type changes")}</option></select></Field>
            <Field label={t("Schedule")}><select value={edit.schedule} onChange={set("schedule")}><option value="manual">{t("Manual")}</option><option value="hourly">{t("Hourly")}</option><option value="daily">{t("Daily")}</option></select></Field>
            {edit.schedule === "daily" && <Field label={t("Time (server local time)")}><input className="mono" type="time" value={edit.time} onChange={set("time")} /></Field>}
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 10 }}>
            <label className="check"><input type="checkbox" checked={!!edit.updateTypes} onChange={set("updateTypes")} /> {t("Update column types")}</label>
            <label className="check"><input type="checkbox" checked={!!edit.deleteMissing} onChange={set("deleteMissing")} /> {t("Delete tables and columns that disappeared from Unity Catalog")}</label>
            <label className="check"><input type="checkbox" checked={!!edit.lineage} onChange={set("lineage")} /> {t("Import table lineage")}</label>
            <label className="check"><input type="checkbox" checked={edit.importTags !== false} onChange={set("importTags")} /> {t("Import governance tags (needs the SQL warehouse ID)")}</label>
            <label className="check"><input type="checkbox" checked={!!edit.enabled} onChange={set("enabled")} /> {t("enabled")}</label>
          </div>
          <div className="panel" style={{ padding: 12, marginBottom: 10 }}>
            <label className="check" style={{ fontWeight: 600 }}><input type="checkbox" checked={!!edit.writeBack?.enabled} onChange={setWb("enabled")} /> {t("Write catalog metadata back to Unity Catalog after each run")}</label>
            <div className="modal-sub" style={{ margin: "4px 0 8px" }}>{t("Metadata only, only differences: descriptions become comments; Data Owner, Data Steward, Data Domain, Sensitivity and Classification become UC tags (needs a SQL warehouse); nothing is created or deleted. Runs with this profile's credentials — no browser needed.")}</div>
            <div className="field-row">
              <div className="modal-sub" style={{ margin: 0 }}>{t("Tags and column comments use the profile's SQL warehouse ID above.")}</div>
            </div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <label className="check"><input type="checkbox" checked={edit.writeBack?.comments !== false} onChange={setWb("comments")} /> {t("Descriptions → comments")}</label>
              <label className="check"><input type="checkbox" checked={edit.writeBack?.roles !== false} onChange={setWb("roles")} /> {t("Owner, steward, domain → tags & properties")}</label>
              <label className="check"><input type="checkbox" checked={edit.writeBack?.columns !== false} onChange={setWb("columns")} /> {t("Column comments and tags")}</label>
              <label className="check"><input type="checkbox" checked={!!edit.writeBack?.owner} onChange={setWb("owner")} /> {t("Set the UC owner (e-mail of the data owner)")}</label>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setEdit(null)}>{t("Cancel")}</button>
            <button className="btn btn-primary" onClick={save} disabled={!!busy || !edit.name.trim() || !edit.catalog.trim()}>{busy === "save" ? <Loader2 size={15} className="spin" /> : <Save size={15} />} {t("Save")}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
