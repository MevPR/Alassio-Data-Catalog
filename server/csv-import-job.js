/* Server-side CSV import job (v1.73, F-S7 — moved out of routes/import.js). The route streams the upload to a temp file
   and hands the job here; runCsvImportJob parses the file as a stream (papaparse), merges the rows into the catalog with
   hash-map lookups (csv-import.js) and writes the new rows in one transaction per chunk with multi-row INSERTs.
   The file is merged in chunks (IMPORT_CHUNK_ROWS rows, default 100,000; a chunk boundary waits for the next table so
   one table's columns stay together) — the parsed rows of a 400k-row file never sit in memory at once (v1.59). Each
   chunk is one transaction with its own audit summary; counts are accumulated. */
import fs from "fs";
import Papa from "papaparse";
import { importBulk } from "./catalog-store.js";
import { csvHeader } from "../src/lib/model.js";
import { mergeCsvRows, csvTouchedTableIds } from "../csv-import.js";
import { CSV_COLUMNS } from "../csv-export.js";
import { finishJob, setPhase } from "./jobs.js";

const KEEP = [...CSV_COLUMNS, "country"];   /* the export's columns re-import 1:1; "country" is accepted on import as well */
export const IMPORT_CHUNK_ROWS = Math.max(1000, Number(process.env.IMPORT_CHUNK_ROWS || 100000));
const tableKey = (r) => `${r.database}\u0000${r.schema || ""}\u0000${r.table || ""}`;

/* parses the file; `onChunk(rows, isLast)` is awaited for every chunk while the parser is paused */
const parseFile = (job, onChunk, chunkRows) => new Promise((resolve, reject) => {
  let rows = [], fields = null, lastKey = null, failed = false;
  const stream = fs.createReadStream(job.tmpPath, { highWaterMark: 1 << 20 });
  stream.on("data", (chunk) => { job.bytesRead += chunk.length; });
  const fail = (e) => { if (failed) return; failed = true; stream.destroy(); reject(e); };
  Papa.parse(stream, {
    header: true, skipEmptyLines: true, transformHeader: csvHeader,
    step: ({ data, meta }, parser) => {
      if (failed) return;
      if (job.cancelled) return fail(new Error("cancelled"));
      if (!fields) { fields = meta.fields || []; if (!fields.includes("data_hub_type") && !fields.includes("data_hub")) job.warnings.push(`CSV has no "data_hub_type" column (found: ${fields.slice(0, 6).join(", ")}${fields.length > 6 ? ", …" : ""}) — databases were placed in the default hub`); }
      const r = {};
      for (const k of KEEP) if (data[k] !== undefined && data[k] !== "") r[k] = data[k];
      job.rowsRead++;
      if (!r.database) return;
      const key = tableKey(r);
      if (rows.length >= chunkRows && key !== lastKey) {
        const batch = rows; rows = [];
        parser.pause();
        onChunk(batch, false).then(() => parser.resume()).catch(fail);
      }
      rows.push(r); lastKey = key;
    },
    complete: () => {
      if (failed) return;
      const f = fields || [];
      if (!f.includes("table") || !f.includes("attribute")) return reject(new Error(`columns "table" and "attribute" are required (found: ${f.slice(0, 8).join(", ")})`));
      onChunk(rows, true).then(resolve).catch(reject);
    },
    error: (e) => fail(e),
  });
});

/* runs the job to its end (never throws: the outcome lands on the job) and removes the temp file.
   `store.importBulk` and `chunkRows` are injectable for tests. */
export const runCsvImportJob = async (job, { store = { importBulk }, chunkRows = IMPORT_CHUNK_ROWS } = {}) => {
  const totals = {}; let chunks = 0, version = null, writtenBefore = 0;
  try {
    setPhase(job, "parsing");
    await parseFile(job, async (rows, isLast) => {
      if (job.cancelled) throw new Error("cancelled");
      if (!rows.length && chunks) return;
      chunks++;
      setPhase(job, "writing");
      const r = await store.importBulk(job.user, async (prev, loadAttrs) => {
        /* the lite document carries no attributes — load those of the tables the chunk addresses, so existing columns
           are recognised and only new ones are written */
        prev.attributes = await loadAttrs(csvTouchedTableIds(prev, rows));
        const { next, created, counts } = mergeCsvRows(prev, rows);
        for (const [k, v] of Object.entries(counts)) totals[k] = (totals[k] || 0) + v;
        job.counts = { ...totals }; job.rowsToWrite = totals.total;
        return { next, created, name: `CSV import ${job.fileName}${chunks > 1 || !isLast ? ` (part ${chunks})` : ""}` };
      }, (done) => { job.rowsWritten = writtenBefore + done; job.rowsToWrite = totals.total; }, (phase) => setPhase(job, phase));
      writtenBefore = job.rowsWritten = totals.total; version = r.version;
      if (!isLast) setPhase(job, "parsing");
    }, chunkRows);
    if (job.cancelled) throw new Error("cancelled");
    job.version = version; job.chunks = chunks; finishJob(job, "done");
  } catch (e) {
    finishJob(job, job.cancelled ? "cancelled" : "error", e.message);
  } finally {
    await fs.promises.unlink(job.tmpPath).catch(() => {});
  }
};
