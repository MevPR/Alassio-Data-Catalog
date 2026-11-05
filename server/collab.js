/* Collaboration (v1.58, PLAN.md item 13): comments, questions with answers and resolution, star ratings and usage
   events (views, searches, exports) per catalog object. Entity types: table, schema, database, domain, hub, glossary.
   Everything lives beside the catalog rows (comments / ratings / usage_events) and never touches the catalog document. */
import crypto from "crypto";
import { q, sql } from "./db.js";
import { hasRole } from "./config.js";
import { emailSet } from "./users.js";
import { notifyI18n } from "./mail.js";
import { assembleLite } from "./catalog-store.js";
import { effStewardId, effOwnerId, catalogIndex } from "../permissions.js";
import { accountEmailOf, entityPath } from "./people.js";

export const ENTITY_TYPES = ["table", "schema", "database", "domain", "hub", "glossary"];   /* data products are schemas */
export const COMMENT_KINDS = ["comment", "question", "answer"];
const uid = () => crypto.randomUUID();
const DAY = 864e5;

/* ── pure helpers (unit-tested) ── */
export const validateComment = ({ body, kind = "comment", parentId = null }) => {
  const text = String(body ?? "").trim();
  if (!text) throw Object.assign(new Error("The comment is empty"), { status: 400 });
  if (text.length > 4000) throw Object.assign(new Error("Comments are limited to 4000 characters"), { status: 400 });
  const k = COMMENT_KINDS.includes(kind) ? kind : "comment";
  if (k === "answer" && !parentId) throw Object.assign(new Error("An answer needs the question it answers"), { status: 400 });
  if (k === "question" && parentId) throw Object.assign(new Error("A question starts a thread of its own"), { status: 400 });
  return { body: text, kind: k, parentId: parentId ? String(parentId) : null };
};
export const validateStars = (stars) => { const n = Math.round(Number(stars)); if (!(n >= 1 && n <= 5)) throw Object.assign(new Error("Rating must be 1–5 stars"), { status: 400 }); return n; };
export const canEdit = (comment, user) => !!user && (comment.by_email === String(user.email).toLowerCase() || hasRole(user, "admin"));
/* who may resolve a question: the asker, admins, stewards */
export const canResolve = (comment, user) => !!user && (comment.by_email === String(user.email).toLowerCase() || hasRole(user, "admin") || hasRole(user, "steward"));
/* flat rows → threads (top-level comments/questions with their replies, newest thread first, replies oldest first) */
export const threadsOf = (rows) => {
  const byParent = new Map();
  for (const r of rows) if (r.parentId) { if (!byParent.has(r.parentId)) byParent.set(r.parentId, []); byParent.get(r.parentId).push(r); }
  return rows.filter((r) => !r.parentId).sort((a, b) => b.ts - a.ts).map((r) => ({ ...r, replies: (byParent.get(r.id) || []).sort((a, b) => a.ts - b.ts) }));
};
export const ratingSummary = (rows, myEmail = null) => {
  const n = rows.length, sum = rows.reduce((s, r) => s + Number(r.stars), 0);
  const mine = myEmail ? rows.find((r) => r.by_email === myEmail.toLowerCase()) : null;
  return { avg: n ? Math.round((sum / n) * 10) / 10 : null, count: n, mine: mine ? Number(mine.stars) : null, histogram: [1, 2, 3, 4, 5].map((s) => rows.filter((r) => Number(r.stars) === s).length) };
};

/* ── rows ── */
const rowOf = (r) => ({ id: r.id, entityType: r.entity_type, entityId: r.entity_id, parentId: r.parent_id || null, kind: r.kind, body: r.body, by: { email: r.by_email, name: r.by_name },
  ts: Number(r.ts), editedTs: r.edited_ts ? Number(r.edited_ts) : null, resolvedTs: r.resolved_ts ? Number(r.resolved_ts) : null, resolvedBy: r.resolved_by || null });

