/* Housekeeping (v1.67, pentest L9): expired credentials and short-lived rows are purged instead of accumulating —
   sessions, invitations, password-reset links and OAuth authorisation codes once they have expired; OAuth token
   rows 30 days after their refresh token expired or was revoked (the "Connected MCP applications" history keeps
   recent rows so revocations stay visible). Runs hourly with the internal scheduler (server/tasks.js; the first tick
   after start-up fires), and as the task `housekeeping` (POST /admin/tasks/housekeeping/run) when SCHEDULER=external. */
import { q } from "./db.js";
import { hourly } from "./schedule.js";

export const TOKEN_GRACE_DAYS = 30;
const n = (r) => Number(r?.affectedRows || 0);

export const purgeExpired = async ({ now = Date.now(), graceDays = TOKEN_GRACE_DAYS } = {}) => {
  const grace = now - graceDays * 864e5;
  const out = {};
  out.sessions = n(await q("DELETE FROM sessions WHERE expires < ?", [now]));
  out.invites = n(await q("DELETE FROM invites WHERE expires < ?", [now]));
  out.passwordResets = n(await q("DELETE FROM password_resets WHERE expires < ?", [now]));
  out.oauthCodes = n(await q("DELETE FROM oauth_codes WHERE expires < ?", [now]));
  out.oauthTokens = n(await q("DELETE FROM oauth_tokens WHERE refresh_expires < ? OR (revoked_ts IS NOT NULL AND revoked_ts < ?)", [grace, grace]));
  out.total = Object.values(out).reduce((a, b) => a + b, 0);
  return out;
};

/* registered as task "housekeeping" by server.js (v1.68: no registration as an import side effect) */
export const HOUSEKEEPING_TASK = { description: "Purge expired sessions, invitations, password-reset links and OAuth codes/tokens (tokens 30 days after expiry or revocation)", schedule: "hourly", run: async () => purgeExpired(),
  due: hourly, logLine: (r) => (r.total ? `Housekeeping: ${r.total} expired row(s) purged` : null) };   /* v1.73 (F-S9): server/tasks.js scheduler */

