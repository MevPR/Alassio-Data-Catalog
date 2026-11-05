/* MCP keys for accounts with the role "agent" (no 2FA on this path by design). */
import crypto from "crypto";
import { q } from "./db.js";
import { hasRole, parseRoles } from "./config.js";
import { keyHash } from "./crypto.js";
import { sysAudit } from "./audit.js";

export const keyRow = (k) => ({ id: k.id, name: k.name, prefix: k.prefix, scope: k.scope || "write", createdBy: k.created_by, createdTs: Number(k.created_ts), lastUsedTs: k.last_used_ts ? Number(k.last_used_ts) : null, revokedTs: k.revoked_ts ? Number(k.revoked_ts) : null });
export const resolveAgentKey = async (key) => {
  if (!key || key.length < 20) return null;
  const rows = await q("SELECT k.id AS key_id, k.scope AS key_scope, u.* FROM agent_keys k JOIN users u ON u.id = k.user_id WHERE k.key_hash = ? AND k.revoked_ts IS NULL", [keyHash(key)]);
  if (!rows.length) return null;
  const u = rows[0]; u.roles = parseRoles(u); u.scope = u.key_scope || "write";
  if (!hasRole(u, "agent")) return null;
  q("UPDATE agent_keys SET last_used_ts = ? WHERE id = ?", [Date.now(), u.key_id]).catch(() => {});
  return u;
};
export const issueKey = async (u, name, by, scope = "write") => {
  if (!hasRole(u, "agent")) throw Object.assign(new Error("Keys can only be issued to accounts with the role Agent"), { status: 400 });
  scope = scope === "read" ? "read" : "write";
  const key = "cxk_" + crypto.randomBytes(24).toString("base64url");
  const id = crypto.randomUUID();
  await q("INSERT INTO agent_keys (id, user_id, name, key_hash, prefix, scope, created_by, created_ts) VALUES (?,?,?,?,?,?,?,?)", [id, u.id, String(name || "MCP client").slice(0, 250), keyHash(key), key.slice(0, 10), scope, by.email, Date.now()]);
  await sysAudit(by, "user", "updated", u.email, [{ field: "agent key", from: null, to: `issued (${key.slice(0, 10)}…, ${scope})` }]);
  return { id, key, scope };
};
export const revokeKey = async (id) => q("UPDATE agent_keys SET revoked_ts = ? WHERE id = ?", [Date.now(), id]);
export const keysOfUser = async (userId) => (await q("SELECT * FROM agent_keys WHERE user_id = ? ORDER BY created_ts DESC", [userId])).map(keyRow);
