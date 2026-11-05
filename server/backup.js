/* Automated backups (v1.56): a gzip'd catalog dump (the same document as GET /admin/dump) written to BACKUP_DIR on a
   daily schedule and on demand, plus — when the mysqldump binary is available — a full SQL dump of the database
   (users, sessions, marketplace requests, messages, audit, …). Retention keeps the newest N automatic backups.
   Verification ("restore drill") re-reads a backup, checks its structure and compares its record counts with the
   live catalog; a real restore replays the backup through the normal restore job. */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";
import { spawn } from "child_process";
import { pipeline } from "stream/promises";
import { PassThrough } from "stream";
import os from "os";
import { q, isPostgres } from "./db.js";
import { storage, storageInfo, BACKUP_DIR, STORAGE } from "./storage.js";
import { getSetting, setSetting } from "./settings.js";

import { COLL } from "./catalog-tables.js";
import { systemActor } from "./config.js";
import { sysAudit } from "./audit.js";
import { writeDumpTo, dumpSource } from "./dump.js";
import { dailyAt } from "./schedule.js";

export { BACKUP_DIR, storageInfo };
/* where a new backup file is written before it is handed to the storage provider (local: directly in BACKUP_DIR) */
const writeTarget = (name) => (STORAGE === "local" ? path.join(BACKUP_DIR, name) : path.join(os.tmpdir(), `cortex-backup-${crypto.randomBytes(4).toString("hex")}-${name}`));
const store = async (name, file) => { try { return (await storage.put(name, file)).size; } finally { if (STORAGE !== "local") await fs.promises.unlink(file).catch(() => {}); } };
const readAll = async (name) => { const chunks = []; for await (const c of (await storage.get(name)).pipe(zlib.createGunzip())) chunks.push(c); return Buffer.concat(chunks); };
const DEFAULTS = { enabled: false, time: "02:30", keep: 14, sql: true };
const SYSTEM = systemActor("Scheduled backup");

export const backupSettings = async () => {
  const s = await getSetting("backup.settings", {});
  return { ...DEFAULTS, ...(s && typeof s === "object" ? s : {}) };
};
export const saveBackupSettings = async (patch, user) => {
  const cur = await backupSettings();
  const next = { ...cur, ...patch };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(next.time))) throw Object.assign(new Error("time must be HH:MM (24 h)"), { status: 400 });
  next.keep = Math.max(1, Math.min(365, Number(next.keep) || DEFAULTS.keep));
  next.enabled = !!next.enabled; next.sql = !!next.sql;
  await setSetting("backup.settings", next, user);
  return next;
};

const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const which = (bin) => (process.env.PATH || "").split(path.delimiter).map((p) => path.join(p, bin)).find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
/* SQL dump of the whole database: mysqldump / mariadb-dump on MariaDB, pg_dump on Postgres (gzip'd, restore with
   `gunzip -c file | mysql db` or `gunzip -c file | psql db`) */
const dumpBin = () => (isPostgres ? which("pg_dump") : (which("mysqldump") || which("mariadb-dump")));
export const mysqldumpAvailable = () => !!dumpBin();
export const sqlDumpTool = () => (isPostgres ? "pg_dump" : "mysqldump");

