/**
 * Alassio Data Catalog — application server (composition root).
 *
 * Storage: MariaDB, or PostgreSQL / Lakebase with DB_DRIVER=postgres (users, sessions, invitations, relational catalog
 * with optimistic locking, audit trail).
 * Passwords are scrypt hashes, session/invitation/reset tokens are stored hashed (v1.67), sessions are httpOnly cookies,
 * TOTP secrets never leave the server except once at setup time.
 *
 * This file only wires things together: middleware, the routers of server/routes/*.js, the MCP endpoint, the task
 * table and the schedulers. Domain logic lives in server/*.js; the module map is PLAN.md §2 "Architecture".
 */
import express from "express";
import cookieParser from "cookie-parser";
import fs from "fs";
import path from "path";
import { registerMcp } from "./mcp.js";
import { PORT, HOST } from "./server/config.js";
import { initDb, closeDb, DRIVER } from "./server/db.js";
import { scryptHash } from "./server/crypto.js";
import { countUsers, createUser } from "./server/users.js";
import { sessionMiddleware, requireRole, hashStoredTokens, startLoginGc, stopLoginGc } from "./server/auth.js";
import { forwardedMcpIdentity } from "./server/identity.js";
import { securityHeaders, csrfGuard, initCsrf } from "./server/security.js";
import { queryAudit } from "./server/audit.js";
import { assembleLazy, applyChanges, searchRows, migrateDocToRows, ensureCatalogMeta } from "./server/catalog-store.js";
import { resolveAgentKey } from "./server/agent-keys.js";
import { authRoutes } from "./server/routes/auth.js";
import { adminUserRoutes } from "./server/routes/admin-users.js";
import { catalogRoutes } from "./server/routes/catalog.js";
import { sourceImportRoutes } from "./server/routes/source-import.js";
import { glossaryFileRoutes } from "./server/routes/glossary-files.js";
import { messageRoutes } from "./server/routes/messages.js";
import { marketplaceRoutes } from "./server/routes/marketplace.js";
import { ssoRoutes } from "./server/routes/sso.js";
import { agentKeyRoutes } from "./server/routes/agent-keys.js";
import { importRoutes } from "./server/routes/import.js";
import { exportRoutes } from "./server/routes/export.js";
import { dumpRoutes } from "./server/routes/dump.js";
import { backupRoutes } from "./server/routes/backups.js";
import { stewardshipRoutes } from "./server/routes/stewardship.js";
import { oauthRoutes } from "./server/routes/oauth.js";
import { opsRoutes } from "./server/routes/ops.js";
import { SCHEDULER, registerTask, startScheduler, stopScheduler } from "./server/tasks.js";
import { syncRoutes } from "./server/routes/sync.js";
import { UC_SYNC_TASK } from "./server/uc-sync.js";
import { UC_WRITEBACK_TASK } from "./server/uc-writeback-run.js";
import { collabRoutes } from "./server/routes/collab.js";
import { resolveAccessToken, rateLimit } from "./server/oauth.js";
import { collabOf, addComment, openQuestions, notifyQuestion, USAGE_PURGE_TASK } from "./server/collab.js";
import { STEWARDSHIP_REMINDER_TASK } from "./server/stewardship.js";
import { recoverJobs, shutdownJobs } from "./server/jobs.js";
import { migrateStoredCatalog } from "./server/catalog-migrate.js";
import { BACKUP_TASK } from "./server/backup.js";
import { purgeExpired, HOUSEKEEPING_TASK } from "./server/housekeeping.js";

export const APP_VERSION = "1.79.7";

const app = express();
app.set("trust proxy", "loopback");
app.use(securityHeaders);
app.use(cookieParser());
app.use(sessionMiddleware);
app.use(csrfGuard);           /* state-changing requests with a session cookie need X-CSRF-Token (forms: _csrf) */
/* raw-body routes — mounted before express.json: dump restore (streamed upload); the bundle import (dbt manifests,
   data contracts — parsed on the server since v1.66) gets its own body limit. The /databricks proxy of v1.x is gone:
   Unity Catalog imports and the write-back run on the server with a sync profile's credentials. */
app.use(dumpRoutes());
app.use("/api/import/bundle", requireRole("admin"), express.json({ limit: "512mb" }));   /* v1.66.1: authenticate before the large parser runs */
app.use(express.json({ limit: "25mb" }));

