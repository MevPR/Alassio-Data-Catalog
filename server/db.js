/* Database layer (v1.59, PLAN.md item 17): one `q()` / connection API over two engines.
     DB_DRIVER=mariadb (default — MariaDB ≥ 10.6 / MySQL 8 via mysql2)
     DB_DRIVER=postgres (PostgreSQL ≥ 14 / Databricks Lakebase via pg)
   Call sites keep writing MariaDB-style SQL with `?` placeholders; the Postgres adapter rewrites placeholders to $n,
   returns rows (SELECT) or { affectedRows } (writes) in the mysql2 shape, and the DDL in initDb is written once and
   translated for Postgres (types, inline indexes, FULLTEXT → tsvector + GIN). Dialect differences that cannot be
   translated mechanically are exposed as small helpers (`sql.upsert`, `sql.insertIgnore`, `sql.like`, `sql.int`,
   `sql.jsonContains`, `sql.jsonSetText`, `sql.search`) used by the few places that need them. */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DATA_DIR } from "./config.js";
import { CAT_TABLES } from "./catalog-tables.js";

export const DRIVER = /^(pg|postgres|postgresql)$/i.test(process.env.DB_DRIVER || "") ? "postgres" : "mariadb";
export const isPostgres = DRIVER === "postgres";
export const DB = {
  /* PG* fallbacks: a Lakebase resource attached to a Databricks App injects PGHOST/PGPORT/PGUSER/PGDATABASE/PGSSLMODE (v1.61) */
  host: process.env.DB_HOST || (isPostgres && process.env.PGHOST) || "127.0.0.1",
  port: Number(process.env.DB_PORT || (isPostgres && process.env.PGPORT) || (isPostgres ? 5432 : 3306)),
  user: process.env.DB_USER || (isPostgres && process.env.PGUSER) || "datahub",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || (isPostgres && process.env.PGDATABASE) || "datahub_catalog",
};

/* ── placeholder rewriting for Postgres: `?` → `$n` outside quotes and comments ── */
const rewriteCache = new Map();
export const toPgPlaceholders = (sql) => {
  const hit = rewriteCache.get(sql); if (hit) return hit;
  let out = "", n = 0, i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"') {                       /* quoted string / identifier (with doubled-quote escapes) */
      let j = i + 1;
      while (j < sql.length) { if (sql[j] === c) { if (sql[j + 1] === c) { j += 2; continue; } break; } j++; }
      out += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === "-" && sql[i + 1] === "-") { const j = sql.indexOf("\n", i); const end = j < 0 ? sql.length : j; out += sql.slice(i, end); i = end; continue; }
    if (c === "?") { out += `$${++n}`; i++; continue; }
    out += c; i++;
  }
  if (rewriteCache.size > 2000) rewriteCache.clear();
  rewriteCache.set(sql, out);
  return out;
};

/* ── Databricks Lakebase: the service principal's OAuth token is the database password and expires after an hour.
   DB_PASSWORD_PROVIDER=databricks makes the pool fetch a fresh credential for every new connection
   (DATABRICKS_HOST, DATABRICKS_CLIENT_ID, DATABRICKS_CLIENT_SECRET are injected by Databricks Apps;
   LAKEBASE_INSTANCE names the database instance). Tokens are cached until five minutes before expiry. ── */
let lakebaseCache = { token: null, until: 0 };
/* Two Lakebase flavours (v1.61.1): Autoscaling (projects/branches/endpoints → POST /api/2.0/postgres/credentials with
   LAKEBASE_ENDPOINT = projects/<id>/branches/<id>/endpoints/<id>) and Provisioned (POST /api/2.0/database/credentials
   with LAKEBASE_INSTANCE). Both tokens live 60 minutes; the pool asks for the password on every new connection. */
