/* Write back to Unity Catalog (v1.77): the preview-first dialog for every signed-in user. Changes belong to the user
   who made them — the preview lists the caller's own pending changes (and, for admins, the ones without a recorded
   author), names how many belong to which other user, and only then offers to write. Changes by other users are
   never written here; those users write them back themselves. The profile's credentials stay on the server. */
import { useEffect, useState } from "react";
import { UploadCloud, Loader2, CheckCircle2, AlertTriangle, Users, Clock } from "lucide-react";
import { useT } from "../i18n.jsx";
import { useToast } from "../toast-context.jsx";
import { apiGet, apiPost, errorText } from "../lib/api.js";
import { fmtTs } from "../lib/format.js";
import { Field, Modal } from "./ui.jsx";

export function WriteBackModalC({ profileId = null, isAdmin = false, onClose, onWritten = null }) {
  const { t, tn } = useT();
  const { flash } = useToast();
  const [targets, setTargets] = useState(null);
  const [target, setTarget] = useState(profileId || "");
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(null);   /* "preview" | "run" | null */
  const [err, setErr] = useState(null);

  useEffect(() => {
    let live = true;
    apiGet("/api/writeback/targets").then((j) => { if (!live) return; setTargets(j.targets || []); if (!profileId && j.targets?.length) setTarget(j.targets[0].id); }, (e) => live && setErr(errorText(e)));
    return () => { live = false; };
  }, [profileId]);

  useEffect(() => {
    if (!target) return;
    let live = true;
    setPreview(null); setResult(null); setErr(null); setBusy("preview");
    apiPost(`/api/writeback/${encodeURIComponent(target)}/preview`, {}).then((j) => { if (live) setPreview(j.result); }, (e) => live && setErr(errorText(e))).finally(() => live && setBusy(null));
    return () => { live = false; };
  }, [target]);

  const run = async () => {
    setBusy("run"); setErr(null);
    try {
      const j = await apiPost(`/api/writeback/${encodeURIComponent(target)}/run`, {});
      setResult(j.result);
      flash(j.result.failed ? "{n} change(s) written to Unity Catalog, {f} failed" : "{n} change(s) written to Unity Catalog", { n: j.result.written, f: j.result.failed });
      onWritten?.(j.result);
    } catch (e) { setErr(errorText(e)); }
    setBusy(null);
  };

  const cur = targets?.find((x) => x.id === target);
  const mine = preview?.log?.filter((l) => l.mine) || [];
  const others = preview?.pending?.others || [];
  const unattributed = preview?.pending?.unattributed || 0;
  const writable = preview?.pending?.writable || 0;
  return (
    <Modal title={t("Write back to Unity Catalog")} sub={t("Your changes to descriptions, owners, stewards, domains, sensitivity and classification are written to Unity Catalog as comments, tags and properties. Only what differs is written.")} onClose={onClose} wide className="modal-writeback">
      {err && <div className="notice notice-err"><AlertTriangle size={16} style={{ flexShrink: 0 }} /><span>{err}</span></div>}
      {targets && !targets.length && <div className="notice"><span>{t("No Unity Catalog connection is set up yet — an administrator creates one under Admin › Backups & jobs › Unity Catalog sync.")}</span></div>}
      {targets?.length > 1 && (
        <Field label={t("Unity Catalog")}>
          <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={!!busy}>{targets.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.catalog}{x.host ? ` · ${x.host}` : ""}</option>)}</select>
        </Field>
      )}
      {targets?.length === 1 && cur && <div className="modal-sub" style={{ marginBottom: 8 }}>{cur.name} · {cur.catalog}{cur.host ? ` · ${cur.host}` : ""}</div>}
      {cur?.lastWriteBack && <div className="modal-sub" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}><Clock size={12} /> {t("Last write-back")} {fmtTs(cur.lastWriteBack.at)}</div>}
      {busy === "preview" && <div className="modal-sub" style={{ display: "flex", alignItems: "center", gap: 8 }}><Loader2 size={14} className="spin" /> {t("Comparing the catalog with Unity Catalog…")}</div>}
      {preview && !result && (
        <>
          {preview.error && <div className="notice notice-err"><AlertTriangle size={16} style={{ flexShrink: 0 }} /><span>{preview.error}</span></div>}
          <h4 style={{ margin: "10px 0 4px" }}>{isAdmin && unattributed ? t("Your changes and changes without a recorded author") : t("Your changes")} <span className="chip chip-brand">{writable}</span></h4>
          {!writable && <div className="modal-sub">{t("Nothing to write — none of the pending differences were made by you.")}</div>}
          {writable > 0 && (
            <div className="panel" style={{ padding: "6px 10px", maxHeight: 240, overflow: "auto" }} data-testid="wb-mine">
              {mine.map((l, i) => <div key={i} className="role-row" style={{ padding: "4px 0", fontSize: 13 }}><span className="mono" style={{ flex: 1 }}>{l.label}</span>{!l.author && <span className="chip chip-grey">{t("no recorded author")}</span>}</div>)}
            </div>
          )}
          {(others.length > 0 || (!isAdmin && unattributed > 0)) && (
            <>
              <h4 style={{ margin: "14px 0 4px", display: "flex", alignItems: "center", gap: 6 }}><Users size={14} /> {t("Changes by other users")} <span className="chip chip-grey">{others.reduce((n, o) => n + o.count, 0) + (!isAdmin ? unattributed : 0)}</span></h4>
              <div className="modal-sub" style={{ marginBottom: 4 }}>{t("Each user writes their own changes back to Unity Catalog; these are not written for them.")}</div>
              <div className="panel" style={{ padding: "6px 10px" }} data-testid="wb-others">
                {others.map((o) => <div key={o.id} className="role-row" style={{ padding: "4px 0", fontSize: 13 }}><span style={{ flex: 1 }}>{o.name}</span><span className="chip chip-grey">{tn(["{n} change", "{n} changes"], o.count)}</span></div>)}
                {!isAdmin && unattributed > 0 && <div className="role-row" style={{ padding: "4px 0", fontSize: 13 }}><span style={{ flex: 1 }}>{t("Without recorded author (an administrator writes these)")}</span><span className="chip chip-grey">{tn(["{n} change", "{n} changes"], unattributed)}</span></div>}
              </div>
            </>
          )}
          {preview.skipped > 0 && <div className="modal-sub" style={{ marginTop: 8 }}>{preview.skipped} {t("skipped (no SQL warehouse)")}</div>}
          {preview.tagsReadable === false && !preview.skipped && <div className="modal-sub" style={{ marginTop: 8 }}>{t("tags skipped (no SQL warehouse)")}</div>}
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>{t("Cancel")}</button>
            <button className="btn btn-primary" disabled={!!busy || !writable || !!preview.error} onClick={run} data-testid="wb-run" data-autofocus="">
              {busy === "run" ? <Loader2 size={15} className="spin" /> : <UploadCloud size={15} />} {tn(["Write {n} change back", "Write {n} changes back"], writable)}
            </button>
          </div>
        </>
      )}
      {result && (
        <>
          <div className={`notice ${result.ok ? "notice-ok" : "notice-err"}`} style={{ display: "block" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{result.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}<span>{result.error ? result.error : `${result.written} / ${result.total} ${t("change(s) written to Unity Catalog")}${result.failed ? `, ${result.failed} ${t("failed")}` : ""}`}</span></div>
            {result.log?.some((l) => !l.ok) && <div className="mono" style={{ fontSize: 11.5, whiteSpace: "pre-wrap", marginTop: 6 }}>{result.log.filter((l) => !l.ok).map((l) => `✗ ${l.label}`).join("\n")}</div>}
          </div>
          <div className="modal-actions"><button className="btn btn-primary" onClick={onClose} data-autofocus="">{t("Done")}</button></div>
        </>
      )}
    </Modal>
  );
}