export const listComments = async (type, id) => threadsOf((await q("SELECT * FROM comments WHERE entity_type = ? AND entity_id = ? ORDER BY ts", [type, id])).map(rowOf));
export const getComment = async (id) => { const r = await q("SELECT * FROM comments WHERE id = ?", [id]); return r[0] || null; };
export const addComment = async (type, id, user, input) => {
  const v = validateComment(input);
  if (v.parentId) {
    const parent = await getComment(v.parentId);
    if (!parent || parent.entity_type !== type || parent.entity_id !== id) throw Object.assign(new Error("Parent comment not found"), { status: 404 });
    if (parent.parent_id) throw Object.assign(new Error("Replies cannot be nested further"), { status: 400 });
    if (parent.kind !== "question") v.kind = "comment";
  }
  const row = { id: uid(), entity_type: type, entity_id: id, parent_id: v.parentId, kind: v.kind, body: v.body, by_email: String(user.email).toLowerCase(), by_name: user.name || user.email, ts: Date.now() };
  await q("INSERT INTO comments (id, entity_type, entity_id, parent_id, kind, body, by_email, by_name, ts) VALUES (?,?,?,?,?,?,?,?,?)",
    [row.id, row.entity_type, row.entity_id, row.parent_id, row.kind, row.body, row.by_email, row.by_name, row.ts]);
  return rowOf(row);
};
export const editComment = async (id, user, body) => {
  const c = await getComment(id); if (!c) throw Object.assign(new Error("Comment not found"), { status: 404 });
  if (!canEdit(c, user)) throw Object.assign(new Error("Only the author or an admin can edit this comment"), { status: 403 });
  const v = validateComment({ body, kind: c.kind, parentId: c.parent_id });
  await q("UPDATE comments SET body = ?, edited_ts = ? WHERE id = ?", [v.body, Date.now(), id]);
  return rowOf({ ...c, body: v.body, edited_ts: Date.now() });
};
export const deleteComment = async (id, user) => {
  const c = await getComment(id); if (!c) throw Object.assign(new Error("Comment not found"), { status: 404 });
  if (!canEdit(c, user)) throw Object.assign(new Error("Only the author or an admin can delete this comment"), { status: 403 });
  await q("DELETE FROM comments WHERE id = ? OR parent_id = ?", [id, id]);
  return true;
};
export const resolveQuestion = async (id, user, resolved = true) => {
  const c = await getComment(id); if (!c) throw Object.assign(new Error("Comment not found"), { status: 404 });
  if (c.kind !== "question") throw Object.assign(new Error("Only questions can be resolved"), { status: 400 });
  if (!canResolve(c, user)) throw Object.assign(new Error("Only the asker, a steward or an admin can resolve a question"), { status: 403 });
  await q("UPDATE comments SET resolved_ts = ?, resolved_by = ? WHERE id = ?", [resolved ? Date.now() : null, resolved ? (user.name || user.email) : null, id]);
  return rowOf({ ...c, resolved_ts: resolved ? Date.now() : null, resolved_by: resolved ? (user.name || user.email) : null });
};

export const rate = async (type, id, user, stars) => {
  const n = validateStars(stars);
  await q(sql.upsert("ratings", ["entity_type", "entity_id", "by_email", "stars", "ts"], 1, ["entity_type", "entity_id", "by_email"]), [type, id, String(user.email).toLowerCase(), n, Date.now()]);
  return ratingOf(type, id, user.email);
};
export const unrate = async (type, id, user) => { await q("DELETE FROM ratings WHERE entity_type = ? AND entity_id = ? AND by_email = ?", [type, id, String(user.email).toLowerCase()]); return ratingOf(type, id, user.email); };
export const ratingOf = async (type, id, myEmail = null) => ratingSummary(await q("SELECT by_email, stars FROM ratings WHERE entity_type = ? AND entity_id = ?", [type, id]), myEmail);