export const lakebasePassword = async ({ fetchImpl = fetch, env = process.env, now = Date.now } = {}) => {
  if (lakebaseCache.token && now() < lakebaseCache.until) return lakebaseCache.token;
  const host = String(env.DATABRICKS_HOST || "").replace(/\/$/, "").replace(/^(?!https?:\/\/)/, "https://");
  const id = env.DATABRICKS_CLIENT_ID, secret = env.DATABRICKS_CLIENT_SECRET, endpoint = env.LAKEBASE_ENDPOINT, instance = env.LAKEBASE_INSTANCE;
  if (!host || !id || !secret || !(endpoint || instance)) throw new Error("Lakebase credentials need DATABRICKS_HOST, DATABRICKS_CLIENT_ID, DATABRICKS_CLIENT_SECRET and LAKEBASE_ENDPOINT (Autoscaling) or LAKEBASE_INSTANCE (Provisioned)");
  const tr = await fetchImpl(`${host}/oidc/v1/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}` },
    body: "grant_type=client_credentials&scope=all-apis" });
  if (!tr.ok) throw new Error(`Databricks token endpoint: HTTP ${tr.status}`);
  const { access_token } = await tr.json();
  const [path, body] = endpoint ? ["/api/2.0/postgres/credentials", { endpoint }] : ["/api/2.0/database/credentials", { instance_names: [instance], request_id: crypto.randomUUID() }];
  const cr = await fetchImpl(`${host}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${access_token}` }, body: JSON.stringify(body) });
  if (!cr.ok) throw new Error(`Lakebase credential (${path}): HTTP ${cr.status}`);
  const cred = await cr.json();
  const exp = cred.expire_time || cred.expiration_time;
  const until = exp ? Date.parse(exp) - 5 * 60000 : now() + 50 * 60000;
  lakebaseCache = { token: cred.token, until };
  return cred.token;
};
export const resetLakebaseCache = () => { lakebaseCache = { token: null, until: 0 }; };

/* ── pools and connections with one shape: conn.query(sql, params) → [rowsOrHeader], beginTransaction/commit/rollback/release ── */
let pool;
if (isPostgres) {
  const pg = (await import("pg")).default;
  pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));      /* int8 (BIGINT timestamps, COUNT) → number */
  pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));    /* numeric (AVG, SUM) → number */
  const pgPool = new pg.Pool({ ...DB, max: 10, ssl: process.env.DB_SSL === "1" || (!process.env.DB_SSL && /^(require|verify-full|verify-ca)$/.test(process.env.PGSSLMODE || "")) ? { rejectUnauthorized: process.env.DB_SSL_VERIFY !== "0" } : undefined,
    password: process.env.DB_PASSWORD_PROVIDER === "databricks" ? () => lakebasePassword() : DB.password });
  const shape = (r) => (/^(SELECT|WITH|SHOW|VALUES)$/i.test(r.command || "") || (r.rows?.length && !/^(INSERT|UPDATE|DELETE)$/i.test(r.command || ""))
    ? r.rows : Object.assign({ affectedRows: r.rowCount ?? 0, insertId: 0 }, r.rows?.length ? { rows: r.rows } : {}));
  const wrap = (client, release) => ({
    query: async (sql, params = []) => [shape(await client.query(toPgPlaceholders(sql), params))],
    execute: async (sql, params = []) => [shape(await client.query(toPgPlaceholders(sql), params))],
    beginTransaction: () => client.query("BEGIN"),
    commit: () => client.query("COMMIT"),
    rollback: () => client.query("ROLLBACK").catch(() => {}),
    release,
  });
  pool = {
    query: async (sql, params = []) => [shape(await pgPool.query(toPgPlaceholders(sql), params))],
    getConnection: async () => { const client = await pgPool.connect(); return wrap(client, () => client.release()); },
    end: () => pgPool.end(),
  };
} else {
  const mysql = (await import("mysql2/promise")).default;
  pool = mysql.createPool({ ...DB, waitForConnections: true, connectionLimit: 10 });
}
export { pool };
export const q = async (sql, params = []) => (await pool.query(sql, params))[0];
export const closeDb = async () => { try { await pool.end(); } catch { /* already closed */ } };

