/* Audit trail rows (record-level diffs of catalog documents and system events). */
import crypto from "crypto";
import { q, sql } from "./db.js";
import { auditUserRef } from "../catalog-diff.js";

const AUDIT_COLS = "id,ts,user_json,action,entity_type,entity_id,name,context,scope_json,changes_json,before_json,after_json";
const auditVals = (e) => [e.id, e.ts, JSON.stringify(e.user), e.action, e.entityType, String(e.entityId).slice(0, 128), (e.name || "").slice(0, 760), (e.context || "").slice(0, 760),
  JSON.stringify(e.scope || []), e.changes ? JSON.stringify(e.changes) : null, e.before ? JSON.stringify(e.before) : null, e.after ? JSON.stringify(e.after) : null];
/* multi-row inserts in chunks (a bulk import may carry hundreds of entries) */
export const insertAudit = async (conn, entries, chunk = 200) => {
  for (let i = 0; i < entries.length; i += chunk) {
    const part = entries.slice(i, i + chunk);
    await conn.query(`INSERT INTO audit (${AUDIT_COLS}) VALUES ${part.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?)").join(",")}`, part.flatMap(auditVals));
  }
};
export const sysAudit = async (user, entityType, action, name, changes) => {
  await q(`INSERT INTO audit (id,ts,user_json,action,entity_type,entity_id,name,context,scope_json,changes_json)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [crypto.randomUUID(), Date.now(), JSON.stringify(auditUserRef(user)), action, entityType, name.slice(0, 128), name, "", "[]",
     changes ? JSON.stringify(changes) : null]);
};
export const rowToEntry = (r) => ({
  id: r.id, ts: Number(r.ts), user: JSON.parse(r.user_json || "{}"), action: r.action,
  entityType: r.entity_type, entityId: r.entity_id, name: r.name, context: r.context,
  scope: JSON.parse(r.scope_json || "[]"),
  ...(r.changes_json ? { changes: JSON.parse(r.changes_json) } : {}),
  ...(r.before_json ? { before: JSON.parse(r.before_json) } : {}),
  ...(r.after_json ? { after: JSON.parse(r.after_json) } : {}),
});
/* audit query shared by /api/audit and the MCP tool */
export const queryAudit = async ({ scopeId, type, q: qq, before, limit = 150, max = 500, hideUsers = false, hideSystem = false } = {}) => {
  const where = [], params = [];
  if (hideUsers && hideSystem) where.push("entity_type NOT IN ('user','system')");
  else if (hideUsers) where.push("entity_type NOT IN ('user')");
  if (type) { where.push("entity_type = ?"); params.push(type); }
  if (scopeId) { where.push(`(entity_id = ? OR ${sql.jsonContains("scope_json")})`); params.push(scopeId, scopeId); }
  if (qq) { where.push(`(name ${sql.like} ? OR context ${sql.like} ? OR user_json ${sql.like} ?)`); const like = `%${qq}%`; params.push(like, like, like); }
  if (before) { where.push("ts < ?"); params.push(Number(before)); }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const lim = Math.min(Number(limit) || 150, max);
  const [{ n }] = await q(`SELECT COUNT(*) AS n FROM audit ${w}`, params);
  const rows = await q(`SELECT * FROM audit ${w} ORDER BY ts DESC LIMIT ${lim}`, params);
  return { entries: rows.map(rowToEntry), total: Number(n) };
};