/* ── API ── */
app.use(authRoutes());
app.use(ssoRoutes());
app.use(adminUserRoutes());
app.use(agentKeyRoutes());
app.use(catalogRoutes());
app.use(sourceImportRoutes());
app.use(importRoutes());
app.use(exportRoutes({ appVersion: APP_VERSION }));
app.use(glossaryFileRoutes());
app.use(messageRoutes());
app.use(marketplaceRoutes());
app.use(backupRoutes());
app.use(stewardshipRoutes());
app.use(oauthRoutes());          /* OAuth 2.1 for MCP clients (v1.58) */
/* the scheduled-task table (v1.70): assembled here, nothing registers itself at import time */
registerTask("backup", BACKUP_TASK);
registerTask("stewardship-reminders", STEWARDSHIP_REMINDER_TASK);
registerTask("usage-purge", USAGE_PURGE_TASK);
registerTask("uc-sync", UC_SYNC_TASK);
registerTask("uc-writeback", UC_WRITEBACK_TASK);
registerTask("housekeeping", HOUSEKEEPING_TASK);
app.use(opsRoutes({ appVersion: APP_VERSION }));   /* /healthz, /admin/tasks (v1.59) */
app.use(syncRoutes());           /* scheduled Unity Catalog sync (v1.59) */
app.use(collabRoutes({ readCatalog: assembleLazy }));   /* comments, questions, ratings, usage (v1.58) */

/* ── MCP server for AI agents (all catalog actions; no user management) ── */
registerMcp(app, {
  appVersion: APP_VERSION,
  readCatalog: assembleLazy,        /* lite document + attributes on demand — MCP never builds the full document */
  searchRows,
  resolveAgentKey,
  resolveOAuthToken: resolveAccessToken,   /* OAuth access tokens act as the consenting human (v1.58) */
  resolveForwardedIdentity: forwardedMcpIdentity,   /* AUTH_MODE=header: the proxy's verified identity acts as the human (v1.61) */
  rateLimit,                               /* per-credential sliding-window limits → 429 (v1.58) */
  collab: { of: collabOf, add: addComment, open: openQuestions, notifyQuestion },   /* ratings, comments, questions (v1.58) */
  applyChanges,                     /* MCP writes are deltas with per-object conflict detection */
  queryAudit: async (limit, qq) => (await queryAudit({ limit: Number(limit) || 25, max: 100, q: qq, hideUsers: true })).entries
    .map((e) => ({ ts: new Date(e.ts).toISOString(), user: e.user?.name, action: e.action, type: e.entityType, name: e.name, context: e.context, ...(e.changes ? { changes: e.changes } : {}) })),
});

/* ── static UI + SPA fallback ── */
app.use(express.static("dist"));
app.get("/{*splat}", (req, res, next) => {   /* SPA fallback (Express 5 wildcard syntax) */
  const idx = path.resolve("dist/index.html");
  fs.existsSync(idx) ? res.sendFile(idx) : next();
});

/* ── start ── */
const start = async () => {
  await initDb();
  await hashStoredTokens();        /* v1.67: session / invitation tokens of earlier versions are hashed once */
  await initCsrf();
  await migrateDocToRows();
  await ensureCatalogMeta();
  await migrateStoredCatalog();    /* v1.66: the server upgrades the stored document (and seeds a fresh installation) */
  await recoverJobs();            /* jobs interrupted by the previous run are marked, the mirror timer starts */
  startLoginGc();
  if (SCHEDULER === "internal") startScheduler();   /* v1.73: one scheduler drives every task with a due rule (server/tasks.js) */
  else { await purgeExpired(); console.log("SCHEDULER=external — backups, reminders and housekeeping run via POST /admin/tasks/<name>/run"); }
  if ((await countUsers()) === 0 && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const u = await createUser({ name: process.env.ADMIN_NAME || "Administrator", email: process.env.ADMIN_EMAIL, role: "admin", passwordHash: await scryptHash(process.env.ADMIN_PASSWORD) });   /* v1.67: scryptHash is async since 1.66.1 */
    console.log(`Created initial admin ${u.email} from environment`);
  }
  const server = app.listen(PORT, HOST, () => console.log(`Alassio Data Catalog v${APP_VERSION} listening on http://${HOST}:${PORT} (${DRIVER}: ${process.env.DB_NAME || "datahub_catalog"}, scheduler ${SCHEDULER})`));
  server.keepAliveTimeout = 65000;
  /* graceful shutdown (SIGTERM from systemd / the platform, SIGINT in a terminal): stop accepting connections, stop the
     schedulers, mark live jobs interrupted and flush them, close the pool — all well inside a 15-second grace period */
  let stopping = false;
  const shutdown = (signal) => {
    if (stopping) return; stopping = true;
    console.log(`${signal} received — shutting down`);
    const force = setTimeout(() => { console.error("Shutdown timed out — exiting"); process.exit(1); }, 12000); force.unref();
    server.close(() => {});
    server.closeIdleConnections?.();
    (async () => {
      try { stopScheduler(); stopLoginGc(); await shutdownJobs(); await closeDb(); } catch (e) { console.error("shutdown:", e.message); }
      process.exit(0);
    })();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};
start().catch((e) => { console.error("Startup failed:", e.message); process.exit(1); });
