/* /api/marketplace/*, /api/me/dashboard — access requests and the data product design workflow. The route parses and
   responds; the use cases (create, decide, workflow transition, delete) live in server/marketplace.js (v1.69). */
import { Router } from "express";
import crypto from "crypto";
import { q } from "../db.js";
import { hasRole, WORKFLOW_ROLES } from "../config.js";
import { ah, requireAuth, requireRole } from "../auth.js";
import { messageRow } from "../mail.js";
import { sendAttachment } from "../security.js";
import { assembleLite } from "../catalog-store.js";
import { EMPTY_CATALOG } from "../catalog-tables.js";
import { reqRow, isDesignOwner, loadRequest, requireRequest } from "../design-workflow.js";
import { createRequest, decideAccessRequest, applyDesignAction, deleteRequest, ownershipOf, pendingActionsFor } from "../marketplace.js";

const MAX_FILE = 15 * 1024 * 1024;

export function marketplaceRoutes() {
  const r = Router();

  r.get("/api/marketplace/requests", requireAuth, ah(async (req, res) => {
    const wf = WORKFLOW_ROLES.some((x) => hasRole(req.user, x));
    const rows = hasRole(req.user, "admin") ? await q("SELECT * FROM marketplace_requests ORDER BY ts DESC LIMIT 500")
      : wf ? await q("SELECT * FROM marketplace_requests WHERE kind = 'design' OR requested_by = ? ORDER BY ts DESC LIMIT 500", [req.user.email])
      : await q("SELECT * FROM marketplace_requests WHERE requested_by = ? ORDER BY ts DESC LIMIT 200", [req.user.email]);
    res.json({ requests: rows.map(reqRow), scope: hasRole(req.user, "admin") || wf ? "all" : "own", role: req.user.role, roles: req.user.roles });
  }));

  /* documents attached to a request (approval e-mails, step notes) */
  r.post("/api/marketplace/requests/:id/files", requireAuth, ah(async (req, res) => {
    const row = await requireRequest(req.params.id);
    if (!(hasRole(req.user, "admin") || row.requested_by === req.user.email || WORKFLOW_ROLES.some((x) => hasRole(req.user, x)) || await isDesignOwner(row, req.user))) return res.status(403).json({ error: "Only workflow roles, the BPO, the submitter or an admin attach documents" });
    const { name, mime, data } = req.body || {};
    if (!name || !data) return res.status(400).json({ error: "name and data (base64) required" });
    const buf = Buffer.from(String(data), "base64");
    if (buf.length > MAX_FILE) return res.status(413).json({ error: "File exceeds 15 MB" });
    const id = crypto.randomUUID();
    await q("INSERT INTO request_files (id, request_id, name, mime, size, data, uploaded_by, ts) VALUES (?,?,?,?,?,?,?,?)", [id, row.id, String(name).slice(0, 250), String(mime || "application/octet-stream").slice(0, 250), buf.length, buf, req.user.email, Date.now()]);
    res.json({ file: { id, name, size: buf.length, url: `/api/marketplace/files/${id}` } });
  }));
  r.get("/api/marketplace/files/:id", requireAuth, ah(async (req, res) => {
    const rows = await q("SELECT request_id, name, mime, data FROM request_files WHERE id = ?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "File not found" });
    /* v1.66.1: the same visibility as the request itself (admins, workflow roles, the submitter, the design owner) */
    const row = await loadRequest(rows[0].request_id);
    if (!row || !(hasRole(req.user, "admin") || row.requested_by === req.user.email || WORKFLOW_ROLES.some((x) => hasRole(req.user, x)) || await isDesignOwner(row, req.user))) return res.status(403).json({ error: "Not allowed" });
    sendAttachment(res, rows[0]);
  }));
  r.delete("/api/marketplace/requests/:id", requireRole("admin"), ah(async (req, res) => {
    const row = await requireRequest(req.params.id);
    await deleteRequest(row, req.user);
    res.json({ ok: true });
  }));

  /* My Dashboard: requests waiting for me (by workflow role, admin duty or ownership of the product) and requests I initiated */
  r.get("/api/me/dashboard", requireAuth, ah(async (req, res) => {
    const { catalog } = await assembleLite();   /* v1.71: ownership needs people / schemas / databases, not the attribute rows */
    const c = catalog || EMPTY_CATALOG();
    const me = req.user;
    const rows = await q("SELECT * FROM marketplace_requests WHERE status NOT IN ('done','withdrawn','rejected') OR requested_by = ? ORDER BY ts DESC LIMIT 500", [me.email]);
    const all = rows.map(reqRow);
    const own = ownershipOf(c, me), mineIds = own.mineIds;
    const toAct = all.filter((x) => pendingActionsFor(x, me, own).length > 0);
    const initiated = all.filter((x) => x.requestedBy === me.email);
    const tasks = (await q("SELECT * FROM messages WHERE to_email = ? AND read_ts IS NULL AND table_id IS NOT NULL ORDER BY ts DESC LIMIT 50", [me.email])).map(messageRow);
    res.json({ toAct, initiated, tasks, personIds: [...mineIds] });
  }));

  /* new access request or data product design */
  r.post("/api/marketplace/requests", requireAuth, ah(async (req, res) => res.json({ request: await createRequest(req.body || {}, req.user) })));

  /* decisions on access requests and workflow actions on designs — the use cases live in server/marketplace.js (v1.69) */
  r.patch("/api/marketplace/requests/:id", requireAuth, ah(async (req, res) => {
    const row = await requireRequest(req.params.id);
    const b = req.body || {};
    const request = row.kind === "access" ? await decideAccessRequest(row, { status: b.status, reason: b.reason }, req.user) : await applyDesignAction(row, b.action, b, req.user);
    res.json({ request });
  }));
  return r;
}
