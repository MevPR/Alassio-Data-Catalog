/* Runtime configuration and role model (shared by every server module). */
export const PORT = process.env.PORT || process.env.DATABRICKS_APP_PORT || 3000;
/* bind address: loopback behind nginx; 0.0.0.0 when a platform (Databricks Apps, containers) fronts the process itself */
export const HOST = process.env.HOST || (process.env.DATABRICKS_APP_PORT || process.env.BIND_ALL === "1" ? "0.0.0.0" : "127.0.0.1");
export const APP_URL = (process.env.APP_URL || "http://localhost").replace(/\/$/, "");
export const COOKIE = "dhc_session";
export const SESSION_DAYS = 30;
export const DATA_DIR = process.env.DATA_DIR || "./data";
/* Python source inspector (DuckDB, lake files, SQLAlchemy, JDBC). Optional since v1.60: set INSPECTOR_URL to an empty
   string or "off" and those source types disappear from the UI — the HTTPS connectors run natively in Node. */
export const INSPECTOR_URL = process.env.INSPECTOR_URL !== undefined ? process.env.INSPECTOR_URL.trim() : "http://127.0.0.1:3001";
/* Lazy loading for large catalogs: above this many attributes the document is delivered without attribute records */
export const LAZY_ATTRIBUTES = Number(process.env.LAZY_ATTRIBUTES || 5000);
export const UI_LANGS = ["en", "de", "pl", "es", "fr", "it"];

export const ROLES = ["admin", "steward", "guest", "pm", "ingestion", "ba", "dpd", "agent"];
/* an account may hold several roles; permissions follow the highest one (`role` column) */
export const ROLE_RANK = { admin: 100, steward: 60, pm: 50, ba: 40, ingestion: 40, dpd: 40, guest: 0, agent: 0 };
export const highestRole = (roles) => [...new Set(roles)].filter((r) => ROLES.includes(r)).sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])[0] || "guest";
export const parseRoles = (u) => { let rs; try { rs = Array.isArray(u.roles) ? u.roles : u.roles ? JSON.parse(u.roles) : []; } catch { rs = []; } if (!rs.length && u.role) rs = [u.role]; return [...new Set(rs.filter((r) => ROLES.includes(r)))]; };
export const hasRole = (u, r) => !!u && (u.role === r || (u.roles || []).includes(r));
/* the actor of unattended work (schedulers, migrations, sync runs) — audit rows and settings show e-mail "system" */
export const systemActor = (name) => ({ id: "system", name, email: "system" });
/* v1.68: technical agent accounts (created with an MCP key, never with a password) live on this pseudo domain */
export const AGENT_DOMAIN = "@agents.local";
export const isAgentAccount = (u) => String(u?.email || "").toLowerCase().endsWith(AGENT_DOMAIN);
export const WORKFLOW_ROLES = ["pm", "ingestion", "ba", "dpd"];
