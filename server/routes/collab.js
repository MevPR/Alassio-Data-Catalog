/* /api/collab, /api/usage — comments, questions, ratings and usage statistics (v1.58) */
import { Router } from "express";
import { ah, requireAuth, requireRole } from "../auth.js";
import { sysAudit } from "../audit.js";
import { ENTITY_TYPES, collabOf, addComment, editComment, deleteComment, resolveQuestion, getComment, rate, unrate, recordUsage, usageTop, questionsFor, notifyQuestion, notifyAnswer, purgeUsage } from "../collab.js";
import { entityPath } from "../people.js";
import { catalogIndex } from "../../permissions.js";

const entity = (req, res) => {
  const type = String(req.params.type || ""), id = String(req.params.id || "").slice(0, 64);
  if (!ENTITY_TYPES.includes(type) || !id) { res.status(400).json({ error: `Unknown entity type — one of ${ENTITY_TYPES.join(", ")}` }); return null; }
  return { type, id };
};

export function collabRoutes({ readCatalog }) {
  const r = Router();
  r.get("/api/collab/questions/open", requireAuth, ah(async (req, res) => res.json(await questionsFor(req.user))));
  r.get("/api/collab/:type/:id", requireAuth, ah(async (req, res) => {
    const e = entity(req, res); if (!e) return;
    res.json(await collabOf(e.type, e.id, req.user.email));
  }));
  r.post("/api/collab/:type/:id/comments", requireAuth, ah(async (req, res) => {
    const e = entity(req, res); if (!e) return;
    const c = await addComment(e.type, e.id, req.user, req.body || {});
    let notified = 0;
    if (c.kind === "question") notified = await notifyQuestion(e.type, e.id, c, req.user).catch((err) => { console.error("question notify:", err); return 0; });
    else if (c.parentId) { const parent = await getComment(c.parentId); if (parent?.kind === "question") notified = await notifyAnswer(e.type, e.id, parent, c, req.user).catch(() => 0); }
    res.json({ comment: c, notified });
  }));
  r.patch("/api/collab/comments/:id", requireAuth, ah(async (req, res) => { res.json({ comment: await editComment(req.params.id, req.user, req.body?.body) }); }));
  r.delete("/api/collab/comments/:id", requireAuth, ah(async (req, res) => { await deleteComment(req.params.id, req.user); res.json({ ok: true }); }));
  r.post("/api/collab/comments/:id/resolve", requireAuth, ah(async (req, res) => { res.json({ comment: await resolveQuestion(req.params.id, req.user, req.body?.resolved !== false) }); }));
  r.put("/api/collab/:type/:id/rating", requireAuth, ah(async (req, res) => {
    const e = entity(req, res); if (!e) return;
    res.json({ rating: req.body?.stars == null ? await unrate(e.type, e.id, req.user) : await rate(e.type, e.id, req.user, req.body.stars) });
  }));

  /* usage events from the UI (fire-and-forget) and the top lists for the governance / home views */
  r.post("/api/usage", requireAuth, ah(async (req, res) => {
    const b = req.body || {};
    const ok = await recordUsage({ kind: String(b.kind || ""), entityType: b.entityType ? String(b.entityType) : null, entityId: b.entityId ? String(b.entityId).slice(0, 64) : null, term: b.term, user: req.user });
    res.json({ ok });
  }));
  r.get("/api/usage/top", requireAuth, ah(async (req, res) => {
    const top = await usageTop(req.query.days, Math.min(50, Number(req.query.limit) || 10));
    const { catalog: c } = await readCatalog();
    const ix = c ? catalogIndex(c) : null;
    const withPath = (x) => ({ ...x, path: entityPath(c, "table", x.tableId, ix), exists: !!(c && ix.tb.get(x.tableId)) });
    /* objects deleted since keep their events but leave the top lists */
    res.json({ ...top, tables: top.tables.map(withPath).filter((x) => x.exists), topRated: top.topRated.map(withPath).filter((x) => x.exists) });
  }));
  r.post("/admin/usage/purge", requireRole("admin"), ah(async (req, res) => {
    const n = await purgeUsage(Number(req.body?.keepDays) || 400);
    await sysAudit(req.user, "settings", "updated", "usage events", [{ field: "purged", from: null, to: String(n) }]);
    res.json({ ok: true, deleted: n });
  }));
  return r;
}
