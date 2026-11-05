import { useEffect, useRef, useState } from "react";
import { Upload, CheckCircle2, AlertTriangle, Loader2, X } from "lucide-react";
import { useT } from "../i18n.jsx";
import { fmtBytes } from "../lib/format.js";
import { Modal } from "./ui.jsx";
import { csrfToken, CSRF_HEADER } from "../lib/csrf.js";
import { apiGet, apiPost, ApiError } from "../lib/api.js";

const fmtN = (n) => Number(n || 0).toLocaleString();
const pct = (a, b) => b ? Math.min(100, Math.round((a / b) * 100)) : 0;

export const JOB_KINDS = {
  csv: { url: "/api/import/csv", type: "text/csv", title: "Import CSV" },
  dump: { url: "/admin/dump", type: "application/json", title: "Restore dump" },
  unity: { url: null, type: null, title: "Import from Unity Catalog" },   /* v1.66: started by the dialog, only followed here */
};

/* uploads the file with progress events and returns the job from the server. Stays on XHR on purpose (v1.72, F-F4
   exception): fetch has no upload progress, so this is the one call that does not go through lib/api.js.
   `xhrRef` (a React ref) receives the request so the dialog can abort it. */
export const uploadFile = (url, contentType, file, onProgress, xhrRef = null) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open("POST", url);
  xhr.setRequestHeader("Content-Type", contentType);
  xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
  if (csrfToken()) xhr.setRequestHeader(CSRF_HEADER, csrfToken());   /* XHR bypasses the fetch wrapper */
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded, e.total); };
  xhr.onload = () => {
    let j = {}; try { j = JSON.parse(xhr.responseText); } catch { }
    if (xhr.status >= 200 && xhr.status < 300 && j.job) resolve(j.job);
    else reject(new Error(j.error || `HTTP ${xhr.status}`));
  };
  xhr.onerror = () => reject(new Error("network error"));
  xhr.onabort = () => reject(new Error("cancelled"));
  xhr.send(file);
  if (xhrRef) xhrRef.current = xhr;
});

/* import dialog (CSV import, dump restore): upload → parsing → writing → committing → done, polled from the server
   so the browser stays responsive */
