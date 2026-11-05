import React, { useEffect, useState } from "react";
import { Archive, CheckCircle2, AlertTriangle, Loader2, Download, RotateCcw, Trash2, ShieldCheck, Save, Play, History } from "lucide-react";
import { useT } from "../i18n.jsx";
import { fmtBytes, fmtTs } from "../lib/format.js";
import { apiGetOr } from "../lib/api.js";
import { useApiCall } from "../hooks/use-api-call.js";
import { Field } from "./ui.jsx";
import { SyncProfilesC } from "./sync-profiles.jsx";

const fmtDur = (a, b) => (a && b) ? `${Math.max(0, Math.round((b - a) / 1000))} s` : "—";
const JOB_STATUS_COLOR = { done: "chip-green", error: "chip-red", interrupted: "chip-red", cancelled: "chip-grey", running: "chip-blue", uploading: "chip-blue" };

/* Admin › Backups & jobs: scheduled backups with retention, on-demand backups, restore drills, restore, and the
   history of background jobs (mirrored to the database, so it survives service restarts). */
export function BackupsViewC({ onRestoreJob }) {
  const { t } = useT();
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [confirmId, setConfirmId] = useState(null);
  const [open, setOpen] = useState(null);

  const load = async () => {
    const [j, j2] = await Promise.all([apiGetOr("/admin/backups"), apiGetOr("/api/import/jobs?limit=50")]);
    if (j) { setData(j); setSettings((s) => s || j.settings); }
    if (j2) setJobs(j2.jobs || []);
  };
  useEffect(() => { load(); }, []);

  const { busy, call } = useApiCall(load);
  const saveSettings = () => call("settings", "/admin/backups/settings", { method: "PUT", body: settings }, "Backup settings saved");
  const backupNow = () => call("now", "/admin/backups", { method: "POST" }, (j) => `Backup written: ${j.backup.fileName}${j.backup.sqlFile ? " + SQL dump" : ""}${j.backup.warning ? ` — ${j.backup.warning}` : ""}`);
  const verify = (b) => call(`verify-${b.id}`, `/admin/backups/${b.id}/verify`, { method: "POST" }, (j) => j.backup.verify.ok ? `Restore drill passed for ${b.fileName}` : `Restore drill FAILED for ${b.fileName}`);
  const restore = async (b) => { setConfirmId(null); const j = await call(`restore-${b.id}`, `/admin/backups/${b.id}/restore`, { method: "POST" }); if (j?.job) onRestoreJob(j.job, b.fileName); };
  const remove = (b) => call(`del-${b.id}`, `/admin/backups/${b.id}`, { method: "DELETE" }, "Backup deleted");
  const download = (b, sql) => { const a = document.createElement("a"); a.href = `/admin/backups/${b.id}/download${sql ? "?sql=1" : ""}`; a.download = sql ? b.sqlFile : b.fileName; document.body.appendChild(a); a.click(); a.remove(); };

  const s = settings || {};
  return (
    <>
      <div className="entity-head">
        <div className="entity-icon" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}><Archive size={22} /></div>
        <div>
          <h1 className="entity-title">{t("Backups & jobs")}</h1>
          <div className="entity-sub">{t("Daily catalog backups with retention, restore drills and the history of imports, restores and backups. Files are written on the server")}{data?.dir ? ` (${data.dir})` : ""}.</div>
        </div>
        <div className="head-actions">
          <button className="btn btn-primary" onClick={backupNow} disabled={!!busy}>{busy === "now" ? <Loader2 size={15} className="spin" /> : <Play size={15} />} {t("Back up now")}</button>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 18, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}><ShieldCheck size={17} /> {t("Schedule")}</h3>
        <div className="field-row" style={{ alignItems: "end" }}>
          <Field label={t("Automatic daily backup")}>
            <label className="check"><input type="checkbox" checked={!!s.enabled} onChange={(e) => setSettings({ ...s, enabled: e.target.checked })} /> {s.enabled ? t("enabled") : t("disabled")}</label>
          </Field>
          <Field label={t("Time (server local time)")}><input className="mono" type="time" value={s.time || "02:30"} onChange={(e) => setSettings({ ...s, time: e.target.value })} /></Field>
          <Field label={t("Keep automatic backups")}><input className="mono" type="number" min={1} max={365} value={s.keep ?? 14} onChange={(e) => setSettings({ ...s, keep: Number(e.target.value) })} /></Field>
          <Field label={t("Full SQL dump (mysqldump)").replace("mysqldump", data?.sqlTool || "mysqldump")}>
            <label className="check"><input type="checkbox" checked={!!s.sql} disabled={data && !data.mysqldump} onChange={(e) => setSettings({ ...s, sql: e.target.checked })} /> {data && !data.mysqldump ? t("mysqldump not installed on the server") : t("also dump users, sessions, requests, messages and audit")}</label>
          </Field>
          <button className="btn" onClick={saveSettings} disabled={!!busy || !settings}>{busy === "settings" ? <Loader2 size={15} className="spin" /> : <Save size={15} />} {t("Save")}</button>
        </div>
        <div className="modal-sub">{t("Each backup is the catalog dump (gzip) — restorable from this page or via Admin › Restore. The SQL dump is the complete database for disaster recovery (restore with mysql < file). Run a restore drill regularly: it re-reads the file, checks its integrity and compares the record counts with the live catalog.")}</div>
      </div>

      <div className="panel" style={{ marginTop: 18, padding: 0 }}>
        <table className="attrs" style={{ border: 0 }}>
          <thead><tr><th scope="col">{t("Created")}</th><th scope="col">{t("Kind")}</th><th scope="col">{t("Files")}</th><th scope="col">{t("Catalog")}</th><th scope="col">{t("Restore drill")}</th><th scope="col">{t("By")}</th><th scope="col"></th></tr></thead>
          <tbody>
            {(data?.backups || []).map((b) => (
              <React.Fragment key={b.id}>
                <tr>
                  <td className="mono">{fmtTs(b.createdAt)}</td>
                  <td><span className={`chip ${b.kind === "auto" ? "chip-blue" : "chip-grey"}`}>{b.kind}</span></td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    <div>{b.fileName} · {fmtBytes(b.size)}</div>
                    {b.sqlFile && <div style={{ color: "var(--muted)" }}>{b.sqlFile} · {fmtBytes(b.sqlSize)}</div>}
                  </td>
                  <td style={{ fontSize: 12 }}>v{b.catalogVersion}{b.counts ? ` · ${Number(b.counts.tables || 0).toLocaleString()} ${t("tables")}, ${Number(b.counts.attributes || 0).toLocaleString()} ${t("attributes")}` : ""}</td>
                  <td>
                    {b.verify ? (
                      <button className="btn btn-sm" onClick={() => setOpen(open === b.id ? null : b.id)} title={t("Show details")}>
                        {b.verify.ok ? <CheckCircle2 size={14} style={{ color: "var(--green)" }} /> : <AlertTriangle size={14} style={{ color: "var(--brand)" }} />} {b.verify.ok ? t("passed") : t("failed")} · {fmtTs(b.verifiedAt)}
                      </button>
                    ) : <span style={{ color: "var(--muted)", fontSize: 12 }}>{t("not verified yet")}</span>}
                  </td>
                  <td style={{ fontSize: 12 }}>{b.by}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn btn-sm" onClick={() => verify(b)} disabled={!!busy} title={t("Restore drill: read, check and compare with the live catalog")}>{busy === `verify-${b.id}` ? <Loader2 size={13} className="spin" /> : <ShieldCheck size={13} />} {t("Verify")}</button>{" "}
                    {confirmId === b.id
                      ? <><button className="btn btn-sm btn-primary" onClick={() => restore(b)}>{t("Really restore?")}</button>{" "}<button className="btn btn-sm" onClick={() => setConfirmId(null)}>{t("No")}</button></>
                      : <button className="btn btn-sm" onClick={() => setConfirmId(b.id)} disabled={!!busy} title={t("Replace the live catalog with this backup (audited)")}><RotateCcw size={13} /> {t("Restore")}</button>}{" "}
                    <button className="btn btn-sm" onClick={() => download(b, false)} title={t("Download catalog dump")}><Download size={13} /> JSON</button>{" "}
                    {b.sqlFile && <><button className="btn btn-sm" onClick={() => download(b, true)} title={t("Download SQL dump")}><Download size={13} /> SQL</button>{" "}</>}
                    <button className="btn btn-sm" onClick={() => remove(b)} disabled={!!busy} title={t("Delete backup files")}><Trash2 size={13} /></button>
                  </td>
                </tr>
                {open === b.id && b.verify && (
                  <tr><td colSpan={7} style={{ background: "var(--bg)", fontSize: 12 }}>
                    {(b.verify.checks || []).map((c) => <div key={c.name} style={{ display: "flex", gap: 8, alignItems: "center", padding: "2px 0" }}>{c.ok ? <CheckCircle2 size={13} style={{ color: "var(--green)" }} /> : <AlertTriangle size={13} style={{ color: "var(--brand)" }} />}<b>{c.name}</b> {c.detail}</div>)}
                    {b.verify.counts && <div style={{ marginTop: 6, color: "var(--muted)" }}>{t("Backup")}: {Object.entries(b.verify.counts).map(([k, v]) => `${k} ${v}`).join(" · ")}</div>}
                    {b.verify.live && <div style={{ color: "var(--muted)" }}>{t("Live")}: {Object.entries(b.verify.live).map(([k, v]) => `${k} ${v}`).join(" · ")}</div>}
                  </td></tr>
                )}
              </React.Fragment>
            ))}
            {data && !data.backups.length && <tr><td colSpan={7} style={{ color: "var(--muted)", padding: 20 }}>{t("No backups yet — enable the schedule or click “Back up now”.")}</td></tr>}
          </tbody>
        </table>
      </div>

      <SyncProfilesC />
      <div className="panel" style={{ marginTop: 18, padding: 0 }}>
        <div style={{ padding: "12px 16px 0" }}><h3 style={{ margin: 0 }}><History size={17} /> {t("Recent jobs")}</h3><div className="modal-sub">{t("Imports, restores and their outcome. Jobs are mirrored to the database, so this list survives a service restart — a job that was running at that moment is shown as interrupted.")}</div></div>
        <table className="attrs" style={{ border: 0, marginTop: 8 }}>
          <thead><tr><th scope="col">{t("Started")}</th><th scope="col">{t("Kind")}</th><th scope="col">{t("File")}</th><th scope="col">{t("Status")}</th><th scope="col">{t("Duration")}</th><th scope="col">{t("Result")}</th><th scope="col">{t("By")}</th></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td className="mono">{fmtTs(j.startedTs)}</td>
                <td>{j.kind}</td>
                <td className="mono" style={{ fontSize: 12 }}>{j.fileName}</td>
                <td><span className={`chip ${JOB_STATUS_COLOR[j.status] || "chip-grey"}`}>{j.status}{!j.finishedTs && j.phase && j.phase !== j.status ? ` · ${j.phase}` : ""}</span></td>
                <td className="mono">{fmtDur(j.startedTs, j.finishedTs)}</td>
                <td style={{ fontSize: 12 }}>{j.error ? <span style={{ color: "var(--red)" }}>{j.error}</span> : j.counts ? Object.entries(j.counts).filter(([k, v]) => v && k !== "total").map(([k, v]) => `${Number(v).toLocaleString()} ${k}`).join(", ") || t("nothing changed") : ""}</td>
                <td style={{ fontSize: 12 }}>{j.by}</td>
              </tr>
            ))}
            {!jobs.length && <tr><td colSpan={7} style={{ color: "var(--muted)", padding: 20 }}>{t("No jobs yet.")}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