/* ── dialect helpers ── */
export const sql = {
  /* INSERT … ON DUPLICATE KEY UPDATE / ON CONFLICT DO UPDATE; `keys` = conflict target (Postgres), `update` = columns to refresh */
  upsert: (table, cols, nRows, keys, update = cols.filter((c) => !keys.includes(c))) => {
    const row = `(${cols.map(() => "?").join(",")})`;
    const values = Array.from({ length: nRows }, () => row).join(",");
    if (isPostgres) return `INSERT INTO ${table} (${cols.join(",")}) VALUES ${values} ON CONFLICT (${keys.join(",")}) DO UPDATE SET ${update.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}`;
    return `INSERT INTO ${table} (${cols.join(",")}) VALUES ${values} ON DUPLICATE KEY UPDATE ${update.map((c) => `${c} = VALUES(${c})`).join(", ")}`;
  },
  insertIgnore: (table, cols, nRows = 1) => {
    const values = Array.from({ length: nRows }, () => `(${cols.map(() => "?").join(",")})`).join(",");
    return isPostgres ? `INSERT INTO ${table} (${cols.join(",")}) VALUES ${values} ON CONFLICT DO NOTHING` : `INSERT IGNORE INTO ${table} (${cols.join(",")}) VALUES ${values}`;
  },
  like: isPostgres ? "ILIKE" : "LIKE",                                   /* MariaDB's default collation compares case-insensitively */
  int: (ph = "?") => (isPostgres ? `${ph}::int` : ph),                     /* typed placeholder where Postgres cannot infer (CASE … THEN ?) */
  text: (ph = "?") => (isPostgres ? `${ph}::text` : ph),
  jsonContains: (col) => (isPostgres ? `(${col}::jsonb @> to_jsonb(?::text))` : `JSON_CONTAINS(${col}, JSON_QUOTE(?))`),   /* scalar member of a JSON array */
  jsonSetText: (col, key) => (isPostgres ? `jsonb_set(COALESCE(${col}, '{}')::jsonb, '{${key}}', to_jsonb(?::text))::text` : `JSON_SET(COALESCE(${col}, '{}'), '$.${key}', ?)`),
  /* full-text search over search_text: MariaDB boolean mode vs tsvector prefix query; returns { sql, params } for `limit` hits */
  search: (table, term, limit) => {
    const words = String(term).trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[+\-<>()~*"@&|!:'\\]/g, "")).filter(Boolean);
    if (!words.length) return null;
    if (isPostgres) {
      const tsq = words.map((w) => `${w}:*`).join(" & ");
      return { sql: `SELECT id, name, data, ts_rank(search_tsv, to_tsquery('simple', ?)) AS score FROM ${table} WHERE search_tsv @@ to_tsquery('simple', ?) ORDER BY score DESC LIMIT ?`, params: [tsq, tsq, limit] };
    }
    const boolean = words.map((w) => `+${w}*`).join(" ");
    return { sql: `SELECT id, name, data, MATCH(search_text) AGAINST (? IN BOOLEAN MODE) AS score FROM ${table} WHERE MATCH(search_text) AGAINST (? IN BOOLEAN MODE) ORDER BY score DESC LIMIT ?`, params: [boolean, boolean, limit] };
  },
};

/* ── DDL: written once in MariaDB syntax, translated for Postgres ── */
const splitTop = (s) => { const out = []; let depth = 0, cur = ""; for (const ch of s) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch; } if (cur.trim()) out.push(cur); return out.map((x) => x.trim()); };
export const translateCreateTable = (ddl) => {
  const m = ddl.match(/^\s*CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*)\)\s*(?:CHARACTER SET \w+)?\s*$/i);
  if (!m) return [ddl];
  const [, table, body] = m;
  const cols = [], after = [];
  for (let item of splitTop(body)) {
    const idx = item.match(/^(FULLTEXT|INDEX|KEY)\s*\((.*)\)$/i);
    if (idx) {
      const colsList = idx[2].replace(/\(\d+\)/g, "").split(",").map((c) => c.trim());
      const name = `${table}_${colsList.join("_")}_idx`.slice(0, 60);
      if (/^FULLTEXT$/i.test(idx[1])) {
        cols.push(`search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', regexp_replace(coalesce(${colsList[0]}, ''), '[._/:@\\\\]+', ' ', 'g'))) STORED`);
        after.push(`CREATE INDEX IF NOT EXISTS ${table}_tsv_idx ON ${table} USING GIN (search_tsv)`);
      } else after.push(`CREATE INDEX IF NOT EXISTS ${name} ON ${table} (${colsList.join(", ")})`);
      continue;
    }
    item = item.replace(/\bBIGINT\s+AUTO_INCREMENT\s+PRIMARY KEY\b/i, "BIGSERIAL PRIMARY KEY").replace(/\bTINYINT\b/gi, "SMALLINT").replace(/\b(MEDIUMTEXT|LONGTEXT)\b/gi, "TEXT")
      .replace(/\bLONGBLOB\b/gi, "BYTEA").replace(/\bJSON\b/gi, "JSONB").replace(/\bDATETIME\b/gi, "TIMESTAMP");
    cols.push(item);
  }
  return [`CREATE TABLE IF NOT EXISTS ${table} (${cols.join(", ")})`, ...after];
};
const ddl = async (statement) => { for (const s of isPostgres ? translateCreateTable(statement) : [statement]) await q(s); };
/* idempotent column additions (both engines know ADD COLUMN IF NOT EXISTS; the try/catch keeps older MariaDB happy) */
const addColumns = async (table, spec) => {
  const s = spec.replace(/ADD COLUMN\s+(?!IF NOT EXISTS)/gi, "ADD COLUMN IF NOT EXISTS ");
  try { await q(`ALTER TABLE ${table} ${s}`); } catch { try { await q(`ALTER TABLE ${table} ${spec}`); } catch { /* column exists */ } }
};