export function ImportProgressModalC({ kind = "csv", file = null, initialJob = null, fileName = "", onClose, onDone, pollMs = 1000 }) {
  const { t } = useT();
  const K = JOB_KINDS[kind] || JOB_KINDS.csv;
  const size = file ? file.size : (initialJob?.bytesTotal || 0);
  const name = file ? file.name : (fileName || initialJob?.fileName || "");
  const [up, setUp] = useState({ loaded: file ? 0 : size, total: size });
  const [job, setJob] = useState(initialJob);
  const [error, setError] = useState(null);
  const doneRef = useRef(false);
  const xhrRef = useRef(null);
  const finished = !!(error || (job && ["done", "error", "cancelled"].includes(job.status)));

  useEffect(() => {
    let stop = false, timer = null;
    (async () => {
      let j = initialJob;
      if (!j) { try { j = await uploadFile(K.url, K.type, file, (loaded, total) => setUp({ loaded, total }), xhrRef); } catch (e) { setError(e.message); return; } }
      setJob(j);
      const poll = async () => {
        if (stop) return;
        try {
          const body = await apiGet(`/api/import/jobs/${j.id}`);
          setJob(body.job);
          if (["done", "error", "cancelled"].includes(body.job.status)) { if (body.job.status === "done" && !doneRef.current) { doneRef.current = true; onDone?.(body.job); } return; }
        } catch (e) { setError(e.message); return; }
        timer = setTimeout(poll, pollMs);
      };
      poll();
    })();
    return () => { stop = true; clearTimeout(timer); };
  }, []);

  const cancel = async () => {
    if (!job) { xhrRef.current?.abort(); return; }
    try { await apiPost(`/api/import/jobs/${job.id}/cancel`); } catch (e) { setError(e instanceof ApiError ? e.body?.error : e.message); }
  };

  const phase = error ? "error" : job ? job.phase : "uploading";
  const bar = phase === "uploading" ? pct(up.loaded, up.total)
    : phase === "fetching" ? (job.counts?.schemasTotal ? pct(job.counts.schemas, job.counts.schemasTotal) : 10)
    : phase === "parsing" ? pct(job.bytesRead, job.bytesTotal)
    : phase === "diffing" ? 100
    : phase === "writing" ? pct(job.rowsWritten, job.rowsToWrite)
    : phase === "committing" ? 100
    : phase === "done" ? 100 : 0;
  const label = phase === "uploading" ? `${t("Uploading")} · ${fmtBytes(up.loaded)} / ${fmtBytes(up.total)}`
    : phase === "fetching" ? `${t("Reading the workspace")} · ${fmtN(job.counts?.schemas)} ${t("schemas")}, ${fmtN(job.counts?.tables)} ${t("tables")}`
    : phase === "parsing" ? (kind === "dump" ? t("Reading the dump") : `${t("Reading and merging rows")} · ${fmtN(job.rowsRead)} ${t("rows")} · ${bar}%`)
    : phase === "diffing" ? (kind === "unity" ? t("Comparing the workspace with the catalog") : t("Comparing the dump with the current catalog — collection by collection"))
    : phase === "writing" ? (kind === "unity" ? t("Writing to the database") : `${t("Writing to the database")} · ${fmtN(job.rowsWritten)} / ${fmtN(job.rowsToWrite)} ${t("objects")}`)
    : phase === "committing" ? `${t("Committing the transaction — the database is indexing the new rows")} · ${fmtN(job.rowsToWrite)} ${t("objects")}`
    : phase === "done" ? t("Import completed")
    : phase === "cancelled" ? t("Import cancelled") : t("Import failed");
  const color = phase === "error" || phase === "cancelled" ? "var(--red)" : phase === "done" ? "var(--green)" : "var(--accent)";
  const c = job?.counts;
  return (
    <Modal title={t(K.title)} sub={`${name} · ${fmtBytes(size)}`} onClose={finished ? onClose : () => {}}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 600, fontSize: 14 }}>
        {finished ? (phase === "done" ? <CheckCircle2 size={18} style={{ color }} /> : <AlertTriangle size={18} style={{ color }} />) : <Loader2 size={18} className="spin" />}
        <span aria-live="polite">{label}</span>
      </div>
      <div className="stat-bar" role="progressbar" aria-valuenow={bar} aria-valuemin={0} aria-valuemax={100}><div className="stat-bar-fill" style={{ width: `${bar}%`, background: color }} /></div>
      <div className="modal-sub" style={{ marginTop: 10 }}>
        {t("The import runs on the server — you can keep working in another tab; this dialog shows the progress.")}
      </div>
      {c && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          {(kind === "dump" ? [["created", "created"], ["updated", "updated"], ["deleted", "deleted"]] : [["hubs", "Data hub types"], ["databases", "Databases"], ["schemas", "Schemas"], ["tables", "Tables"], ["attributes", "Attributes"], ["domains", "Domains"], ["people", "People"]])
            .map(([k, lbl]) => c[k] ? <span key={k} className="chip chip-blue">{fmtN(c[k])} {t(lbl)}</span> : null)}
          {!c.total && <span className="chip chip-grey">{kind === "dump" ? t("Nothing changed — the dump matches the catalog") : kind === "unity" ? t("Nothing new — the catalog already matches the workspace") : t("Nothing new — every row already exists")}</span>}
          {kind === "unity" && c.tags === true && <span className="chip chip-blue">{t("governance tags")}</span>}
          {kind === "unity" && typeof c.tags === "string" && <span className="chip chip-amber" title={c.tags}>{t("tags not read")}</span>}
          {kind === "unity" && job?.profileId && <span className="chip chip-green">{t("saved as sync profile")}</span>}
        </div>
      )}
      {(job?.warnings || []).map((w, i) => <div key={i} className="notice notice-err" style={{ marginTop: 10 }}><AlertTriangle size={16} /><span>{w}</span></div>)}
      {(error || job?.error) && phase !== "cancelled" && <div className="notice notice-err" style={{ marginTop: 10 }}><AlertTriangle size={16} /><span>{error || job.error}</span></div>}
      <div className="modal-actions" style={{ marginTop: 14 }}>
        {!finished && !["diffing", "writing", "committing", "fetching"].includes(phase) && <button className="btn" onClick={cancel}><X size={14} /> {t("Cancel")}</button>}
        {finished && <button className="btn btn-primary" onClick={onClose}><Upload size={14} /> {t("Close")}</button>}
      </div>
    </Modal>
  );
}
