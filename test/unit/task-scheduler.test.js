/* v1.73 (F-S9): server/tasks.js drives every scheduled task — the due rules (pure, fake time) of the helpers and of the
   real task objects, and the tick: firing bookkeeping in tasks.lastScheduled, actors, no self-overlap, error isolation. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const settings = vi.hoisted(() => ({ store: {} }));
vi.mock("../../server/settings.js", () => ({ getSetting: vi.fn(async (k, d) => (k in settings.store ? structuredClone(settings.store[k]) : d)), setSetting: vi.fn(async (k, v) => { settings.store[k] = structuredClone(v); }) }));
vi.mock("../../server/audit.js", () => ({ sysAudit: vi.fn(async () => {}) }));
vi.mock("../../server/db.js", async () => (await import("../helpers/server-mocks.js")).mockDb());

const tasks = await import("../../server/tasks.js");
const { registerTask, schedulerTick, startScheduler, stopScheduler, runTask } = tasks;
const { hourly, daily, dailyAt, localDay } = await import("../../server/schedule.js");
const { profileSchedules } = await import("../../server/sync-profiles.js");
const { HOUSEKEEPING_TASK } = await import("../../server/housekeeping.js");
const { STEWARDSHIP_REMINDER_TASK } = await import("../../server/stewardship.js");
const { BACKUP_TASK } = await import("../../server/backup.js");
const { UC_SYNC_TASK } = await import("../../server/uc-sync.js");
const { sysAudit } = await import("../../server/audit.js");

/* local wall-clock dates (the backup compares the local time of day) */
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi);
const H = 3600000;
beforeEach(() => { settings.store = {}; vi.clearAllMocks(); });
afterEach(() => { stopScheduler(); vi.useRealTimers(); });

describe("due-rule helpers", () => {
  it("hourly: first tick, then after a full hour", () => {
    const now = at(2026, 10, 23, 12, 0);
    expect(hourly(now, null)).toBe(true);
    expect(hourly(now, now.getTime() - H + 1000)).toBe(false);
    expect(hourly(now, now.getTime() - H)).toBe(true);
  });
  it("daily: once per local calendar day", () => {
    const now = at(2026, 10, 23, 0, 5);
    expect(daily(now, null)).toBe(true);
    expect(daily(now, at(2026, 10, 23, 0, 1).getTime())).toBe(false);
    expect(daily(now, at(2026, 10, 22, 23, 59).getTime())).toBe(true);
  });
  it("dailyAt: from the local time on, once per local day", () => {
    const before = at(2026, 10, 23, 2, 59), after = at(2026, 10, 23, 3, 0);
    expect(dailyAt("03:00", before, null)).toBe(false);
    expect(dailyAt("03:00", after, null)).toBe(true);
    expect(dailyAt("03:00", after, after.getTime() - 1000)).toBe(false);
    expect(dailyAt("03:00", after, after.getTime() - 25 * H)).toBe(true);
  });
});

/* v1.74 (F-S2 of the third review): the rules must hold in any server time zone. The backup used to compare the local
   wall clock with the UTC day: in Europe/Berlin with time 01:00 it fired at 01:00 and 02:00 on the first day. */
