/**
 * Shared harness for the end-to-end suites (v1.73, review finding F-T6).
 *
 * Every *.e2e.test.mjs file is self-contained: it resets the test database, boots its own `node server.js` on a fixed
 * port of its own, bootstraps the first admin, seeds what it needs and cleans up after itself. Each file can therefore
 * run alone (`node --test test/e2e/mcp.e2e.test.mjs`) as well as in the full run (`npm run test:e2e`).
 *
 *   requireDb()            skip option for describe()/test(): a clear "skipped" line instead of a silent green
 *   resetDb()              drops every table of DB_NAME (MariaDB or PostgreSQL) → the next server start is a fresh install
 *   bootServer(env, opts)  spawns server.js, waits for /auth/bootstrap-needed, returns { base, child, stop }
 *   client(base)           cookie jar + X-CSRF-Token header like the UI's fetch wrapper
 *   mcpClient(base, token) JSON-RPC over /mcp with a bearer token (no cookies)
 *   bootstrapAdmin(c)      creates the first admin (or signs in when one exists) and checks /auth/me
 *   signIn(c, email, pw)   fresh session for another account (the jar is cleared first)
 *   seedTree(m, hubName)   hub → e2e_gold → prod → kpi through MCP; cleanupTree(m, hubName) removes it again
 *
 * The database is shared by all files (DB_NAME from the environment), so it MUST be a dedicated test database:
 * resetDb() refuses to run unless DB_NAME contains "test" or "e2e" (override: E2E_ALLOW_DB_RESET=1).
 */
import { resetRefusal } from "./db-guard.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const ADMIN = { name: "E2E Admin", email: "e2e@example.com", password: "e2e-secret-123" };
export const MCP_TOKEN = "e2e-mcp-token";

/* ports: one fixed port per file (3981–3989 by default) so files never collide even when run in parallel by hand */
const PORT_BASE = Number(process.env.E2E_PORT_BASE || 3980);
export const PORTS = { catalog: 1, auth: 2, marketplace: 3, mcp: 4, imports: 5, ops: 6, governance: 7, header: 8, noInspector: 9 };
export const portOf = (name) => PORT_BASE + PORTS[name];

/* ── skipping without DB credentials ── */
export const DB_SKIP_MESSAGE = "E2E skipped: DB_* env not set (DB_USER, DB_PASSWORD, DB_NAME; DB_DRIVER=postgres for PostgreSQL)";
/** Without `t`: the value for `describe(name, { skip: requireDb() }, …)` (false or the skip message).
 *  With a test context `t`: calls t.skip(message) and returns true when the DB env is missing. */
export const requireDb = (t) => {
  const missing = !process.env.DB_PASSWORD;
  if (t && missing) { t.skip(DB_SKIP_MESSAGE); return true; }
  return t ? false : (missing ? DB_SKIP_MESSAGE : false);
};

/* ── database reset (both engines) ── */
export const resetDb = async () => {
  const { DB, isPostgres } = await import(path.join(ROOT, "server/db.js"));
  const refusal = resetRefusal(DB, process.env);   /* v1.74: word-boundary name rule + loopback host (test/e2e/db-guard.mjs) */
  if (refusal) throw new Error(refusal);
  if (isPostgres) {
    const pg = (await import("pg")).default;
    const c = new pg.Client({ host: DB.host, port: DB.port, user: DB.user, password: DB.password, database: DB.database });
    await c.connect();
    try {
      const { rows } = await c.query("SELECT tablename FROM pg_tables WHERE schemaname = current_schema()");
      if (rows.length) await c.query(`DROP TABLE IF EXISTS ${rows.map((r) => `"${r.tablename.replace(/"/g, '""')}"`).join(", ")} CASCADE`);
    } finally { await c.end(); }
  } else {
    const mysql = (await import("mysql2/promise")).default;
    const c = await mysql.createConnection({ host: DB.host, port: DB.port, user: DB.user, password: DB.password, database: DB.database });
    try {
      const [rows] = await c.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'");
      await c.query("SET FOREIGN_KEY_CHECKS = 0");
      if (rows.length) await c.query(`DROP TABLE IF EXISTS ${rows.map((r) => `\`${r.t.replace(/`/g, "``")}\``).join(", ")}`);
    } finally { await c.end(); }
  }
};

/* ── server process ── */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reachable = async (url) => { try { await fetch(url); return true; } catch { return false; } };

/** Environment the main suite always passed to the server (kept per file so every assertion sees the same limits). */
export const baseEnv = (base) => ({
  MCP_TOKEN, DATA_DIR: "/tmp/e2e-nodata", APP_URL: base, CONNECTORS_ALLOW_PRIVATE: "1", DATABRICKS_ALLOWED_HOSTS: "127.0.0.1:3993",
  MCP_MAX_BATCH: "5", MCP_RATE_PER_MIN: "600", MCP_WRITE_RATE_PER_MIN: "400", TASKS_TOKEN: "e2e-tasks-token", IMPORT_CHUNK_ROWS: "5000",
});

export const bootServer = async (env = {}, { port, label = "server" } = {}) => {
  if (!port) throw new Error("bootServer: a port is required");
  const base = `http://127.0.0.1:${port}`;
  if (await reachable(base + "/healthz")) throw new Error(`${label}: port ${port} is already in use — stop the other process (or set E2E_PORT_BASE)`);
  const child = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: { ...process.env, PORT: String(port), ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let exited = null;
  const gone = new Promise((r) => child.once("exit", (code, signal) => { exited = { code, signal }; r(); }));
  child.stderr.on("data", (d) => process.stderr.write(d));
  child.stdout.resume();
  const stop = async () => {
    if (exited) return;
    child.kill();
    let timer; await Promise.race([gone, new Promise((r) => { timer = setTimeout(r, 15000); })]); clearTimeout(timer);   /* graceful shutdown frees the port */
    if (!exited) child.kill("SIGKILL");
  };
  for (let i = 0; i < 60; i++) {
    if (exited) throw new Error(`${label} exited during start-up (code ${exited.code}, signal ${exited.signal}) — see stderr above`);
    try { const r = await fetch(base + "/auth/bootstrap-needed"); if (r.ok) return { base, port, child, stop }; } catch { /* not up yet */ }
    await sleep(500);
  }
  await stop();
  throw new Error(`${label} did not start on port ${port}`);
};

