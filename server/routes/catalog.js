/* /api/catalog, /api/tables/:id/attributes, /api/search, /api/audit — the shared catalog (dumps: routes/dump.js) */
import { Router } from "express";
import { q } from "../db.js";
import { LAZY_ATTRIBUTES, hasRole } from "../config.js";
import { ah, requireAuth, requireRole } from "../auth.js";
import { queryAudit } from "../audit.js";
import { assembleCatalog, assembleLite, attributesOfTable, countAttributes, catalogStats, searchRows, writeCatalog, applyChanges } from "../catalog-store.js";

export function catalogRoutes() {
  const r = Router();

  /* Lazy loading for large catalogs: above LAZY_ATTRIBUTES attributes (or with ?lite=1) the document is delivered without
     attribute records — only a light index {id, tableId, name} plus per-table counts/stats — and the UI fetches a table's
     attributes when it opens it. ?full=1 forces the complete document (exports, write-back). */
  r.get("/api/catalog", requireAuth, ah(async (req, res) => {
    const lite = req.query.full !== "1" && (req.query.lite === "1" || (await countAttributes()) > LAZY_ATTRIBUTES);
    if (lite) { const { catalog, stats, version } = await assembleLite(); return res.json(catalog ? { catalog, stats, version, lazy: true } : { catalog, version }); }
    const { catalog, version } = await assembleCatalog();
    res.json(catalog ? { catalog, version, lazy: false } : { catalog, version });
  }));
  r.get("/api/tables/:id/attributes", requireAuth, ah(async (req, res) => {
    const meta = (await q("SELECT version FROM catalog_meta WHERE id = 1"))[0];
    res.json({ attributes: await attributesOfTable(req.params.id), version: meta ? Number(meta.version) : 0 });
  }));

  /* server-side full-text search across all object types (FULLTEXT on search_text) */
  r.get("/api/search", requireAuth, ah(async (req, res) => {
    const term = String(req.query.q || "").trim();
    if (!term) return res.json({ hits: [] });
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    res.json({ hits: await searchRows(term, limit) });
  }));

  /* v1.66: coverage statistics from the server — dashboard KPIs for attributes without loading them into the browser */
  r.get("/api/stats", requireAuth, ah(async (req, res) => { const st = await catalogStats(); if (!st) return res.status(503).json({ error: "The catalog is not initialised" }); res.json({ stats: st }); }));

  /* whole-document write — kept for restore/admin tooling only */
  r.put("/api/catalog", requireRole("admin"), ah(async (req, res) => {
    const { catalog, baseVersion } = req.body || {};
    if (!catalog || typeof catalog !== "object") return res.status(400).json({ error: "Invalid catalog payload" });
    const out = await writeCatalog(catalog, baseVersion ?? null, req.user);
    if (out.conflict) return res.status(409).json({ error: "Version conflict — the catalog was changed by someone else", version: out.version });
    res.json({ ok: true, version: out.version, audited: out.audited });
  }));

  /* phase 2: delta saves with per-object conflict detection */
  r.patch("/api/catalog", requireRole("admin", "steward"), ah(async (req, res) => {
    const { changes } = req.body || {};
    if (!Array.isArray(changes)) return res.status(400).json({ error: "changes[] required" });
    try {
      res.json(await applyChanges(req.user, changes));
    } catch (e) {   /* v1.73 (F-S2): the store throws refusals — the HTTP body keeps its shape { error, conflicts | violations } */
      if (e.conflicts) return res.status(e.status).json({ error: e.message, conflicts: e.conflicts });
      if (e.violations) return res.status(e.status).json({ error: e.message, violations: e.violations });
      throw e;
    }
  }));

  /* audit trail */
  r.get("/api/audit", requireRole("admin", "steward"), ah(async (req, res) => {
    const { scopeId, type, q: qq, before, limit } = req.query;
    const hide = !hasRole(req.user, "admin");
    res.json(await queryAudit({ scopeId, type, q: qq, before, limit, max: 500, hideUsers: hide, hideSystem: hide }));
  }));

  return r;
}