describe.each(["Europe/Berlin", "America/New_York", "Asia/Tokyo", "UTC"])("daily rules in TZ=%s", (tz) => {
  let saved;
  beforeEach(() => { saved = process.env.TZ; process.env.TZ = tz; });
  afterEach(() => { if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved; });
  it("dailyAt fires exactly once per local day, at the configured local time", () => {
    for (const hhmm of ["00:30", "01:00", "02:30", "23:30"]) {
      let last = null; const fired = [];
      for (let m = 0; m < 3 * 24 * 60; m++) {   /* three days, one tick a minute */
        const now = new Date(2026, 9, 21, 0, m);
        if (dailyAt(hhmm, now, last)) { fired.push(now); last = now.getTime(); }
      }
      expect(fired.map(localDay), `${tz} ${hhmm}`).toEqual(["2026-10-21", "2026-10-22", "2026-10-23"]);
      expect(fired.every((d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` === hhmm), `${tz} ${hhmm}`).toBe(true);
    }
  });
  it("daily fires at the first tick of each local day", () => {
    let last = at(2026, 10, 21, 0, 0).getTime(); const fired = [];
    for (let m = 1; m < 2 * 24 * 60; m++) { const now = new Date(2026, 9, 21, 0, m); if (daily(now, last)) { fired.push(now); last = now.getTime(); } }
    expect(fired.map((d) => [localDay(d), d.getHours(), d.getMinutes()])).toEqual([["2026-10-22", 0, 0]]);
  });
});

describe("the task objects' cadence (unchanged from the former timers)", () => {
  it("housekeeping hourly, stewardship reminders daily, usage-purge / write-back unscheduled", () => {
    expect(HOUSEKEEPING_TASK.due).toBe(hourly);
    expect(STEWARDSHIP_REMINDER_TASK.due).toBe(daily);
    expect(STEWARDSHIP_REMINDER_TASK.actor.name).toBe("Stewardship reminders");
  });
  it("backup: only when enabled, from the configured time, once a day", async () => {
    const now = at(2026, 10, 23, 3, 30);
    expect(await BACKUP_TASK.due(now, null)).toBe(false);   /* disabled by default */
    settings.store["backup.settings"] = { enabled: true, time: "04:00" };
    expect(await BACKUP_TASK.due(now, null)).toBe(false);
    settings.store["backup.settings"] = { enabled: true, time: "03:00" };
    expect(await BACKUP_TASK.due(now, null)).toBe(true);
    expect(await BACKUP_TASK.due(now, now.getTime() - 60000)).toBe(false);
    expect(BACKUP_TASK.actor.name).toBe("Scheduled backup");
  });
  it("uc-sync: due whenever a profile is due (the schedules are per profile)", async () => {
    const now = at(2026, 10, 23, 12, 0);
    expect(await UC_SYNC_TASK.due(now, null)).toBe(false);
    settings.store["sync.profiles"] = [{ id: "p1", name: "p", enabled: true, schedule: "manual" }];
    expect(await UC_SYNC_TASK.due(now, null)).toBe(false);
    settings.store["sync.profiles"] = [{ id: "p1", name: "p", enabled: true, schedule: "hourly", lastRun: { at: now.getTime() - 30 * 60000 } }];
    expect(await UC_SYNC_TASK.due(now, null)).toBe(false);
    settings.store["sync.profiles"] = [{ id: "p1", name: "p", enabled: true, schedule: "hourly", lastRun: { at: now.getTime() - H } }];
    expect(await UC_SYNC_TASK.due(now, null)).toBe(true);
  });
  it("uc-sync: the task list shows the profiles' schedules, not \"manual\" (v1.74)", async () => {
    expect(await UC_SYNC_TASK.schedule()).toBe("manual");
    settings.store["sync.profiles"] = [{ id: "p1", name: "Finance", enabled: true, schedule: "daily", time: "03:15" }, { id: "p2", name: "Ops", enabled: true, schedule: "hourly" }, { id: "p3", name: "Off", enabled: false, schedule: "hourly" }];
    expect(await UC_SYNC_TASK.schedule()).toBe("Finance: daily 03:15, Ops: hourly");
    expect(profileSchedules([])).toBe("manual");
  });
});

describe("schedulerTick / startScheduler", () => {
  it("fires due tasks as their actor, records the firing, skips tasks without a due rule, and does not audit", async () => {
    const ran = [];
    const actor = { id: "sys", name: "Own actor", email: "own@system" };
    registerTask("s-due", { description: "", schedule: "hourly", due: hourly, actor, run: async (user, body) => { ran.push(["s-due", user, body]); return { n: 1 }; }, logLine: (r) => `ran ${r.n}` });
    registerTask("s-manual", { description: "", schedule: "manual", run: async () => { ran.push(["s-manual"]); } });
    registerTask("s-default-actor", { description: "", due: () => true, run: async (user) => { ran.push(["s-default-actor", user]); } });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const now = at(2026, 10, 23, 12, 0);
    await schedulerTick(now);
    expect(ran).toEqual([["s-due", actor, {}], ["s-default-actor", expect.objectContaining({ name: "Task runner" })]]);
    expect(settings.store["tasks.lastScheduled"]).toMatchObject({ "s-due": now.getTime(), "s-default-actor": now.getTime() });
    expect(log).toHaveBeenCalledWith("ran 1");
    expect(sysAudit).not.toHaveBeenCalled();
    expect(settings.store["tasks.lastRuns"]).toBeUndefined();   /* scheduled runs stay out of the manual-run record, as before */
    ran.length = 0;
    await schedulerTick(new Date(now.getTime() + 60000));
    expect(ran.map(([n]) => n)).toEqual(["s-default-actor"]);   /* hourly: not again within the hour */
    log.mockRestore();
  });
  it("a failing task is marked fired (no retry every minute) and does not stop the others; a task never overlaps itself", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    let release; const gate = new Promise((r) => { release = r; });
    let slowRuns = 0, okRuns = 0;
    registerTask("s-fail", { description: "", due: daily, run: async () => { throw new Error("boom"); } });
    registerTask("s-slow", { description: "", due: () => true, run: async () => { slowRuns++; await gate; } });
    registerTask("s-ok", { description: "", due: () => true, run: async () => { okRuns++; } });
    const now = at(2026, 10, 23, 12, 0);
    const t1 = schedulerTick(now);
    await new Promise((r) => setTimeout(r, 5));
    await schedulerTick(new Date(now.getTime() + 60000));   /* s-slow is still running */
    expect(slowRuns).toBe(1);
    expect(okRuns).toBe(2);
    release(); await t1;
    expect(err).toHaveBeenCalledWith("scheduled task s-fail:", "boom");
    expect(settings.store["tasks.lastScheduled"]["s-fail"]).toBe(now.getTime());
    err.mockRestore();
  });
  it("startScheduler ticks at once and then every interval until stopScheduler", async () => {
    vi.useFakeTimers();
    let n = 0;
    registerTask("s-count", { description: "", due: () => true, run: async () => { n++; } });
    startScheduler({ tickMs: 1000 });
    await vi.advanceTimersByTimeAsync(10);
    const first = n;
    expect(first).toBeGreaterThanOrEqual(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(n).toBe(first + 2);
    stopScheduler();
    await vi.advanceTimersByTimeAsync(5000);
    expect(n).toBe(first + 2);
  });
});

describe("overlap and manual runs (v1.74, F-S3 / F-S6)", () => {
  it("a tick that starts while the previous one is still deciding is skipped", async () => {
    let release; const gate = new Promise((r) => { release = r; });
    let runs = 0;
    registerTask("o-slow-due", { description: "", due: async () => { await gate; return true; }, run: async () => { runs++; } });
    const now = at(2026, 10, 24, 12, 0);
    const t1 = schedulerTick(now);
    await schedulerTick(new Date(now.getTime() + 60000));   /* skipped: t1 is still evaluating */
    release(); await t1;
    expect(runs).toBe(1);
  });
  it("a manual run answers 409 while the task runs (scheduled or manual) and records nothing for it", async () => {
    let release; const gate = new Promise((r) => { release = r; });
    registerTask("o-busy", { description: "", run: async () => { await gate; return { done: true }; } });
    const first = runTask("o-busy", { email: "a@x" });
    await expect(runTask("o-busy", { email: "b@x" })).rejects.toMatchObject({ status: 409 });
    release();
    expect(await first).toMatchObject({ task: "o-busy", ok: true, result: { done: true } });
    expect(await runTask("o-busy", { email: "c@x" })).toMatchObject({ ok: true });   /* free again */
  });
  it("a caller mistake keeps its status (was a recorded failure and HTTP 500); a real failure is recorded", async () => {
    registerTask("o-bad-input", { description: "", run: async () => { throw Object.assign(new Error("profileId is required"), { status: 400 }); } });
    await expect(runTask("o-bad-input", { email: "a@x" })).rejects.toMatchObject({ status: 400, message: "profileId is required" });
    expect(settings.store["tasks.lastRuns"]?.["o-bad-input"]).toBeUndefined();
    registerTask("o-broken", { description: "", run: async () => { throw new Error("disk full"); } });
    expect(await runTask("o-broken", { email: "a@x" })).toMatchObject({ ok: false, error: "disk full" });
    expect(settings.store["tasks.lastRuns"]["o-broken"]).toMatchObject({ ok: false, error: "disk full" });
    await expect(runTask("o-broken", { email: "a@x" })).resolves.toMatchObject({ ok: false });   /* not stuck as running */
  });
});
