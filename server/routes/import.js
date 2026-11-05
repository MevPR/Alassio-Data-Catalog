/* /api/import/csv — server-side CSV import as a background job with progress.
   The browser streams the file to a temp file (seconds), gets a job id back and polls /api/import/jobs/:id.
   The job (server/csv-import-job.js since v1.73) parses the file as a stream, merges the rows into the catalog and
   writes the new rows in one transaction per chunk. */
import { Router } from "express";
import fs from "fs";
import { ah, requireRole } from "../auth.js";
import { newJob, getJob, getJobAsync, listJobs, publicJob, finishJob } from "../jobs.js";
import { runCsvImportJob } from "../csv-import-job.js";
import { streamToFile, tmpPathFor } from "../upload.js";
import { applyExternal, applyBundle, parseBundle, unityCatalogs, startUnityImport } from "../catalog-import.js";
import { syncProfiles } from "../sync-profiles.js";

export function importRoutes() {
  const r = Router();
  /* upload: raw CSV body (Content-Type text/csv), streamed to a temp file; answers with the job id */
  r.post("/api/import/csv", requireRole("admin"), ah(async (req, res) => {
    const fileName = decodeURIComponent(String(req.headers["x-file-name"] || "import.csv")).slice(0, 200);
    const job = newJob("csv", req.user, fileName);
    job.tmpPath = tmpPathFor(job.id, "csv");
    try { job.bytesTotal = await streamToFile(req, job.tmpPath); }
    catch (e) { finishJob(job, "error", e.message); fs.promises.unlink(job.tmpPath).catch(() => {}); return res.status(e.status || 400).json({ error: e.message, job: publicJob(job) }); }
    runCsvImportJob(job);      /* runs in the background — the client polls (server/csv-import-job.js) */
    res.json({ job: publicJob(job) });
  }));
  /* v1.66: imports that used to be computed in the browser now land here */
  /* generic source load (inspector / native connectors): the schemas payload is applied on the server */
  r.post("/api/import/external", requireRole("admin"), ah(async (req, res) => {
    const b = req.body || {};
    if (!b.dbName || !Array.isArray(b.schemasPayload)) return res.status(400).json({ error: "dbName and schemasPayload[] are required" });
    res.json(await applyExternal(req.user, { dbName: String(b.dbName).slice(0, 200), sourceType: String(b.sourceType || "Source").slice(0, 60), schemasPayload: b.schemasPayload, country: b.country, sourceRef: b.sourceRef || null }));
  }));
  /* bundle apply (Power BI result of /api/source-import/inspect) */
  r.post("/api/import/bundle/apply", requireRole("admin"), ah(async (req, res) => {
    const b = req.body || {};
    if (!Array.isArray(b.databases)) return res.status(400).json({ error: "databases[] required" });
    res.json(await applyBundle(req.user, { hubId: b.hubId, country: b.country, layer: b.layer, sourceType: String(b.sourceType || "Bundle").slice(0, 60), databases: b.databases, lineage: Array.isArray(b.lineage) ? b.lineage : [], sourceRef: b.sourceRef || null }));
  }));
  /* dbt manifest / ODCS contracts: parsed and applied on the server (manifests can be large — own body limit) */
  r.post("/api/import/bundle", requireRole("admin"), ah(async (req, res) => {
    const b = req.body || {};
    const parsed = parseBundle({ kind: b.kind, manifest: b.manifest, catalog: b.catalog || null, contracts: Array.isArray(b.contracts) ? b.contracts : [], fileName: String(b.fileName || "").slice(0, 200) });
    if (!parsed.databases.length) return res.status(400).json({ error: "The file contains no tables" });
    res.json(await applyBundle(req.user, { hubId: b.hubId, country: b.country, layer: b.layer, sourceType: parsed.sourceType, databases: parsed.databases, lineage: parsed.lineage, sourceRef: { ...parsed.sourceRef, type: b.type || parsed.sourceRef.kind } }));
  }));
  /* one-off Unity Catalog import: list the catalogs a connection can see, then run the import as a job */
  const savedProfile = async (b) => (b?.profileId ? (await syncProfiles()).find((p) => p.id === b.profileId) || null : null);
  r.post("/api/import/unity/catalogs", requireRole("admin"), ah(async (req, res) => {
    const saved = await savedProfile(req.body); if (req.body?.profileId && !saved) return res.status(404).json({ error: "Unknown sync profile" });
    res.json({ catalogs: await unityCatalogs(req.body || {}, saved) });   /* Databricks failures carry status 502 (listUnityCatalogs) */
  }));
  r.post("/api/import/unity", requireRole("admin"), ah(async (req, res) => {
    const saved = await savedProfile(req.body); if (req.body?.profileId && !saved) return res.status(404).json({ error: "Unknown sync profile" });
    res.json({ job: publicJob(startUnityImport(req.user, req.body || {}, saved)) });
  }));
  r.get("/api/import/jobs", requireRole("admin"), ah(async (req, res) => res.json({ jobs: await listJobs(Math.min(Number(req.query.limit) || 50, 200)) })));
  r.get("/api/import/jobs/:id", requireRole("admin"), ah(async (req, res) => {
    const j = await getJobAsync(req.params.id);   /* live job, or its mirrored row after a restart */
    if (!j) return res.status(404).json({ error: "Unknown import job" });
    res.json({ job: publicJob(j) });
  }));
  r.post("/api/import/jobs/:id/cancel", requireRole("admin"), (req, res) => {
    const j = getJob(req.params.id);
    if (!j) return res.status(404).json({ error: "Unknown import job" });
    if (j.finishedTs) return res.json({ job: publicJob(j) });
    if (j.phase === "writing" || j.phase === "committing") return res.status(409).json({ error: "The rows are being written — the import can no longer be cancelled" });
    j.cancelled = true;
    res.json({ job: publicJob(j) });
  });
  return r;
}
