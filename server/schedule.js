/* Due rules of the scheduled tasks (v1.74 — F-S2 of the third review). Pure functions: `now` is a Date, `lastAt` the
   epoch ms of the last firing (null or 0 if never). "Daily" means the server's LOCAL calendar day everywhere — the
   backup's rule used to compare the local wall clock with the UTC day, so on a Europe/Berlin server with backup time
   01:00 it fired at 01:00 and again at 02:00 (the start of the UTC day) on the first day and at 02:00 afterwards; the
   UC sync profiles already used the local day with their own copy of the clock helper. */

const pad = (n) => String(n).padStart(2, "0");
/* the local calendar day of an instant, e.g. "2026-10-23" */
export const localDay = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/* the local wall clock of a Date as "HH:MM" (compared as strings with the configured times) */
export const localHHMM = (now) => `${pad(now.getHours())}:${pad(now.getMinutes())}`;

/* at most once an hour (the first tick after start fires) */
export const hourly = (now, lastAt) => !lastAt || now.getTime() - lastAt >= 3600000;
/* once per local calendar day (the first tick of the day fires) */
export const daily = (now, lastAt) => !lastAt || localDay(lastAt) !== localDay(now);
/* once per local calendar day, from the local time `hhmm` on */
export const dailyAt = (hhmm, now, lastAt) => localHHMM(now) >= hhmm && daily(now, lastAt);
