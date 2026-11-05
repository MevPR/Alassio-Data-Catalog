/* Registry of long-running background jobs (CSV import, dump restore, backups) that the UI polls.
   Live jobs are held in memory (their counters change many times per second) and mirrored to the `jobs` table:
   on creation, on every phase change, once a second while running and when they finish — so the history survives a
   service restart and a job that was running when the service stopped is shown as "interrupted" (v1.56). */
import crypto from "crypto";
import { q, sql } from "./db.js";

const JOB_TTL = 60 * 60000;           /* finished jobs stay in memory this long (the table keeps them longer) */
const HISTORY_KEEP = 200;             /* rows kept in the table */
const jobs = new Map();
let timer = null;

export const publicJob = (j) => ({ id: j.id, kind: j.kind, status: j.status, phase: j.phase, fileName: j.fileName, bytesTotal: j.bytesTotal, bytesRead: j.bytesRead,
  rowsRead: j.rowsRead, rowsWritten: j.rowsWritten, rowsToWrite: j.rowsToWrite, counts: j.counts, warnings: j.warnings, error: j.error,
  startedTs: j.startedTs, finishedTs: j.finishedTs, version: j.version, by: j.by, ...(j.chunks ? { chunks: j.chunks } : {}), ...(j.profileId ? { profileId: j.profileId } : {}) });
const rowOf = (j) => [j.id, j.kind, j.status, j.phase, j.fileName || null, j.by || null, JSON.stringify(j.user || null), j.startedTs, j.finishedTs, Date.now(),
  JSON.stringify({ bytesTotal: j.bytesTotal, bytesRead: j.bytesRead, rowsRead: j.rowsRead, rowsWritten: j.rowsWritten, rowsToWrite: j.rowsToWrite, counts: j.counts, warnings: j.warnings, error: j.error, version: j.version, ...(j.chunks ? { chunks: j.chunks } : {}) })];
const fromRow = (r) => { const d = typeof r.data === "string" ? JSON.parse(r.data || "{}") : (r.data || {}); return { id: r.id, kind: r.kind, status: r.status, phase: r.phase, fileName: r.file_name, by: r.by_email, startedTs: Number(r.started_at), finishedTs: r.finished_at == null ? null : Number(r.finished_at), ...d }; };

/* persistence is best effort: a failing mirror write never fails the job itself */
export const saveJob = async (j) => {
  try {
    await q(sql.upsert("jobs", ["id", "kind", "status", "phase", "file_name", "by_email", "user_json", "started_at", "finished_at", "updated_at", "data"], 1, ["id"], ["status", "phase", "finished_at", "updated_at", "data"]), rowOf(j));
    j.dirty = false;
  } catch (e) { console.error("job mirror:", e.message); }
};
const flush = async () => { for (const j of jobs.values()) if (!j.finishedTs || j.dirty) await saveJob(j); };
/* graceful shutdown: every live job is marked interrupted and the mirror is flushed before the process exits */
export const shutdownJobs = async (reason = "the service was stopped while this job was running") => {
  if (timer) { clearInterval(timer); timer = null; }
  for (const j of jobs.values()) if (!j.finishedTs) { j.status = "interrupted"; j.phase = "interrupted"; j.error = reason; j.finishedTs = Date.now(); j.cancelled = true; j.dirty = true; }
  await flush();
};
export const liveJobCount = () => [...jobs.values()].filter((j) => !j.finishedTs).length;
export const cleanupJobs = () => { const now = Date.now(); for (const [id, j] of jobs) if (j.finishedTs && !j.dirty && now - j.finishedTs > JOB_TTL) jobs.delete(id); };

export const newJob = (kind, user, fileName, extra = {}) => {
  cleanupJobs();
  const id = crypto.randomUUID();
  const job = { id, kind, status: "uploading", phase: "uploading", fileName, bytesTotal: 0, bytesRead: 0, rowsRead: 0, rowsWritten: 0, rowsToWrite: 0, counts: null, warnings: [], error: null,
    startedTs: Date.now(), finishedTs: null, version: null, by: user.email, user: { id: user.id, name: user.name, email: user.email }, cancelled: false, dirty: true, ...extra };
  jobs.set(id, job);
  saveJob(job);
  return job;
};
export const setPhase = (job, phase) => { job.phase = phase; if (job.status === "uploading" && phase !== "uploading") job.status = "running"; saveJob(job); };
export const getJob = (id) => jobs.get(id) || null;
export const getJobAsync = async (id) => {
  if (jobs.has(id)) return jobs.get(id);
  const rows = await q("SELECT * FROM jobs WHERE id = ?", [id]).catch(() => []);
  return rows.length ? fromRow(rows[0]) : null;
};
/* history: live jobs first, then the table (newest first) */
export const listJobs = async (limit = 50) => {
  cleanupJobs();
  const live = [...jobs.values()].map(publicJob);
  const seen = new Set(live.map((j) => j.id));
  const rows = await q("SELECT * FROM jobs ORDER BY started_at DESC LIMIT ?", [limit]).catch(() => []);
  return [...live, ...rows.map(fromRow).filter((j) => !seen.has(j.id))].sort((a, b) => b.startedTs - a.startedTs).slice(0, limit);
};
export const finishJob = (job, status, error = null) => { job.status = status; job.phase = status; job.error = error; job.finishedTs = Date.now(); job.dirty = true; saveJob(job); };

/* at start-up: jobs that were still running belong to a process that no longer exists */
export const recoverJobs = async () => {
  try {
    const r = await q(`UPDATE jobs SET status = 'interrupted', phase = 'interrupted', finished_at = ?, updated_at = ?, data = ${sql.jsonSetText("data", "error")} WHERE finished_at IS NULL`, [Date.now(), Date.now(), "the service was restarted while this job was running"]);
    if (r.affectedRows) console.log(`Marked ${r.affectedRows} interrupted job(s) from the previous run`);
    await q(`DELETE FROM jobs WHERE id NOT IN (SELECT id FROM (SELECT id FROM jobs ORDER BY started_at DESC LIMIT ${HISTORY_KEEP}) AS keep)`);
  } catch (e) { console.error("job recovery:", e.message); }
  if (!timer) { timer = setInterval(() => flush().catch(() => {}), 1000); timer.unref(); }
};
export const stopJobTimer = () => { if (timer) clearInterval(timer); timer = null; };
