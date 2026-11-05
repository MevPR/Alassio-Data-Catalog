/* Operations endpoints (v1.59, PLAN.md item 4):
     GET  /healthz                      liveness + readiness for monitors and platform health checks (no auth)
     GET  /admin/tasks                  the scheduled tasks, their last runs and whether the in-process scheduler runs
     POST /admin/tasks/:name/run        run one task now (backup | stewardship-reminders | usage-purge | uc-sync | uc-writeback | housekeeping)
   SCHEDULER=internal (default) keeps the in-process timers; SCHEDULER=external disables them so a platform
   scheduler (cron, a Databricks Job, Kubernetes CronJob) drives the tasks through this endpoint — either with an
   admin session or with the bearer token TASKS_TOKEN. v1.70: the task table and the runner live in server/tasks.js
   (assembled by server.js); this module authenticates and answers. */
import { safeEqual } from "../security.js";
import { Router } from "express";
import { q, DRIVER } from "../db.js";
import { ah } from "../auth.js";
import { hasRole } from "../config.js";
import { storageInfo } from "../backup.js";
import { liveJobCount } from "../jobs.js";
import { identityInfo } from "../identity.js";
import { SCHEDULER, listTasks, runTask } from "../tasks.js";

/* the TASKS_TOKEN candidate of a request: the X-Tasks-Token header (used when Authorization is taken by an
   authenticating platform such as Databricks Apps, v1.61), otherwise the Authorization bearer (v1.72: one parser) */
const bearerOf = (req) => String(req.headers["x-tasks-token"] || req.headers.authorization || "").replace(/^Bearer\s+/i, "");
const tasksTokenOk = (req) => { const bearer = bearerOf(req); return !!(process.env.TASKS_TOKEN && bearer && safeEqual(bearer, process.env.TASKS_TOKEN)); };

export function opsRoutes({ appVersion }) {
  const r = Router();
  const startedAt = Date.now();
  r.get("/healthz", ah(async (req, res) => {
    const t0 = Date.now();
    let db;
    try { const [m] = await q("SELECT version FROM catalog_meta WHERE id = 1"); db = { ok: true, driver: DRIVER, catalogVersion: m ? Number(m.version) : 0, ms: Date.now() - t0 }; }
    catch (e) { db = { ok: false, driver: DRIVER, error: e.message }; }
    const body = { ok: db.ok, status: db.ok ? "ready" : "degraded", version: appVersion, uptimeS: Math.round((Date.now() - startedAt) / 1000), db, jobs: { live: liveJobCount() }, scheduler: SCHEDULER, identity: identityInfo().mode, storage: storageInfo().provider, memoryMb: Math.round(process.memoryUsage().rss / 1048576) };
    /* v1.66.1: anonymous callers get readiness and version only; the details go to admins, the TASKS_TOKEN bearer or HEALTHZ_DETAILS=1 */
    const detailed = process.env.HEALTHZ_DETAILS === "1" || hasRole(req.user, "admin") || tasksTokenOk(req);
    res.status(db.ok ? 200 : 503).json(detailed ? body : { ok: body.ok, status: body.status, version: body.version });
  }));
  const taskAuth = (req, res, next) => {
    if (req.user && hasRole(req.user, "admin")) return next();
    if (tasksTokenOk(req)) { req.taskRunner = true; return next(); }
    res.status(req.user ? 403 : 401).json({ error: "Admins or the TASKS_TOKEN bearer (Authorization or X-Tasks-Token) may run tasks" });
  };
  r.get("/admin/tasks", taskAuth, ah(async (req, res) => res.json({ scheduler: SCHEDULER, tasks: await listTasks() })));
  r.post("/admin/tasks/:name/run", taskAuth, ah(async (req, res) => {
    const out = await runTask(req.params.name, req.user || undefined, req.body || {});   /* 404 / 409 / caller mistakes are thrown with their status (v1.74) */
    res.status(out.ok ? 200 : 500).json(out);
  }));
  return r;
}