/* ── HTTP client with a cookie jar ── */
/** `c.cookie` is the Cookie header ("dhc_session=…; dhc_csrf=…"); tests read/assign it to switch users. */
export const client = (base) => {
  const c = {
    base,
    cookie: "",
    jar: () => Object.fromEntries(c.cookie.split(";").map((p) => p.trim()).filter(Boolean).map((p) => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)])),
    csrf: () => c.jar().dhc_csrf || "",
    req: async (p, { method = "GET", body, headers = {}, raw = false, csrf = true } = {}) => {
      const h = { "Content-Type": "application/json", Cookie: c.cookie, ...headers };
      if (csrf && !["GET", "HEAD"].includes(method) && c.csrf()) h["X-CSRF-Token"] = c.csrf();   /* like the UI's fetch wrapper */
      const r = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)) });
      const j = c.jar();
      for (const sc of r.headers.getSetCookie()) {
        const [kv, ...attrs] = sc.split(";"); const k = kv.slice(0, kv.indexOf("=")).trim(), v = kv.slice(kv.indexOf("=") + 1).trim();
        const gone = !v || attrs.some((a) => /^\s*(max-age=0|expires=thu, 01 jan 1970)/i.test(a));
        if (gone) delete j[k]; else j[k] = v;
      }
      c.cookie = Object.entries(j).map(([k, v]) => `${k}=${v}`).join("; ");
      return raw ? r : { status: r.status, json: await r.json().catch(() => ({})) };
    },
  };
  return c;
};

/* ── MCP client (bearer token, no session) ── */
export const mcpClient = (base, token = MCP_TOKEN) => {
  const call = async (method, params = {}) => {
    const r = await fetch(base + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    return r.json().catch(() => ({}));
  };
  const tool = async (name, args = {}) => {
    const r = await call("tools/call", { name, arguments: args });
    if (!r.result) throw new Error(`MCP ${name}: ${JSON.stringify(r)}`);
    const t = r.result.content[0].text;
    try { return { ...r.result, data: JSON.parse(t) }; } catch { return { ...r.result, data: t }; }
  };
  return { call, tool };
};

/* ── accounts ── */
export const bootstrapAdmin = async (c, admin = ADMIN) => {
  const { json } = await c.req("/auth/bootstrap-needed");
  if (json.needed) assert.equal((await c.req("/auth/bootstrap", { method: "POST", body: admin })).status, 200, "bootstrap the first admin");
  else assert.equal((await c.req("/auth/login", { method: "POST", body: { email: admin.email, password: admin.password } })).status, 200, "admin sign-in");
  assert.equal((await c.req("/auth/me")).json.user.email, admin.email);
};

export const signIn = async (c, email, password) => { c.cookie = ""; return c.req("/auth/login", { method: "POST", body: { email, password } }); };

/* ── seed data ── */
export const seedTree = async (m, hubName = `E2E-${Date.now()}`) => {
  const created = {
    hub: await m.tool("create_hub", { name: hubName }),
    database: await m.tool("create_database", { name: "e2e_gold", hub: hubName, layer: "gold", country: "DE" }),
    schema: await m.tool("create_schema", { database: `${hubName}/e2e_gold`, name: "prod" }),
    table: await m.tool("create_table", { schema: "e2e_gold.prod", name: "kpi", description: "e2e kpi table" }),
  };
  for (const [k, r] of Object.entries(created)) if (r.isError) throw new Error(`seed ${k} failed: ${JSON.stringify(r.data)}`);
  return { hubName, created };
};

/** Best effort: remove the seeded tree (the last hub of an installation is protected, so the hub may stay). */
export const cleanupTree = async (m, hubName) => {
  if (!hubName) return;
  try { await m.tool("delete_database", { database: `${hubName}/e2e_gold` }); await m.tool("delete_hub", { hub: hubName }); } catch { /* server already gone */ }
};

/** One call for a file's before(): reset → boot → bootstrap admin → (optionally) seed. */
export const startSuite = async ({ name, env = {}, seed = true, bootstrap = true } = {}) => {
  await resetDb();
  const port = portOf(name);
  const srv = await bootServer({ ...baseEnv(`http://127.0.0.1:${port}`), ...env }, { port, label: `${name} server` });
  const c = client(srv.base), m = mcpClient(srv.base);
  try {
    if (bootstrap) await bootstrapAdmin(c);
    const seeded = seed ? await seedTree(m) : null;
    return { ...srv, c, m, hubName: seeded?.hubName, seeded };
  } catch (e) { await srv.stop(); throw e; }
};
