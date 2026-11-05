/* Account administration use cases (v1.73, F-S7 — the PATCH /admin/users/:id route used to sniff its body and run
   either case inline; it now only dispatches). Both take the stored account row `u` and the acting admin, validate,
   persist, audit and return the changed fields; refusals throw with status 400 for ah(). */
import { q } from "./db.js";
import { ROLES, highestRole, parseRoles, isAgentAccount } from "./config.js";
import { isLastAdmin, emailTaken } from "./users.js";
import { sysAudit } from "./audit.js";

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/* the valid roles of a body: `roles[]` (deduplicated) or the single legacy `role` */
export const cleanRoles = (body) => Array.isArray(body?.roles) ? [...new Set(body.roles.filter((r) => ROLES.includes(r)))] : (ROLES.includes(body?.role) ? [body.role] : []);
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

/* which use case a PATCH body asks for: any role field → roles, otherwise name / e-mail */
export const isRoleChange = (body) => body?.role !== undefined || body?.roles !== undefined;

/* v1.74 (F-S8 of the third review): "agent" is one thing — an account in the @agents.local domain with the agent role,
   created only under User management › MCP agents. Login, password reset and safeUser go by the domain, key issuance
   by the role; an edit that let the two drift apart (a password account with MCP keys and no 2FA, or an agent that
   could receive a reset link) is refused. */
const isAgent = (u) => isAgentAccount(u) || parseRoles(u).includes("agent");

/* name / e-mail edit (admins may edit anyone incl. themselves) → { name, email } */
export const updateProfile = async (u, { name, email } = {}, actor) => {
  const nm = String(name ?? u.name).trim();
  const em = String(email ?? u.email).toLowerCase().trim();
  if (!nm) throw bad("Name is required");
  if (!EMAIL_RE.test(em)) throw bad("Valid e-mail required");
  if (isAgentAccount({ email: em }) !== isAgent(u)) throw bad(isAgent(u) ? "An agent account keeps its @agents.local address" : "Addresses in @agents.local are reserved for agent accounts (User management › MCP agents)");
  if (await emailTaken(em, u.id)) throw bad("Another account already uses this e-mail");
  await q("UPDATE users SET name = ?, email = ? WHERE id = ?", [nm, em, u.id]);
  const changes = [];
  if (nm !== u.name) changes.push({ field: "name", from: u.name, to: nm });
  if (em !== u.email) changes.push({ field: "email", from: u.email, to: em });
  if (changes.length) await sysAudit(actor, "user", "updated", em, changes);
  return { name: nm, email: em };
};

/* role change (never one's own; the last admin stays admin) → { role, roles } */
export const updateRoles = async (u, body, actor) => {
  if (u.id === actor.id) throw bad("You cannot change your own role");
  const roles = cleanRoles(body);
  if (!roles.length) throw bad("At least one valid role is required (" + ROLES.join(", ") + ")");
  if (roles.includes("agent") !== isAgent(u)) throw bad(isAgent(u) ? "An agent account keeps the agent role" : "The agent role is only for agent accounts (User management › MCP agents)");
  const role = highestRole(roles); /* permissions follow the highest role */
  if (u.role === "admin" && role !== "admin" && (await isLastAdmin(u))) throw bad("Cannot demote the last admin");
  await q("UPDATE users SET role = ?, roles = ? WHERE id = ?", [role, JSON.stringify(roles), u.id]);
  await sysAudit(actor, "user", "updated", u.email, [{ field: "roles", from: parseRoles(u).join(","), to: roles.join(",") }]);
  return { role, roles };
};
