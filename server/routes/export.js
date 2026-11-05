/* /api/export/csv and /api/export/okf — streamed exports rendered on the server.
   Both accept the selection as a form field (the browser submits a hidden form, so the download runs natively
   without holding the file in JavaScript memory): selection = JSON { tableIds: [] | null, schemaIds: [], databaseIds: [] }. */
import { Router } from "express";
import express from "express";
import { ZipArchive } from "archiver";
import Papa from "papaparse";
import { ah, requireAuth } from "../auth.js";
import { requireCsrfBody } from "../security.js";
import { sysAudit } from "../audit.js";
import { assembleLite, makeAttrLoader } from "../catalog-store.js";
import { EMPTY_CATALOG } from "../catalog-tables.js";
import { csvRowsOf, CSV_COLUMNS } from "../../csv-export.js";
import { buildOkfBundle } from "../../okf.js";

const parseSelection = (req) => {
  const raw = req.body?.selection ?? req.query?.selection;
  if (!raw) return { tableIds: null, schemaIds: [], databaseIds: [] };
  let s; try { s = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { throw Object.assign(new Error("selection must be JSON"), { status: 400 }); }
  return { tableIds: Array.isArray(s.tableIds) ? s.tableIds : null, schemaIds: Array.isArray(s.schemaIds) ? s.schemaIds : [], databaseIds: Array.isArray(s.databaseIds) ? s.databaseIds : [] };
};
const stamp = () => new Date().toISOString().slice(0, 10);
/* backpressure-aware write: waits for 'drain' when the socket buffer is full */
const write = (res, chunk) => res.write(chunk) ? Promise.resolve() : new Promise((r) => res.once("drain", r));

export function exportRoutes({ appVersion }) {
  const r = Router();
  const body = express.urlencoded({ extended: false, limit: "8mb" });

  r.post("/api/export/csv", requireAuth, body, ah(async (req, res) => {
    if (!requireCsrfBody(req, res)) return;
    const selection = parseSelection(req);
    const { catalog } = await assembleLite();   /* attributes stream per table (v1.59) */
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=alassio-catalog-export-${stamp()}.csv`);
    await write(res, Papa.unparse([CSV_COLUMNS], { header: false }) + "\r\n");
    let n = 0, buf = [];
    for await (const row of csvRowsOf(catalog || EMPTY_CATALOG(), selection, catalog ? makeAttrLoader(catalog.tables) : null)) {
      buf.push(CSV_COLUMNS.map((c) => row[c] ?? ""));
      n++;
      if (buf.length >= 2000) { await write(res, Papa.unparse(buf, { header: false }) + "\r\n"); buf = []; }
    }
    if (buf.length) await write(res, Papa.unparse(buf, { header: false }) + "\r\n");
    res.end();
    await sysAudit(req.user, "system", "exported", `CSV export (${n} rows)`);
  }));

  r.post("/api/export/okf", requireAuth, body, ah(async (req, res) => {
    if (!requireCsrfBody(req, res)) return;
    const selection = parseSelection(req);
    const { catalog, version } = await assembleLite();
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=alassio-catalog-okf-${stamp()}.zip`);
    const zip = new ZipArchive({ zlib: { level: 6 } });
    zip.on("error", (e) => { console.error("okf zip:", e.message); res.destroy(e); });
    zip.pipe(res);
    const n = await buildOkfBundle(catalog || EMPTY_CATALOG(), selection,
      { version: appVersion, catalogVersion: version, title: "Alassio Data Catalog" },
      (path, content) => zip.append(content, { name: `alassio-catalog-okf/${path}` }), catalog ? makeAttrLoader(catalog.tables) : null);
    await zip.finalize();
    await sysAudit(req.user, "system", "exported", `OKF bundle (${n} files)`);
  }));
  return r;
}