/* usage events: kept 400 days; view events of the same user+object within 10 minutes are collapsed */
export const recordUsage = async ({ kind, entityType = null, entityId = null, term = null, user = null }) => {
  if (!["view", "search", "export"].includes(kind)) return false;
  const email = user?.email ? String(user.email).toLowerCase() : null;
  if (kind === "view") {
    if (!entityType || !entityId) return false;
    const recent = await q(`SELECT id FROM usage_events WHERE kind = 'view' AND entity_type = ? AND entity_id = ? AND (by_email = ? OR (by_email IS NULL AND ${sql.text()} IS NULL)) AND ts > ? LIMIT 1`, [entityType, entityId, email, email, Date.now() - 10 * 60000]);
    if (recent.length) return false;
  }
  if (kind === "search" && !String(term || "").trim()) return false;
  await q("INSERT INTO usage_events (ts, kind, entity_type, entity_id, term, by_email) VALUES (?,?,?,?,?,?)", [Date.now(), kind, entityType, entityId, term ? String(term).trim().toLowerCase().slice(0, 200) : null, email]);
  return true;
};
export const usageOf = async (type, id) => {
  const now = Date.now();
  const [r] = await q(`SELECT SUM(CASE WHEN kind='view' AND ts > ? THEN 1 ELSE 0 END) AS v30, SUM(CASE WHEN kind='view' AND ts > ? THEN 1 ELSE 0 END) AS v90,
      SUM(CASE WHEN kind='export' THEN 1 ELSE 0 END) AS exports, MAX(CASE WHEN kind='view' THEN ts END) AS last_view, COUNT(DISTINCT CASE WHEN kind='view' AND ts > ? THEN by_email END) AS viewers90
    FROM usage_events WHERE entity_type = ? AND entity_id = ?`, [now - 30 * DAY, now - 90 * DAY, now - 90 * DAY, type, id]);
  return { views30: Number(r?.v30 || 0), views90: Number(r?.v90 || 0), viewers90: Number(r?.viewers90 || 0), exports: Number(r?.exports || 0), lastViewedAt: r?.last_view ? Number(r.last_view) : null };
};
export const usageTop = async (days = 30, limit = 10) => {
  const from = Date.now() - Math.max(1, Math.min(400, Number(days) || 30)) * DAY;
  const tables = await q("SELECT entity_id, COUNT(*) AS n, COUNT(DISTINCT by_email) AS users FROM usage_events WHERE kind='view' AND entity_type='table' AND ts > ? GROUP BY entity_id ORDER BY n DESC LIMIT ?", [from, limit]);
  const terms = await q("SELECT term, COUNT(*) AS n FROM usage_events WHERE kind='search' AND ts > ? AND term IS NOT NULL GROUP BY term ORDER BY n DESC LIMIT ?", [from, limit]);
  const [totals] = await q("SELECT SUM(CASE WHEN kind='view' THEN 1 ELSE 0 END) AS views, SUM(CASE WHEN kind='search' THEN 1 ELSE 0 END) AS searches, SUM(CASE WHEN kind='export' THEN 1 ELSE 0 END) AS exports, COUNT(DISTINCT by_email) AS users FROM usage_events WHERE ts > ?", [from]);
  const rated = await q("SELECT entity_id, AVG(stars) AS avg, COUNT(*) AS n FROM ratings WHERE entity_type='table' GROUP BY entity_id HAVING COUNT(*) >= 1 ORDER BY AVG(stars) DESC, COUNT(*) DESC LIMIT ?", [limit]);
  return { days: Math.round((Date.now() - from) / DAY), tables: tables.map((t) => ({ tableId: t.entity_id, views: Number(t.n), users: Number(t.users) })), terms: terms.map((t) => ({ term: t.term, count: Number(t.n) })),
    totals: { views: Number(totals?.views || 0), searches: Number(totals?.searches || 0), exports: Number(totals?.exports || 0), users: Number(totals?.users || 0) },
    topRated: rated.map((r) => ({ tableId: r.entity_id, avg: Math.round(Number(r.avg) * 10) / 10, count: Number(r.n) })) };
};
export const purgeUsage = async (keepDays = 400) => { const r = await q("DELETE FROM usage_events WHERE ts < ?", [Date.now() - keepDays * DAY]); return r.affectedRows || 0; };

