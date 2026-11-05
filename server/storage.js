/* Blob storage for backups (v1.59, PLAN.md item 4): the same five operations over a local directory, an
   S3-compatible bucket (AWS, MinIO — SigV4, no SDK), an Azure Blob container (SAS URL) or a Unity Catalog Volume
   (Databricks Files API with the app's service principal). Selected with BACKUP_STORAGE=local|s3|azure|databricks.
     put(name, source)   source = local file path | Buffer | Readable      → { size }
     get(name)           → Readable
     stat(name)          → { size } | null
     delete(name)
     toLocal(name)       → { path, cleanup() }   a local file for code that needs a path (restore job, gunzip)
   Streams are spooled through a temp file for the remote providers so uploads carry a Content-Length. */
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { DATA_DIR } from "./config.js";
import { databricksBearer, databricksHost } from "./databricks-auth.js";

export const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, "backups");
export const STORAGE = (process.env.BACKUP_STORAGE || "local").toLowerCase();
const tmpFile = (name) => path.join(os.tmpdir(), `cortex-storage-${crypto.randomBytes(6).toString("hex")}-${path.basename(name)}`);
const spool = async (source) => {   /* → { path, size, cleanup } */
  if (typeof source === "string") return { path: source, size: (await fs.promises.stat(source)).size, cleanup: async () => {} };
  const p = tmpFile("spool");
  if (Buffer.isBuffer(source)) await fs.promises.writeFile(p, source); else await pipeline(source, fs.createWriteStream(p));
  return { path: p, size: (await fs.promises.stat(p)).size, cleanup: () => fs.promises.unlink(p).catch(() => {}) };
};
const toStream = (res) => Readable.fromWeb(res.body);

/* ── local directory ── */
const local = {
  describe: () => `local:${BACKUP_DIR}`,
  put: async (name, source) => {
    await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
    const dest = path.join(BACKUP_DIR, name);
    if (typeof source === "string") { if (path.resolve(source) !== path.resolve(dest)) await fs.promises.copyFile(source, dest); }
    else if (Buffer.isBuffer(source)) await fs.promises.writeFile(dest, source);
    else await pipeline(source, fs.createWriteStream(dest));
    return { size: (await fs.promises.stat(dest)).size };
  },
  get: async (name) => { const p = path.join(BACKUP_DIR, name); await fs.promises.access(p); return fs.createReadStream(p); },
  stat: async (name) => { try { return { size: (await fs.promises.stat(path.join(BACKUP_DIR, name))).size }; } catch { return null; } },
  delete: (name) => fs.promises.unlink(path.join(BACKUP_DIR, name)).catch(() => {}),
  toLocal: async (name) => ({ path: path.join(BACKUP_DIR, name), cleanup: async () => {} }),
  localPath: (name) => path.join(BACKUP_DIR, name),
};

/* ── remote providers share the spool/toLocal plumbing; each implements request(method, name, body?, headers?) ── */
const remote = (impl) => ({
  describe: impl.describe,
  put: async (name, source) => {
    const s = await spool(source);
    try { const r = await impl.request("PUT", name, fs.createReadStream(s.path), { "Content-Length": String(s.size), "Content-Type": "application/octet-stream" }); if (!r.ok) throw new Error(`${impl.describe()}: upload ${name} failed (HTTP ${r.status})`); return { size: s.size }; }
    finally { await s.cleanup(); }
  },
  get: async (name) => { const r = await impl.request("GET", name); if (!r.ok) throw new Error(`${impl.describe()}: ${name} not found (HTTP ${r.status})`); return toStream(r); },
  stat: async (name) => { const r = await impl.request("HEAD", name); if (!r.ok) return null; const n = Number(r.headers.get("content-length")); return { size: Number.isFinite(n) ? n : 0 }; },
  delete: async (name) => { await impl.request("DELETE", name).catch(() => {}); },
  toLocal: async (name) => { const p = tmpFile(name); const r = await impl.request("GET", name); if (!r.ok) throw new Error(`${impl.describe()}: ${name} not found (HTTP ${r.status})`); await pipeline(toStream(r), fs.createWriteStream(p)); return { path: p, cleanup: () => fs.promises.unlink(p).catch(() => {}) }; },
});

