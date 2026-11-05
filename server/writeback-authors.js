/* Who made a pending write-back change? (v1.77) Every operation of the write-back names its sources — the catalog
   records and fields its value comes from (uc-writeback.js, `op.src`). The audit trail records field-level changes
   per user, so the author of an operation is the user of the newest audit entry that touched one of those fields (a
   "created" entry counts for every field of the record). Changes that left no field-level trace — bulk imports that
   were summarised into one audit entry, records older than the audit trail — have no author.
   The rule (owner's instruction of 2026-10-27): changes belong to the user who made them; everyone writes back their
   own, admins additionally the ones without an author; the automatic write-back (profile option / task) stays an
   admin setting that writes everything. */
import { q } from "./db.js";
import { hasRole } from "./config.js";

const CHUNK = 400;

/* audit entries that touched the given records, newest first: [{ type, id, user, ts, fields: Set | null }] (null = all) */
const auditFor = async (keys) => {
  const byType = new Map();
  for (const k of keys) { if (!byType.has(k.type)) byType.set(k.type, new Set()); byType.get(k.type).add(String(k.id)); }
  const out = [];
  for (const [type, ids] of byType) {
    const list = [...ids];
    for (let i = 0; i < list.length; i += CHUNK) {
      const part = list.slice(i, i + CHUNK);
      const rows = await q(`SELECT entity_id, user_json, ts, action, changes_json FROM audit WHERE entity_type = ? AND entity_id IN (${part.map(() => "?").join(",")}) AND action IN ('created','updated') ORDER BY ts DESC`, [type, ...part]);
      for (const r of rows) {
        let fields = null;
        if (r.action !== "created") {
          let ch; try { ch = JSON.parse(r.changes_json || "[]"); } catch { ch = []; }
          fields = new Set(ch.map((c) => c.field));
        }
        let user; try { user = JSON.parse(r.user_json || "{}"); } catch { user = {}; }
        out.push({ type, id: String(r.entity_id), user, ts: Number(r.ts), fields });
      }
    }
  }
  return out;
};

/* sets op.author = { id, name, email, ts } or null on every operation (in place) and returns the ops */
export const attributeOps = async (ops) => {
  const keys = ops.flatMap((o) => o.src || []);
  if (!keys.length) return ops;
  const entries = await auditFor(keys);
  const index = new Map();   /* "type:id" → entries newest first */
  for (const e of entries) { const k = `${e.type}:${e.id}`; if (!index.has(k)) index.set(k, []); index.get(k).push(e); }
  for (const op of ops) {
    let best = null;
    for (const s of op.src || []) {
      const hit = (index.get(`${s.type}:${s.id}`) || []).find((e) => e.fields === null || e.fields.has(s.field));
      if (hit && (!best || hit.ts > best.ts)) best = hit;
    }
    op.author = best && best.user?.id ? { id: best.user.id, name: best.user.name || best.user.email || "", email: best.user.email || "", ts: best.ts } : null;
  }
  return ops;
};

/* may `user` write this operation? own changes always; unattributed ones for admins */
export const mayWrite = (op, user) => !!user && (op.author ? op.author.id === user.id : hasRole(user, "admin"));

/* the preview summary: what is mine, what belongs to whom, what has no author */
export const pendingSummary = (ops, user) => {
  const others = new Map();
  let mine = 0, unattributed = 0;
  for (const op of ops) {
    if (!op.author) unattributed++;
    else if (op.author.id === user?.id) mine++;
    else { const k = op.author.id; if (!others.has(k)) others.set(k, { id: k, name: op.author.name, count: 0 }); others.get(k).count++; }
  }
  return { mine, unattributed, others: [...others.values()].sort((a, b) => b.count - a.count), writable: ops.filter((o) => mayWrite(o, user)).length };
};
