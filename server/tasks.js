/* Scheduled-task registry (v1.70 — moved out of routes/ops.js). server.js assembles the table from the domain modules'
   task objects ({ description, schedule, run(user, body) }) — no module registers itself at import time any more.
   runTask() executes one task, records the outcome in the setting tasks.lastRuns and audits it; the ops route
   only authenticates and answers. SCHEDULER=internal runs the in-process scheduler below, SCHEDULER=external leaves the
   execution to a platform scheduler calling POST /admin/tasks/:name/run.
   v1.73 (F-S9): one scheduler for every task instead of four hand-rolled timers (backup, stewardship reminders, UC sync,
   housekeeping). A task that should run on its own declares `due(now, lastAt)` — `now` a Date, `lastAt` the epoch ms of
   its last scheduled firing (null if never) — plus optionally the system `actor` its scheduled runs act as and a
   `logLine(result)` for the console. startScheduler() ticks once a minute; a due task is marked fired before it runs
   (a failure does not retry until it is due again), never overlaps itself, and its firing time is kept in the setting
   tasks.lastScheduled (replaces backup.lastRunDay / stewardship.lastRemindDay). Scheduled runs are not recorded in
   tasks.lastRuns nor audited as "task …" — exactly as the former timers.
   v1.74 (F-S3 / F-S6 of the third review): the due rules live in server/schedule.js (local calendar day); a tick that
   is still evaluating when the next one starts is skipped; a task is marked running before the first await, so two
   ticks cannot start it twice; manual runs (runTask) share the same running set and answer 409 while the task runs;
   a caller mistake (an error with a 4xx status, e.g. uc-writeback without profileId) is thrown with its status instead
   of becoming a recorded failure and an HTTP 500. */
import { getSetting, setSetting } from "./settings.js";
import { sysAudit } from "./audit.js";
import { systemActor } from "./config.js";

export const SCHEDULER = /^external$/i.test(process.env.SCHEDULER || "") ? "external" : "internal";
const SYSTEM = systemActor("Task runner");   /* v1.73 (F-S12): the module-local SYSTEM like every other domain module (was the exported SYSTEM_TASK) */
export const TICK_MS = 60000;
const LAST_KEY = "tasks.lastScheduled";

const TASKS = new Map();
export const registerTask = (name, task) => { TASKS.set(name, task); };
export const taskNames = () => [...TASKS.keys()];
export const getTask = (name) => TASKS.get(name) || null;

/* the task list for GET /admin/tasks — `schedule` may be a string or an async function (the backup reads its settings) */
export const listTasks = async () => {
  const runs = (await getSetting("tasks.lastRuns", {})) || {};
  const out = [];
  for (const [name, t] of TASKS) out.push({ name, description: t.description, lastRun: runs[name] || null, schedule: typeof t.schedule === "function" ? await t.schedule() : (t.schedule || "manual") });
  return out;
};

const running = new Set();
export const isTaskRunning = (name) => running.has(name);

/* runs one task now; returns { task, ok, ms, result | error }. Throws 404 (unknown task), 409 (already running) and
   the caller mistakes of the task itself (errors with a 4xx status) — the route maps them through ah(). */
export const runTask = async (name, user = SYSTEM, body = {}) => {
  const task = getTask(name);
  if (!task) throw Object.assign(new Error(`Unknown task — one of ${taskNames().join(", ")}`), { status: 404 });
  if (running.has(name)) throw Object.assign(new Error(`Task ${name} is already running`), { status: 409 });
  running.add(name);
  const t0 = Date.now();
  let result, error = null;
  try { result = await task.run(user, body || {}); }
  catch (e) { if (e.status >= 400 && e.status < 500) throw e; error = e.message; }
  finally { running.delete(name); }
  const runs = (await getSetting("tasks.lastRuns", {})) || {};
  runs[name] = { at: Date.now(), ms: Date.now() - t0, ok: !error, by: user.email, ...(error ? { error } : { result }) };
  await setSetting("tasks.lastRuns", runs, user);
  await sysAudit(user, "system", error ? "failed" : "updated", `task ${name}${error ? `: ${error}` : ""}`);
  return { task: name, ok: !error, ms: Date.now() - t0, ...(error ? { error } : { result }) };
};

/* the due rules (hourly, daily, dailyAt) live in server/schedule.js (v1.74) */

/* ── the in-process scheduler ── */
let timer = null;
let ticking = false;
/* one tick: evaluates every task's due rule and starts the due ones (not awaited against each other — like the former
   independent timers); resolves when the started runs have finished (tests await it) */
export const schedulerTick = async (now = new Date()) => {
  if (ticking) return;   /* the previous tick is still deciding (slow database) — skip this one */
  ticking = true;
  const due = [];
  try {
    const last = (await getSetting(LAST_KEY, {})) || {};
    for (const [name, task] of TASKS) {
      if (typeof task.due !== "function" || running.has(name)) continue;
      try { if (await task.due(now, last[name] ?? null) && !running.has(name)) { running.add(name); due.push([name, task]); } }
      catch (e) { console.error(`scheduled task ${name}:`, e.message); }
    }
    if (!due.length) return;
    /* mark every due task fired in one write before any of them runs */
    for (const [name] of due) last[name] = now.getTime();
    await setSetting(LAST_KEY, last, SYSTEM);
  } catch (e) {
    console.error("scheduler:", e.message);
    for (const [name] of due) running.delete(name);
    return;
  } finally { ticking = false; }
  await Promise.all(due.map(async ([name, task]) => {
    try {
      const result = await task.run(task.actor || SYSTEM, {});
      const line = task.logLine ? task.logLine(result) : null;
      if (line) console.log(line);
    } catch (e) { console.error(`scheduled task ${name}:`, e.message); }
    finally { running.delete(name); }
  }));
};
/* SCHEDULER=internal only — server.js decides; the first tick runs at once */
export const startScheduler = ({ tickMs = TICK_MS } = {}) => {
  if (timer) return;
  timer = setInterval(() => { schedulerTick(); }, tickMs); timer.unref?.();
  schedulerTick();
};
export const stopScheduler = () => { if (timer) clearInterval(timer); timer = null; };