export const initDb = async () => {
  if (isPostgres) { try { await q("CREATE EXTENSION IF NOT EXISTS pg_trgm"); } catch { /* optional: substring search falls back to ILIKE */ } }
  await ddl(`CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(32) PRIMARY KEY, name VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL UNIQUE,
    role VARCHAR(16) NOT NULL, password_hash VARCHAR(512) NOT NULL,
    totp_secret VARCHAR(64) NULL, totp_pending VARCHAR(64) NULL, totp_enabled TINYINT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL) CHARACTER SET utf8mb4`);
  await ddl(`CREATE TABLE IF NOT EXISTS settings (k VARCHAR(64) PRIMARY KEY, v TEXT NOT NULL, updated_ts BIGINT NOT NULL, updated_by VARCHAR(255)) CHARACTER SET utf8mb4`);
  await ddl(`CREATE TABLE IF NOT EXISTS sessions (
    token VARCHAR(64) PRIMARY KEY, user_id VARCHAR(32) NOT NULL, expires BIGINT NOT NULL, INDEX (user_id)) CHARACTER SET utf8mb4`);
  await ddl(`CREATE TABLE IF NOT EXISTS invites (
    token VARCHAR(64) PRIMARY KEY, email VARCHAR(255) NOT NULL, role VARCHAR(16) NOT NULL,
    invited_by VARCHAR(32), expires BIGINT NOT NULL) CHARACTER SET utf8mb4`);
  /* v1.67: password-reset links (admin-issued or "forgot password" by e-mail); token = SHA-256 of the link's token */
  await ddl(`CREATE TABLE IF NOT EXISTS password_resets (
    token VARCHAR(64) PRIMARY KEY, user_id VARCHAR(32) NOT NULL, expires BIGINT NOT NULL, created_by VARCHAR(32) NULL, created_ts BIGINT NOT NULL, INDEX (user_id)) CHARACTER SET utf8mb4`);
  await ddl(`CREATE TABLE IF NOT EXISTS catalog_doc (
    id TINYINT PRIMARY KEY, version BIGINT NOT NULL, data LONGTEXT NOT NULL,
    updated_at BIGINT NOT NULL, updated_by VARCHAR(255)) CHARACTER SET utf8mb4`);
  /* v1.14 relational catalog: one row per object (indexed keys + JSON payload + FULLTEXT search text) */
  for (const [tbl, parent] of Object.entries(CAT_TABLES)) {
    await ddl(`CREATE TABLE IF NOT EXISTS ${tbl} (
      id VARCHAR(64) PRIMARY KEY, ${parent ? `${parent} VARCHAR(64) NULL, ` : ""}name VARCHAR(512) NULL, seq INT NOT NULL DEFAULT 0,
      data JSON NOT NULL, search_text TEXT NULL, updated_at BIGINT NOT NULL,
      ${parent ? `INDEX (${parent}), ` : ""}INDEX (name(191)), FULLTEXT (search_text)) CHARACTER SET utf8mb4`);
  }
  if (isPostgres) { try { await q("CREATE INDEX IF NOT EXISTS cat_attributes_name_trgm_idx ON cat_attributes USING GIN (name gin_trgm_ops)"); } catch { /* pg_trgm not available: ILIKE scans */ } }
  await ddl(`CREATE TABLE IF NOT EXISTS catalog_meta (
    id TINYINT PRIMARY KEY, version BIGINT NOT NULL, extra JSON NULL, updated_at BIGINT NOT NULL, updated_by VARCHAR(255)) CHARACTER SET utf8mb4`);
  await ddl(`CREATE TABLE IF NOT EXISTS agent_keys (
    id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36) NOT NULL, name VARCHAR(255) NOT NULL, key_hash CHAR(64) NOT NULL, prefix VARCHAR(12) NOT NULL,
    created_by VARCHAR(255) NOT NULL, created_ts BIGINT NOT NULL, last_used_ts BIGINT NULL, revoked_ts BIGINT NULL,
    INDEX (user_id), INDEX (key_hash)) CHARACTER SET utf8mb4`);
  await ddl(`CREATE TABLE IF NOT EXISTS request_files (
    id VARCHAR(36) PRIMARY KEY, request_id VARCHAR(36) NOT NULL, name VARCHAR(255) NOT NULL, mime VARCHAR(255) NOT NULL, size INT NOT NULL,
    data LONGBLOB NOT NULL, uploaded_by VARCHAR(255) NOT NULL, ts BIGINT NOT NULL, INDEX (request_id)) CHARACTER SET utf8mb4`);
  await ddl(`CREATE TABLE IF NOT EXISTS glossary_files (
    id VARCHAR(36) PRIMARY KEY, term_id VARCHAR(32) NOT NULL, name VARCHAR(512) NOT NULL,
    mime VARCHAR(255), size INT NOT NULL, data LONGBLOB NOT NULL,
    uploaded_by VARCHAR(255), ts BIGINT NOT NULL, INDEX (term_id)) CHARACTER SET utf8mb4`);
  await ddl(`CREATE TABLE IF NOT EXISTS marketplace_requests (
    id VARCHAR(36) PRIMARY KEY, kind VARCHAR(16) NOT NULL, product_ref VARCHAR(64) NULL, product_label VARCHAR(512) NULL,
    name VARCHAR(255) NULL, hub VARCHAR(255) NULL, purpose TEXT NOT NULL, tag_key VARCHAR(255) NULL, tag_value VARCHAR(512) NULL,
    table_ids TEXT NULL, requested_by VARCHAR(255) NOT NULL, requester_name VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'open', ts BIGINT NOT NULL, decided_by VARCHAR(255) NULL, decided_ts BIGINT NULL,
    INDEX (requested_by), INDEX (status)) CHARACTER SET utf8mb4`);
  if (!isPostgres) { try { await q("ALTER TABLE marketplace_requests MODIFY status VARCHAR(32) NOT NULL DEFAULT 'open'"); } catch { /* already widened */ } }
  await ddl(`CREATE TABLE IF NOT EXISTS messages (
    id VARCHAR(36) PRIMARY KEY, to_email VARCHAR(255) NOT NULL, from_name VARCHAR(255) NOT NULL, subject VARCHAR(512) NOT NULL,
    body TEXT NOT NULL, request_id VARCHAR(36) NULL, table_id VARCHAR(64) NULL, ts BIGINT NOT NULL, read_ts BIGINT NULL,
    INDEX (to_email), INDEX (ts)) CHARACTER SET utf8mb4`);
  /* columns added over the releases — applied AFTER every CREATE so a fresh install gets them on the first start */
  await addColumns("users", "ADD COLUMN roles VARCHAR(255) NULL");
  await addColumns("users", "ADD COLUMN sso_sub VARCHAR(255) NULL, ADD COLUMN lang VARCHAR(8) NULL");
  await addColumns("users", "ADD COLUMN totp_last_counter BIGINT NULL");   /* v1.66.1: TOTP replay protection */
  await addColumns("invites", "ADD COLUMN roles VARCHAR(255) NULL");
  await addColumns("agent_keys", "ADD COLUMN scope VARCHAR(8) NOT NULL DEFAULT 'write'");
  for (const spec of [
    "ADD COLUMN reason TEXT NULL, ADD COLUMN updated_ts BIGINT NULL",
    "ADD COLUMN history_json TEXT NULL",
    "ADD COLUMN advanced_json TEXT NULL, ADD COLUMN sourcing_json TEXT NULL",
    "ADD COLUMN project VARCHAR(255) NULL",
    "ADD COLUMN use_case VARCHAR(255) NULL",
    "ADD COLUMN ingestion_json TEXT NULL",
    "ADD COLUMN refine_json TEXT NULL, ADD COLUMN dev_json TEXT NULL",
    "ADD COLUMN refined_json TEXT NULL, ADD COLUMN uat_json TEXT NULL, ADD COLUMN sit_json TEXT NULL, ADD COLUMN release_json TEXT NULL",
    "ADD COLUMN approval_json TEXT NULL",
  ]) await addColumns("marketplace_requests", spec);
  await ddl(`CREATE TABLE IF NOT EXISTS audit (
    id VARCHAR(36) PRIMARY KEY, ts BIGINT NOT NULL, user_json TEXT NOT NULL,
    action VARCHAR(24) NOT NULL, entity_type VARCHAR(24) NOT NULL, entity_id VARCHAR(128) NOT NULL,
    name VARCHAR(768), context VARCHAR(768), scope_json TEXT,
    changes_json MEDIUMTEXT NULL, before_json MEDIUMTEXT NULL, after_json MEDIUMTEXT NULL,
    INDEX (ts), INDEX (entity_type), INDEX (entity_id)) CHARACTER SET utf8mb4`);
  /* v1.56: mirrored background jobs (survive restarts) and the backup catalogue */
  await ddl(`CREATE TABLE IF NOT EXISTS jobs (
    id VARCHAR(36) PRIMARY KEY, kind VARCHAR(24) NOT NULL, status VARCHAR(24) NOT NULL, phase VARCHAR(24) NOT NULL,
    file_name VARCHAR(255), by_email VARCHAR(255), user_json TEXT, started_at BIGINT NOT NULL, finished_at BIGINT NULL, updated_at BIGINT NOT NULL,
    data MEDIUMTEXT, INDEX (started_at)) CHARACTER SET utf8mb4`);
  await ddl(`CREATE TABLE IF NOT EXISTS backups (
    id VARCHAR(36) PRIMARY KEY, created_at BIGINT NOT NULL, kind VARCHAR(16) NOT NULL, file_name VARCHAR(255) NOT NULL, sql_file VARCHAR(255) NULL,
    size_bytes BIGINT NOT NULL DEFAULT 0, sql_size_bytes BIGINT NOT NULL DEFAULT 0, catalog_version BIGINT NOT NULL DEFAULT 0, counts_json TEXT, by_email VARCHAR(255),
    verified_at BIGINT NULL, verify_json TEXT NULL, INDEX (created_at)) CHARACTER SET utf8mb4`);
  /* v1.58: OAuth 2.1 for MCP clients */
  await ddl(`CREATE TABLE IF NOT EXISTS oauth_clients (
    id VARCHAR(40) PRIMARY KEY, name VARCHAR(200) NOT NULL, secret_hash VARCHAR(128) NULL, redirect_uris TEXT NOT NULL, auth_method VARCHAR(32) NOT NULL DEFAULT 'none',
    client_uri VARCHAR(500) NULL, created_ts BIGINT NOT NULL, created_ip VARCHAR(64) NULL) CHARACTER SET utf8mb4`);
  await ddl(`CREATE TABLE IF NOT EXISTS oauth_codes (
    code_hash VARCHAR(128) PRIMARY KEY, client_id VARCHAR(40) NOT NULL, user_id VARCHAR(36) NOT NULL, redirect_uri VARCHAR(1000) NOT NULL, scope VARCHAR(200) NOT NULL,
    code_challenge VARCHAR(128) NOT NULL, expires BIGINT NOT NULL, INDEX (expires)) CHARACTER SET utf8mb4`);
  await ddl(`CREATE TABLE IF NOT EXISTS oauth_tokens (
    id VARCHAR(36) PRIMARY KEY, client_id VARCHAR(40) NOT NULL, user_id VARCHAR(36) NOT NULL, scope VARCHAR(200) NOT NULL, access_hash VARCHAR(128) NOT NULL, refresh_hash VARCHAR(128) NOT NULL,
    access_expires BIGINT NOT NULL, refresh_expires BIGINT NOT NULL, created_ts BIGINT NOT NULL, last_used_ts BIGINT NULL, revoked_ts BIGINT NULL, revoked_reason VARCHAR(32) NULL,
    INDEX (access_hash), INDEX (refresh_hash), INDEX (user_id), INDEX (client_id)) CHARACTER SET utf8mb4`);
  /* v1.58: collaboration — comments/questions, ratings, usage events */
  await ddl(`CREATE TABLE IF NOT EXISTS comments (
    id VARCHAR(36) PRIMARY KEY, entity_type VARCHAR(24) NOT NULL, entity_id VARCHAR(64) NOT NULL, parent_id VARCHAR(36) NULL, kind VARCHAR(16) NOT NULL DEFAULT 'comment',
    body TEXT NOT NULL, by_email VARCHAR(255) NOT NULL, by_name VARCHAR(255) NOT NULL, ts BIGINT NOT NULL, edited_ts BIGINT NULL, resolved_ts BIGINT NULL, resolved_by VARCHAR(255) NULL,
    INDEX (entity_type, entity_id), INDEX (parent_id), INDEX (by_email)) CHARACTER SET utf8mb4`);
  await ddl(`CREATE TABLE IF NOT EXISTS ratings (
    entity_type VARCHAR(24) NOT NULL, entity_id VARCHAR(64) NOT NULL, by_email VARCHAR(255) NOT NULL, stars TINYINT NOT NULL, ts BIGINT NOT NULL,
    PRIMARY KEY (entity_type, entity_id, by_email)) CHARACTER SET utf8mb4`);
  await ddl(`CREATE TABLE IF NOT EXISTS usage_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, ts BIGINT NOT NULL, kind VARCHAR(16) NOT NULL, entity_type VARCHAR(24) NULL, entity_id VARCHAR(64) NULL, term VARCHAR(200) NULL, by_email VARCHAR(255) NULL,
    INDEX (ts), INDEX (kind, entity_type, entity_id), INDEX (kind, term)) CHARACTER SET utf8mb4`);
  await migrateJsonStore();
};