/* everything the UI / MCP needs for one object */
export const collabOf = async (type, id, myEmail = null) => {
  const [comments, rating, usage] = await Promise.all([listComments(type, id), ratingOf(type, id, myEmail), usageOf(type, id)]);
  return { comments, rating, usage, openQuestions: comments.filter((c) => c.kind === "question" && !c.resolvedTs).map((c) => ({ id: c.id, body: c.body, by: c.by.name, ts: c.ts, answers: c.replies.length })) };
};

/* questions addressed to me: I am the effective steward/owner of the object (by account e-mail), or I asked them */
export const questionsFor = async (user) => {
  const email = String(user.email).toLowerCase();
  const open = (await q("SELECT * FROM comments WHERE kind = 'question' AND resolved_ts IS NULL ORDER BY ts DESC LIMIT 500")).map(rowOf);
  if (!open.length) return { toAnswer: [], mine: [] };
  const { catalog: c } = await assembleLite();
  const ix = c ? catalogIndex(c) : null;
  const personEmail = (pid) => accountEmailOf(c, pid);
  const mineFor = (qn) => { if (!c || !ix) return false; const s = personEmail(effStewardId(c, qn.entityType, qn.entityId, ix)), o = personEmail(effOwnerId(c, qn.entityType, qn.entityId, ix)); return s === email || o === email; };
  const withPath = (qn) => ({ ...qn, path: entityPath(c, qn.entityType, qn.entityId, ix) });
  const isAdmin = hasRole(user, "admin");
  const answered = new Set((await q("SELECT DISTINCT parent_id FROM comments WHERE parent_id IS NOT NULL")).map((r) => r.parent_id));
  return { toAnswer: open.filter((qn) => qn.by.email !== email && (mineFor(qn) || (isAdmin && !answered.has(qn.id)))).map(withPath), mine: open.filter((qn) => qn.by.email === email).map(withPath) };
};

/* notifications: a question → steward + owner of the object (accounts only); an answer → the asker */
export const notifyQuestion = async (type, id, comment, user) => {
  const { catalog: c } = await assembleLite(); if (!c) return 0;
  const ix = catalogIndex(c);
  const users = await emailSet();
  const personEmail = (pid) => accountEmailOf(c, pid, users);
  const to = [...new Set([personEmail(effStewardId(c, type, id, ix)), personEmail(effOwnerId(c, type, id, ix))].filter((e) => e && e !== String(user.email).toLowerCase()))];
  if (!to.length) return 0;
  return notifyI18n(to, user.name || user.email, "question_asked", { path: entityPath(c, type, id, ix), asker: user.name || user.email, body: comment.body.slice(0, 1000) }, { tableId: type === "table" ? id : null });
};
export const notifyAnswer = async (type, id, question, answer, user) => {
  if (!question || question.by_email === String(user.email).toLowerCase()) return 0;
  const { catalog: c } = await assembleLite();
  const path = entityPath(c, type, id);
  return notifyI18n([question.by_email], user.name || user.email, "question_answered", { path, answerer: user.name || user.email, body: answer.body.slice(0, 1000) }, { tableId: type === "table" ? id : null });
};

/* all open questions (for MCP / dashboards), newest first */
export const openQuestions = async (limit = 100) => {
  const rows = (await q("SELECT * FROM comments WHERE kind = 'question' AND resolved_ts IS NULL ORDER BY ts DESC LIMIT ?", [Math.min(500, Number(limit) || 100)])).map(rowOf);
  const { catalog: c } = await assembleLite();
  const ix = c ? catalogIndex(c) : null;
  return rows.map((qn) => ({ ...qn, path: entityPath(c, qn.entityType, qn.entityId, ix) }));
};

/* registered as task "usage-purge" by server.js (v1.70) */
export const USAGE_PURGE_TASK = { description: "Delete usage events older than keepDays (default 400)", schedule: "manual", run: async (user, body) => ({ deleted: await purgeUsage(Number(body?.keepDays) || 400) }) };
