/* /api/glossary/* — attachments of glossary terms (binary files stored in MariaDB) */
import { Router } from "express";
import crypto from "crypto";
import { q } from "../db.js";
import { ah, requireAuth, requireRole } from "../auth.js";
import { sysAudit } from "../audit.js";
import { safeMime, sendAttachment } from "../security.js";
import { assembleLite } from "../catalog-store.js";
import { buildPerms } from "../../permissions.js";

const MAX_FILE = 15 * 1024 * 1024;
const fileMeta = (r) => ({ id: r.id, termId: r.term_id, name: r.name, mime: r.mime, size: Number(r.size), uploadedBy: r.uploaded_by, ts: Number(r.ts), url: `/api/glossary/files/${r.id}` });
const canEditGlossary = async (user) => buildPerms((await assembleLite()).catalog || {}, user).canEditGlossary;   /* v1.71: permissions need no attribute rows */

export function glossaryFileRoutes() {
  const r = Router();
  r.get("/api/glossary/files-index", requireAuth, ah(async (req, res) => {
    res.json({ files: (await q("SELECT id, term_id, name, mime, size, uploaded_by, ts FROM glossary_files ORDER BY ts")).map(fileMeta) });
  }));
  r.get("/api/glossary/:termId/files", requireAuth, ah(async (req, res) => {
    res.json({ files: (await q("SELECT id, term_id, name, mime, size, uploaded_by, ts FROM glossary_files WHERE term_id = ? ORDER BY ts", [req.params.termId])).map(fileMeta) });
  }));
  r.post("/api/glossary/:termId/files", requireRole("admin", "steward"), ah(async (req, res) => {
    if (!(await canEditGlossary(req.user))) return res.status(403).json({ error: "Glossary editing requires an owner or steward responsibility" });
    const { name, mime, data } = req.body || {};
    if (!name || typeof data !== "string") return res.status(400).json({ error: "name and base64 data are required" });
    const buf = Buffer.from(data, "base64");
    if (!buf.length) return res.status(400).json({ error: "Empty file" });
    if (buf.length > MAX_FILE) return res.status(413).json({ error: "File exceeds 15 MB" });
    /* v1.66.1: only existing terms take attachments, a sane MIME type, and at most 20 files per term */
    const termId = String(req.params.termId).slice(0, 32);
    if (!(await q("SELECT id FROM cat_glossary WHERE id = ?", [termId])).length) return res.status(404).json({ error: "Glossary term not found" });
    if (Number((await q("SELECT COUNT(*) AS n FROM glossary_files WHERE term_id = ?", [termId]))[0].n) >= 20) return res.status(409).json({ error: "At most 20 files per term" });
    const f = { id: crypto.randomUUID(), termId, name: String(name).slice(0, 500), mime: safeMime(mime), size: buf.length, ts: Date.now() };
    await q("INSERT INTO glossary_files (id, term_id, name, mime, size, data, uploaded_by, ts) VALUES (?,?,?,?,?,?,?,?)", [f.id, f.termId, f.name, f.mime, f.size, buf, req.user.email, f.ts]);
    await sysAudit(req.user, "glossary_file", "created", f.name, [{ field: "termId", from: null, to: f.termId }, { field: "size", from: null, to: f.size }]);
    res.json({ file: { ...f, uploadedBy: req.user.email, url: `/api/glossary/files/${f.id}` } });
  }));
  r.get("/api/glossary/files/:id", requireAuth, ah(async (req, res) => {
    const rows = await q("SELECT * FROM glossary_files WHERE id = ?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "File not found" });
    sendAttachment(res, rows[0]);
  }));
  r.delete("/api/glossary/files/:id", requireRole("admin", "steward"), ah(async (req, res) => {
    if (!(await canEditGlossary(req.user))) return res.status(403).json({ error: "Glossary editing requires an owner or steward responsibility" });
    const rows = await q("SELECT id, name, term_id FROM glossary_files WHERE id = ?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "File not found" });
    await q("DELETE FROM glossary_files WHERE id = ?", [req.params.id]);
    await sysAudit(req.user, "glossary_file", "deleted", rows[0].name, [{ field: "termId", from: rows[0].term_id, to: null }]);
    res.json({ ok: true });
  }));
  return r;
}