/* one-time migration from the JSON store of versions <= 1.2 */
const migrateJsonStore = async () => {
  const [{ n }] = await q("SELECT COUNT(*) AS n FROM users");
  const jsonPath = path.join(DATA_DIR, "db.json");
  if (Number(n) !== 0 || !fs.existsSync(jsonPath)) return;
  try {
    const old = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    for (const u of old.users || []) {
      await q(sql.insertIgnore("users", ["id", "name", "email", "role", "password_hash", "totp_secret", "totp_enabled", "created_at"]),
        [u.id, u.name, u.email, u.role, u.passwordHash, u.totpSecret || null, u.totpEnabled ? 1 : 0, u.createdAt || Date.now()]);
    }
    for (const i of old.invites || []) {
      await q(sql.insertIgnore("invites", ["token", "email", "role", "invited_by", "expires"]), [i.token, i.email, i.role, i.invitedBy || null, i.expires]);
    }
    if (old.catalog) {
      await q(sql.insertIgnore("catalog_doc", ["id", "version", "data", "updated_at", "updated_by"]), [1, 1, JSON.stringify(old.catalog), Date.now(), "migration"]);
    }
    for (const e of old.audit || []) {
      await q(sql.insertIgnore("audit", ["id", "ts", "user_json", "action", "entity_type", "entity_id", "name", "context", "scope_json", "changes_json", "before_json", "after_json"]),
        [e.id, e.ts, JSON.stringify(e.user || {}), e.action, e.entityType, String(e.entityId || ""), e.name || "", e.context || "",
         JSON.stringify(e.scope || []), e.changes ? JSON.stringify(e.changes) : null,
         e.before ? JSON.stringify(e.before) : null, e.after ? JSON.stringify(e.after) : null]);
    }
    fs.renameSync(jsonPath, jsonPath + ".migrated");
    console.log(`Migrated JSON store to ${DRIVER} (${(old.users || []).length} users, ${(old.audit || []).length} audit entries)`);
  } catch (e) { console.error("JSON migration failed:", e.message); }
};
