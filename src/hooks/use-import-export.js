/* Import / export actions (v1.69 — extracted from App.jsx): streamed CSV / OKF exports, the server-side import jobs
   (CSV, Unity Catalog, dump restore) and the server-side bundle / source loads. The dialogs are opened through
   setModal(); every import ends with reloadCatalog(). */
import { useT } from "../i18n.jsx";
import { fill } from "../lib/i18n-format.js";
import { apiPost } from "../lib/api.js";
import { submitDownload } from "../lib/download.js";
import { recordExport } from "../lib/usage.js";

export function useImportExport({ setModal, reloadCatalog, flash }) {
  const { t } = useT();
  /* optional sentence parts of a toast, each translated on its own and joined with " · " (v1.70) */
  const tail = (...parts) => parts.filter(Boolean).map((x) => ` · ${x}`).join("");
  /* CSV and OKF exports are rendered and streamed by the server; a hidden form submit lets the browser download
     natively (no file in JavaScript memory, works for hundreds of thousands of attributes) */
  const downloadExport = (kind, selTbIds = null, selScIds = [], selDbIds = []) => {
    submitDownload(`/api/export/${kind}`, { selection: JSON.stringify({ tableIds: selTbIds, schemaIds: selScIds, databaseIds: selDbIds }) });
    for (const id of (selTbIds || []).slice(0, 50)) recordExport("table", id, kind);
    if (!selTbIds?.length) recordExport(null, null, kind);
    flash(kind === "csv" ? "CSV export started — the download begins in a moment" : "OKF bundle export started — the download begins in a moment");
  };
  /* CSV import runs on the server as a job (large files); the dialog shows the progress and reloads the catalog when done */
  const importCsv = (file) => setModal({ kind: "importcsv", file });
  const importCsvDone = async (job) => {
    await reloadCatalog();
    const c = job.counts || {};
    if (c.total) flash("CSV imported — {n} new objects ({attributes} attributes)", { n: c.total.toLocaleString(), attributes: c.attributes || 0 }); else flash("CSV imported — nothing new, every row already existed");
  };
  /* Unity Catalog import (v1.66): runs on the server as a job — the dialog hands over the job, the progress dialog follows it */
  const importUnityStarted = (job, catalogName) => setModal({ kind: "unityjob", job, fileName: catalogName });
  const importUnityDone = async (job) => {
    await reloadCatalog();
    const c = job.counts || {};
    flash("Imported catalog \"{name}\" from Unity Catalog — {n} change(s){tail}", { name: job.fileName?.split(" · ").pop() || "", n: (c.total || 0).toLocaleString(), tail: tail(c.tags === true && t("incl. governance tags"), job.profileId && t("saved as sync profile")) });
  };
  /* bundle and source imports (v1.66): applied on the server — Power BI results, dbt manifests and data contracts
     (parsed there), generic source loads; the browser reloads the catalog afterwards */
  const postImport = async (url, body) => { const j = await apiPost(url, body); await reloadCatalog(); return j; };
  const importBundle = async ({ hubId = "source", country = "GLOBAL", layer = "", sourceType, databases = [], lineage = [], sourceRef = null, server = null }) => {
    const j = server ? await postImport("/api/import/bundle", { ...server, hubId, country, layer }) : await postImport("/api/import/bundle/apply", { hubId, country, layer, sourceType, databases, lineage, sourceRef });
    const c = j.counts || {};
    flash("Loaded {databases} database(s) / {tables} tables from {source}{tail}", { databases: c.databases || 0, tables: (c.tables || 0).toLocaleString(), source: server ? (server.kind === "dbt" ? "dbt" : t("data contracts")) : sourceType,
      tail: tail(c.lineage && fill(t("{n} lineage edges"), { n: c.lineage.toLocaleString() }), j.applied ? fill(t("{n} change(s)"), { n: j.applied.toLocaleString() }) : t("nothing new")) });
    setModal(null);
  };
  const importExternal = async (dbName, sourceType, schemasPayload, country = "GLOBAL", sourceRef = null) => {
    const j = await postImport("/api/import/external", { dbName, sourceType, schemasPayload, country, sourceRef });
    flash(j.applied ? "Loaded \"{name}\" from {source} into the SOURCE hub · {n} change(s)" : "Loaded \"{name}\" from {source} into the SOURCE hub · nothing new", { name: dbName, source: sourceType, n: (j.applied || 0).toLocaleString() });
    setModal(null);
  };
  const exportDump = () => { submitDownload("/admin/dump"); flash("Full dump export started"); };
  /* dump restore runs on the server as a job (same dialog as the CSV import) */
  const importDump = (file) => setModal({ kind: "importdump", file });
  const importDumpDone = async (job) => {
    await reloadCatalog();
    flash("Dump restored — catalog replaced ({n} record changes)", { n: (job.counts?.total || 0).toLocaleString() });
  };
  return { downloadExport, importCsv, importCsvDone, importUnityStarted, importUnityDone, importBundle, importExternal, exportDump, importDump, importDumpDone };
}
