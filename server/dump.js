/* Catalog dump and restore (v1.70 — moved out of routes/dump.js so backup.js no longer imports a route module):
   runRestore() parses a dump file and writes it through the catalog store as a background job; writeDumpTo() streams
   the dump document collection by collection (the attributes table by table — the full document is never assembled);
   dumpSource() provides the current catalog as dump input. Used by GET/POST /admin/dump and by the backup writer. */
import fs from "fs";
import crypto from "crypto";
import zlib from "zlib";
import { safeUser } from "./auth.js";
import { assembleLite, attributeChunks, writeCatalog, AUDIT_SUMMARY_ABOVE } from "./catalog-store.js";
import { auditUserRef } from "../catalog-diff.js";
import { finishJob, setPhase } from "./jobs.js";
import { migrateStoredCatalog } from "./catalog-migrate.js";

export const runRestore = async (job) => {
  try {
    setPhase(job, "parsing");
    const text = job.tmpPath.endsWith(".gz") ? zlib.gunzipSync(await fs.promises.readFile(job.tmpPath)).toString("utf8") : await fs.promises.readFile(job.tmpPath, "utf8");
    job.bytesRead = job.bytesTotal;
    const d = JSON.parse(text);
    const catalog = d.catalog ?? (d.hubs ? d : null);
    if (!catalog || typeof catalog !== "object" || !Array.isArray(catalog.databases)) throw new Error("Not a valid catalog dump");
    job.rowsRead = ["hubs", "domains", "people", "glossary", "databases", "schemas", "tables", "attributes", "lineage"].reduce((n, k) => n + (catalog[k] || []).length, 0);
    setPhase(job, "writing");
    const r = await writeCatalog(catalog, null, job.user, (entries) => {   /* entries = per-collection diff, computed by the store */
      job.counts = { changes: entries.length, created: entries.filter((e) => e.action === "created").length, updated: entries.filter((e) => e.action === "updated").length, deleted: entries.filter((e) => e.action === "deleted").length, total: entries.length };
      const summary = { id: crypto.randomUUID(), ts: Date.now(), user: auditUserRef(job.user), action: "imported", entityType: "system", entityId: "dump", name: entries.length > AUDIT_SUMMARY_ABOVE ? `full dump (${entries.length} record changes)` : "full dump", context: "", scope: [] };
      return entries.length > AUDIT_SUMMARY_ABOVE ? [summary] : [...entries, summary];
    }, { onProgress: (done, total) => { job.rowsWritten = done; job.rowsToWrite = total; }, onPhase: (phase) => setPhase(job, phase) });
    job.version = r.version;
    try { const m = await migrateStoredCatalog("dump restore"); if (m.changes) job.warnings.push(`Document upgraded after the restore: ${m.changes} change(s)`); } catch (e) { job.warnings.push(`Document upgrade after the restore failed: ${e.message}`); }
    finishJob(job, "done");
  } catch (e) {
    finishJob(job, "error", e.message);
  } finally {
    if (!job.keepFile) fs.promises.unlink(job.tmpPath).catch(() => {});
  }
};

/* streams the dump document (used by GET /admin/dump and by the backup writer). `catalog` is the lite document; the
   attributes are streamed table by table from the database (v1.59) — the full document is never assembled. */
const writeChunk = (out, s) => (out.write(s) ? Promise.resolve() : new Promise((r) => out.once("drain", r)));
export const writeDumpTo = async (out, { catalog, version, users, attributes = null }) => {
  await writeChunk(out, `{"format":"datahub-catalog-dump","version":3,"exportedAt":${JSON.stringify(new Date().toISOString())},"catalogVersion":${Number(version)},"users":${JSON.stringify(users.map(safeUser))},"catalog":`);
  if (!catalog) { out.write("null}"); return; }
  const keys = Object.keys(catalog);
  if (!keys.includes("attributes")) keys.push("attributes");
  await writeChunk(out, "{");
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    await writeChunk(out, `${i ? "," : ""}${JSON.stringify(k)}:`);
    if (k === "attributes" && attributes) {
      await writeChunk(out, "["); let j = 0;
      for await (const chunk of attributes) { await writeChunk(out, chunk.map((rec) => (j++ ? "," : "") + JSON.stringify(rec)).join("")); }
      await writeChunk(out, "]");
    } else if (Array.isArray(catalog[k])) { await writeChunk(out, "["); for (let j = 0; j < catalog[k].length; j++) await writeChunk(out, (j ? "," : "") + JSON.stringify(catalog[k][j])); await writeChunk(out, "]"); }
    else await writeChunk(out, JSON.stringify(catalog[k]));
  }
  await writeChunk(out, "}}");
};
/* the dump input of the current catalog: lite document + attribute stream */
export const dumpSource = async () => { const { catalog, version } = await assembleLite(); return { catalog, version, attributes: catalog ? attributeChunks(catalog.tables) : null }; };
