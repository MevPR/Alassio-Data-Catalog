/* /api/messages — the in-app mailbox and the "request business descriptions" workflow */
import { Router } from "express";
import { q } from "../db.js";
import { ah, requireAuth, requireRole } from "../auth.js";
import { sysAudit } from "../audit.js";
import { notifyI18n, emailsByRole, messageRow } from "../mail.js";
import { assembleLite } from "../catalog-store.js";
import { effStewardId, effOwnerId } from "../../permissions.js";
import { personById, entityPath } from "../people.js";

export function messageRoutes() {
  const r = Router();
  r.get("/api/messages", requireAuth, ah(async (req, res) => {
    const rows = await q("SELECT * FROM messages WHERE to_email = ? ORDER BY ts DESC LIMIT 200", [req.user.email.toLowerCase()]);
    res.json({ messages: rows.map(messageRow), unread: rows.filter((m) => !m.read_ts).length });
  }));
  r.post("/api/messages/read-all", requireAuth, ah(async (req, res) => {
    await q("UPDATE messages SET read_ts = ? WHERE to_email = ? AND read_ts IS NULL", [Date.now(), req.user.email]);
    res.json({ ok: true });
  }));
  r.post("/api/messages/:id/read", requireAuth, ah(async (req, res) => {
    await q("UPDATE messages SET read_ts = ? WHERE id = ? AND to_email = ?", [Date.now(), req.params.id, req.user.email.toLowerCase()]);
    res.json({ ok: true });
  }));
  r.delete("/api/messages/:id", requireAuth, ah(async (req, res) => {
    await q("DELETE FROM messages WHERE id = ? AND to_email = ?", [req.params.id, req.user.email.toLowerCase()]);
    res.json({ ok: true });
  }));

  /* project managers / admins ask the effective steward of a table to describe its attributes:
     1) steward defined → ask the steward, 2) only an owner → ask the owner to assign a steward, 3) neither → ask the admins */
  r.post("/api/messages/request-description", requireRole("admin", "pm"), ah(async (req, res) => {
    const { tableId, note } = req.body || {};
    const { catalog: c, stats } = await assembleLite();   /* v1.71: the attribute count comes from the per-table statistics */
    const t = (c?.tables || []).find((x) => x.id === tableId);
    if (!t) return res.status(404).json({ error: "Table not found" });
    const path = entityPath(c, "table", t.id);
    const nAttr = stats?.perTable?.[t.id] || 0;
    const steward = personById(c, effStewardId(c, "table", t.id));
    const owner = personById(c, effOwnerId(c, "table", t.id));
    if (steward) {
      if (!steward.email) return res.status(400).json({ error: `Steward ${steward.name} has no e-mail address in the people directory — add it in the Governance Overview` });
      const n = await notifyI18n([steward.email], req.user.name, "describe_attrs_steward", { requester: req.user.name, path, n: nAttr, note }, { tableId: t.id });
      await sysAudit(req.user, "marketplace", "created", `description request: ${path}`, [{ field: "steward", from: null, to: steward.name }]);
      return res.json({ ok: true, kind: "steward", to: steward.name, sent: n });
    }
    if (owner) {
      if (!owner.email) return res.status(400).json({ error: `Data owner ${owner.name} has no e-mail address in the people directory — add it in the Governance Overview` });
      const n = await notifyI18n([owner.email], req.user.name, "assign_steward_owner", { requester: req.user.name, path, n: nAttr, note }, { tableId: t.id });
      await sysAudit(req.user, "marketplace", "created", `steward assignment request: ${path}`, [{ field: "owner", from: null, to: owner.name }]);
      return res.json({ ok: true, kind: "owner", to: owner.name, sent: n });
    }
    const admins = await emailsByRole("admin");
    const n = await notifyI18n(admins, req.user.name, "name_owner_admin", { requester: req.user.name, path, n: nAttr, note }, { tableId: t.id });
    await sysAudit(req.user, "marketplace", "created", `owner assignment request: ${path}`, [{ field: "admins", from: null, to: String(admins.length) }]);
    res.json({ ok: true, kind: "admin", to: "the admins", sent: n });
  }));
  return r;
}