/* S3 / MinIO: S3_BUCKET, S3_PREFIX, S3_REGION, S3_ENDPOINT (optional, path-style), S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY */
const sha256 = (d) => crypto.createHash("sha256").update(d).digest("hex");
const hmac = (k, d, enc) => crypto.createHmac("sha256", k).update(d).digest(enc);
export const s3Sign = ({ method, host, pathName, query = "", headers, payloadHash, region, service = "s3", accessKey, secretKey, now = new Date() }) => {
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"), date = amzDate.slice(0, 8);
  const h = { ...headers, host, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash };
  const signedNames = Object.keys(h).map((k) => k.toLowerCase()).sort();
  const canonicalHeaders = signedNames.map((k) => `${k}:${String(h[Object.keys(h).find((x) => x.toLowerCase() === k)]).trim()}\n`).join("");
  const canonical = [method, pathName, query, canonicalHeaders, signedNames.join(";"), payloadHash].join("\n");
  const scope = `${date}/${region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const kSig = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, date), region), service), "aws4_request");
  const signature = hmac(kSig, toSign, "hex");
  return { ...h, Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedNames.join(";")}, Signature=${signature}` };
};
const s3 = () => {
  const bucket = process.env.S3_BUCKET, region = process.env.S3_REGION || "us-east-1", prefix = String(process.env.S3_PREFIX || "").replace(/^\/|\/$/g, "");
  const endpoint = process.env.S3_ENDPOINT ? process.env.S3_ENDPOINT.replace(/\/$/, "") : `https://${bucket}.s3.${region}.amazonaws.com`;
  const pathStyle = !!process.env.S3_ENDPOINT;
  const url = (name) => `${endpoint}${pathStyle ? `/${bucket}` : ""}/${[prefix, name].filter(Boolean).map(encodeURIComponent).join("/")}`;
  return remote({
    describe: () => `s3://${bucket}/${prefix}`,
    request: async (method, name, body, headers = {}) => {
      const u = new URL(url(name));
      /* streaming bodies are signed as UNSIGNED-PAYLOAD (accepted over https by S3 and MinIO) */
      const payloadHash = body ? "UNSIGNED-PAYLOAD" : sha256("");
      const signed = s3Sign({ method, host: u.host, pathName: u.pathname, headers, payloadHash, region, accessKey: process.env.S3_ACCESS_KEY_ID, secretKey: process.env.S3_SECRET_ACCESS_KEY });
      return fetch(u, { method, headers: signed, body, duplex: body ? "half" : undefined });
    },
  });
};

/* Azure Blob: AZURE_CONTAINER_SAS_URL = https://<account>.blob.core.windows.net/<container>?<sas> (write/read/delete permissions) */
const azure = () => {
  const sas = new URL(process.env.AZURE_CONTAINER_SAS_URL || "https://invalid.local/");
  const prefix = String(process.env.AZURE_PREFIX || "").replace(/^\/|\/$/g, "");
  return remote({
    describe: () => `azure://${sas.host}${sas.pathname}/${prefix}`,
    request: (method, name, body, headers = {}) => {
      const u = new URL(sas.toString()); u.pathname = `${sas.pathname.replace(/\/$/, "")}/${[prefix, name].filter(Boolean).map(encodeURIComponent).join("/")}`;
      return fetch(u, { method, headers: { ...headers, "x-ms-version": "2021-08-06", ...(method === "PUT" ? { "x-ms-blob-type": "BlockBlob" } : {}) }, body, duplex: body ? "half" : undefined });
    },
  });
};

/* Unity Catalog Volume via the Files API: DATABRICKS_VOLUME_PATH = /Volumes/<catalog>/<schema>/<volume>/<folder> */
const databricks = () => {
  const base = String(process.env.DATABRICKS_VOLUME_PATH || "/Volumes/main/default/cortex").replace(/\/$/, "");
  return remote({
    describe: () => `databricks:${base}`,
    request: async (method, name, body, headers = {}) => {
      const token = await databricksBearer();
      const u = `${databricksHost()}/api/2.0/fs/files${base}/${encodeURIComponent(name)}${method === "PUT" ? "?overwrite=true" : ""}`;
      return fetch(u, { method, headers: { ...headers, Authorization: `Bearer ${token}` }, body, duplex: body ? "half" : undefined });
    },
  });
};

export const storage = STORAGE === "s3" ? s3() : STORAGE === "azure" ? azure() : STORAGE === "databricks" ? databricks() : local;
export const storageInfo = () => ({ provider: STORAGE, location: storage.describe() });