const runMysqldump = (file) => new Promise((resolve, reject) => {
  const bin = dumpBin();
  if (!bin) return reject(new Error(`${sqlDumpTool()} not found`));
  const host = process.env.DB_HOST || "127.0.0.1", user = process.env.DB_USER || "datahub", db = process.env.DB_NAME || "datahub_catalog";
  const args = isPostgres
    ? ["--no-owner", "--no-privileges", `--host=${host}`, `--port=${process.env.DB_PORT || 5432}`, `--username=${user}`, db]
    : ["--single-transaction", "--quick", "--skip-routines", "--skip-triggers", `--host=${host}`, `--port=${process.env.DB_PORT || 3306}`, `--user=${user}`, db];
  const env = isPostgres ? { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || "" } : { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || "" };
  const child = spawn(bin, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let err = "", code = null, piped = false;
  const finish = () => {
    if (code === null || !piped) return;
    if (code === 0) resolve(fs.statSync(file).size); else reject(new Error(`${sqlDumpTool()} exited with ${code}: ${err.trim().slice(0, 300)}`));
  };
  child.stderr.on("data", (d) => { err += d.toString(); });
  child.on("error", reject);
  child.on("close", (c) => { code = c; finish(); });
  pipeline(child.stdout, zlib.createGzip({ level: 6 }), fs.createWriteStream(file)).then(() => { piped = true; finish(); }).catch(reject);
});

const rowOf = (r) => ({ id: r.id, createdAt: Number(r.created_at), kind: r.kind, fileName: r.file_name, sqlFile: r.sql_file, size: Number(r.size_bytes), sqlSize: Number(r.sql_size_bytes),
  catalogVersion: Number(r.catalog_version), counts: r.counts_json ? JSON.parse(r.counts_json) : null, by: r.by_email,
  verifiedAt: r.verified_at == null ? null : Number(r.verified_at), verify: r.verify_json ? JSON.parse(r.verify_json) : null });
export const listBackups = async () => (await q("SELECT * FROM backups ORDER BY created_at DESC")).map(rowOf);
export const getBackup = async (id) => { const rows = await q("SELECT * FROM backups WHERE id = ?", [id]); return rows.length ? rowOf(rows[0]) : null; };
/* a local file for the backup (restore job, gunzip): the file itself on local storage, a temp download otherwise */
export const backupLocal = (b, sql = false) => storage.toLocal(sql ? b.sqlFile : b.fileName);
export const backupStream = (b, sql = false) => storage.get(sql ? b.sqlFile : b.fileName);
export const backupExists = async (b, sql = false) => !!(await storage.stat(sql ? b.sqlFile : b.fileName));

/* writes one backup set; `kind` is "auto" (scheduler) or "manual" */
let running = null;
export const runBackup = async (user = SYSTEM, kind = "manual") => {
  if (running) return running;
  running = (async () => {
    if (STORAGE === "local") await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
    const settings = await backupSettings();
    const id = crypto.randomUUID();
    const base = `cortex-backup-${stamp()}`;
    const fileName = `${base}.json.gz`;
    const { catalog, version, attributes } = await dumpSource();
    const users = await q("SELECT id,name,email,role,totp_enabled FROM users");
    const pass = new PassThrough();
    const target = writeTarget(fileName);
    const done = pipeline(pass, zlib.createGzip({ level: 6 }), fs.createWriteStream(target));
    let attrCount = 0;
    const counted = async function* () { for await (const chunk of attributes) { attrCount += chunk.length; yield chunk; } };
    await writeDumpTo(pass, { catalog, version, users, attributes: catalog ? counted() : null });
    pass.end();
    await done;
    const size = await store(fileName, target);
    const counts = Object.fromEntries(COLL.map(([key]) => [key, key === "attributes" ? attrCount : (catalog?.[key] || []).length]));
    let sqlFile = null, sqlSize = 0, warning = null;
    if (settings.sql && mysqldumpAvailable()) {
      sqlFile = `${base}.sql.gz`;
      const sqlTarget = writeTarget(sqlFile);
      try { await runMysqldump(sqlTarget); sqlSize = await store(sqlFile, sqlTarget); }
      catch (e) { warning = `SQL dump skipped: ${e.message}`; fs.promises.unlink(sqlTarget).catch(() => {}); await storage.delete(sqlFile); sqlFile = null; }
    }
    await q("INSERT INTO backups (id, created_at, kind, file_name, sql_file, size_bytes, sql_size_bytes, catalog_version, counts_json, by_email) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [id, Date.now(), kind, fileName, sqlFile, size, sqlSize, version, JSON.stringify(counts), user.email]);
    await sysAudit(user, "system", "exported", `${kind} backup ${fileName}${sqlFile ? " + SQL dump" : ""}${warning ? ` (${warning})` : ""}`);
    await applyRetention(settings.keep);
    return { ...(await getBackup(id)), warning };
  })();
  try { return await running; } finally { running = null; }
};

/* newest `keep` automatic backups survive; manual ones are deleted by hand */
export const applyRetention = async (keep) => {
  const autos = (await listBackups()).filter((b) => b.kind === "auto");
  for (const b of autos.slice(Math.max(1, Number(keep) || DEFAULTS.keep))) await deleteBackup(b.id);
};
export const deleteBackup = async (id) => {
  const b = await getBackup(id);
  if (!b) return false;
  for (const f of [b.fileName, b.sqlFile].filter(Boolean)) await storage.delete(f);
  await q("DELETE FROM backups WHERE id = ?", [id]);
  return true;
};

/* reads a backup document (gunzip + parse) */
export const readBackupDocument = async (b) => JSON.parse((await readAll(b.fileName)).toString("utf8"));

/* restore drill: is the file readable and structurally complete, and how does it compare with the live catalog? */
export const verifyBackup = async (id, user = SYSTEM) => {
  const b = await getBackup(id);
  if (!b) throw Object.assign(new Error("Unknown backup"), { status: 404 });
  const result = { ok: false, checks: [], counts: null, live: null, drift: null, sql: null };
  const t0 = Date.now();
  try {
    const stat = await storage.stat(b.fileName);
    if (!stat) throw new Error(`${b.fileName} is missing on ${storage.describe()}`);
    result.checks.push({ name: "file", ok: true, detail: `${stat.size.toLocaleString()} bytes on ${storage.describe()}` });
    const d = await readBackupDocument(b);
    const okFormat = d?.format === "datahub-catalog-dump" && d.catalog && Array.isArray(d.catalog.databases);
    result.checks.push({ name: "format", ok: okFormat, detail: okFormat ? `dump v${d.version}, catalog version ${d.catalogVersion}, ${(d.users || []).length} users` : "not a catalog dump" });
    if (okFormat) {
      const counts = Object.fromEntries(COLL.map(([key]) => [key, (d.catalog[key] || []).length]));
      const live = {};
      for (const [key, tbl] of COLL) live[key] = Number((await q(`SELECT COUNT(*) AS n FROM ${tbl}`))[0].n);
      result.counts = counts; result.live = live;
      result.drift = Object.fromEntries(COLL.map(([key]) => [key, live[key] - counts[key]]).filter(([, n]) => n !== 0));
      /* referential integrity of the document itself */
      const ids = (k) => new Set((d.catalog[k] || []).map((x) => x.id));
      const dbIds = ids("databases"), scIds = ids("schemas"), tbIds = ids("tables");
      const orphans = (d.catalog.schemas || []).filter((s) => !dbIds.has(s.databaseId)).length + (d.catalog.tables || []).filter((t) => !scIds.has(t.schemaId)).length + (d.catalog.attributes || []).filter((a) => !tbIds.has(a.tableId)).length;
      result.checks.push({ name: "integrity", ok: orphans === 0, detail: orphans ? `${orphans} orphaned records` : "every schema, table and attribute has its parent" });
      result.checks.push({ name: "counts", ok: true, detail: Object.keys(result.drift).length ? `live catalog differs: ${Object.entries(result.drift).map(([k, n]) => `${k} ${n > 0 ? "+" : ""}${n}`).join(", ")}` : "matches the live catalog" });
    }
    if (b.sqlFile) {
      try {
        const buf = await readAll(b.sqlFile);
        const tail = buf.subarray(Math.max(0, buf.length - 400)).toString("utf8");
        const complete = /Dump completed|database dump complete/.test(tail);   /* mysqldump / pg_dump trailers */
        result.sql = { ok: complete, size: buf.length, tables: (buf.toString("utf8", 0, Math.min(buf.length, 4 << 20)).match(/CREATE TABLE/g) || []).length };
        result.checks.push({ name: "sql", ok: complete, detail: complete ? `SQL dump complete (${result.sql.tables} tables)` : "SQL dump is truncated" });
      } catch (e) { result.checks.push({ name: "sql", ok: false, detail: e.message }); }
    }
    result.ok = result.checks.every((c) => c.ok);
  } catch (e) {
    result.checks.push({ name: "read", ok: false, detail: e.message });
  }
  result.ms = Date.now() - t0;
  await q("UPDATE backups SET verified_at = ?, verify_json = ? WHERE id = ?", [Date.now(), JSON.stringify(result), id]);
  await sysAudit(user, "system", result.ok ? "verified" : "failed", `restore drill ${b.fileName}: ${result.checks.map((c) => `${c.name} ${c.ok ? "ok" : "FAILED"}`).join(", ")}`);
  return { ...b, verifiedAt: Date.now(), verify: result };
};


/* registered as task "backup" by server.js (v1.70) */
export const BACKUP_TASK = { description: "Catalog backup (+ SQL dump when enabled) with retention",
  schedule: async () => { const bs = await backupSettings(); return bs.enabled ? `daily ${bs.time}` : "disabled"; },
  run: async (user) => { const b = await runBackup(user, "auto"); return { file: b.fileName, size: b.size, sqlFile: b.sqlFile, warning: b.warning || null }; },
  /* v1.73 (F-S9, server/tasks.js scheduler): when enabled, once a day from the configured local time on */
  due: async (now, lastAt) => { const s = await backupSettings(); return !!s.enabled && dailyAt(s.time, now, lastAt); },
  actor: SYSTEM, logLine: () => "Scheduled backup written" };
