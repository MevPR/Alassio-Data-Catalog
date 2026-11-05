/* Users repository (v1.68 adminCount / isLastAdmin; v1.70 the rest — the SELECT / INSERT statements that routes,
   the identity layer and the OAuth server used to repeat). Rows come back as stored (password_hash, totp_* …);
   callers pass them through safeUser() before they leave the server. */
import { q } from "./db.js";
import { uid } from "./crypto.js";
import { parseRoles } from "./config.js";

export const countUsers = async () => Number((await q("SELECT COUNT(*) AS n FROM users"))[0].n);
export const adminCount = async () => Number((await q("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"))[0].n);
/* true when `u` is the only admin left — such an account can neither be demoted, deleted nor locked out */
export const isLastAdmin = async (u) => (u?.role === "admin" || (u?.roles || []).includes("admin")) && (await adminCount()) <= 1;

export const findUser = async (id) => (await q("SELECT * FROM users WHERE id = ?", [id]))[0] || null;
export const findByEmail = async (email) => (await q("SELECT * FROM users WHERE email = ?", [String(email || "").toLowerCase()]))[0] || null;
/* the account an external identity maps to: by provider subject first, then by e-mail */
export const findBySsoSubOrEmail = async (sub, email) => (await q(sub ? "SELECT * FROM users WHERE sso_sub = ? OR email = ?" : "SELECT * FROM users WHERE email = ?", sub ? [sub, email] : [email]))[0] || null;
/* findUser() that throws the 404 ah() turns into the response */
export const requireUser = async (id) => { const u = await findUser(id); if (!u) throw Object.assign(new Error("User not found"), { status: 404 }); return u; };
/* findUser() with the roles column parsed — what the OAuth server and the agent-key routes need */
export const findUserWithRoles = async (id) => { const u = await findUser(id); if (u) u.roles = parseRoles(u); return u; };
export const emailTaken = async (email, exceptId = null) => (await q(exceptId ? "SELECT id FROM users WHERE email = ? AND id <> ?" : "SELECT id FROM users WHERE email = ?", exceptId ? [email, exceptId] : [email])).length > 0;
export const listUsers = () => q("SELECT * FROM users ORDER BY created_at");
/* the lower-cased e-mails of every account — notifications go only to people who have one */
export const emailSet = async () => new Set((await q("SELECT email FROM users")).map((u) => String(u.email).toLowerCase()));

/* the one INSERT: `passwordHash` is already hashed by the caller (scryptHash); `roles` defaults to [role] */
export const createUser = async ({ id = uid(), name, email, role, roles = null, passwordHash, ssoSub = null }) => {
  const list = roles && roles.length ? roles : [role];
  const u = { id, name, email: String(email).toLowerCase(), role, roles: list };
  await q("INSERT INTO users (id,name,email,role,roles,password_hash,totp_enabled,created_at,sso_sub) VALUES (?,?,?,?,?,?,0,?,?)", [u.id, u.name, u.email, u.role, JSON.stringify(list), passwordHash, Date.now(), ssoSub]);
  return u;
};
