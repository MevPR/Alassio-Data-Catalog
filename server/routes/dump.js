/* /admin/dump — full dump (GET, streamed JSON) and restore (POST, streamed upload → background job with progress).
   Mounted before express.json: the restore body is written to a temp file, never parsed by the body parser.
   v1.70: the dump / restore logic lives in server/dump.js; this module only parses the request and answers. */
import { Router } from "express";
import fs from "fs";
import { q } from "../db.js";
import { ah, requireRole } from "../auth.js";
import { sysAudit } from "../audit.js";
import { newJob, publicJob, finishJob } from "../jobs.js";
import { streamToFile, tmpPathFor } from "../upload.js";
import { runRestore, writeDumpTo, dumpSource } from "../dump.js";

export function dumpRoutes() {
  const r = Router();
  r.get("/admin/dump", requireRole("admin"), ah(async (req, res) => {
    await sysAudit(req.user, "system", "exported", "full dump");
    const { catalog, version, attributes } = await dumpSource();
    const users = await q("SELECT id,name,email,role,totp_enabled FROM users");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=alassio-catalog-dump.json");
    /* streamed per collection and per table so a 100 MB dump never becomes one string — or one document — in memory */
    await writeDumpTo(res, { catalog, version, users, attributes });
    res.end();
  }));
  /* restore: raw dump body streamed to a temp file → background job; the client polls /api/import/jobs/:id */
  r.post("/admin/dump", requireRole("admin"), ah(async (req, res) => {
    const fileName = decodeURIComponent(String(req.headers["x-file-name"] || "dump.json")).slice(0, 200);
    const job = newJob("dump", req.user, fileName);
    job.tmpPath = tmpPathFor(job.id, "json");
    try { job.bytesTotal = await streamToFile(req, job.tmpPath); }
    catch (e) { finishJob(job, "error", e.message); fs.promises.unlink(job.tmpPath).catch(() => {}); return res.status(e.status || 400).json({ error: e.message, job: publicJob(job) }); }
    runRestore(job);
    res.json({ job: publicJob(job) });
  }));
  return r;
}
