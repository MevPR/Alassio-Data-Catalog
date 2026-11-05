/* /admin/users, /admin/invite — accounts, roles, invitations and password resets (admins only) */
import { Router } from "express";
import { q } from "../db.js";
import { APP_URL, ROLES, highestRole, isAgentAccount } from "../config.js";
import { isLastAdmin, listUsers, requireUser, emailTaken } from "../users.js";
import { EMAIL_RE, cleanRoles, isRoleChange, updateProfile, updateRoles } from "../user-admin.js";
import { token } from "../crypto.js";
import { ah, safeUser, requireRole, tokenHash } from "../auth.js";
import { sysAudit } from "../audit.js";
import { mailEnabled, sendMail } from "../mail.js";
import { issuePasswordReset, mailPasswordReset, RESET_HOURS } from "../password-reset.js";

export function adminUserRoutes() {
  const r = Router();
  r.get("/admin/users", requireRole("admin"), ah(async (req, res) => {
    const users = await listUsers();
    const invites = await q("SELECT * FROM invites WHERE expires > ?", [Date.now()]);
    res.json({
      users: users.map(safeUser),
      /* v1.67: tokens are stored hashed — the link exists only in the invitation response (and the e-mail); "renew" issues a new one */
      invites: invites.map((i) => ({ email: i.email, role: i.role, roles: i.roles ? JSON.parse(i.roles) : [i.role], expires: Number(i.expires) })),
    });
  }));

  r.post("/admin/invite", requireRole("admin"), ah(async (req, res) => {
    const roles = cleanRoles(req.body);
    const role = highestRole(roles);
    const em = String(req.body?.email || "").toLowerCase().trim();
    if (!EMAIL_RE.test(em)) return res.status(400).json({ error: "Valid e-mail required" });
    if (!roles.length) return res.status(400).json({ error: "At least one valid role is required (" + ROLES.join(", ") + ")" });
    if (await emailTaken(em)) return res.status(400).json({ error: "An account with this e-mail already exists" });
    await q("DELETE FROM invites WHERE email = ?", [em]);
    const inv = { token: token(), email: em, role, roles, invitedBy: req.user.id, expires: Date.now() + 7 * 864e5 };
    await q("INSERT INTO invites (token,email,role,roles,invited_by,expires) VALUES (?,?,?,?,?,?)", [tokenHash(inv.token), inv.email, inv.role, JSON.stringify(roles), inv.invitedBy, inv.expires]);
    await sysAudit(req.user, "user", "invited", em, [{ field: "role", from: null, to: role }]);
    const link = `${APP_URL}/?invite=${inv.token}`;
    let mailed = false, mailError = null;
    if (mailEnabled()) {
      try {
        await sendMail({ to: em, subject: "Invitation — Alassio Data Catalog", text: `${req.user.name} invited you to the Alassio Data Catalog as ${role}.\n\nAccept your invitation within 7 days:\n${link}\n` });
        mailed = true;
      } catch (e) { mailError = e.message; }
    }
    res.json({ link, mailed, mailError, role, roles });
  }));

  /* withdraw an open invitation (v1.67) */
  r.delete("/admin/invites/:email", requireRole("admin"), ah(async (req, res) => {
    const em = String(req.params.email || "").toLowerCase().trim();
    const r0 = await q("DELETE FROM invites WHERE email = ?", [em]);
    if (!r0.affectedRows) return res.status(404).json({ error: "No open invitation for this e-mail" });
    await sysAudit(req.user, "user", "deleted", `invitation ${em}`);
    res.json({ ok: true });
  }));

  /* password reset link for an account (v1.67, pentest L9): valid 24 h, mailed when SMTP is configured, shown once */
  r.post("/admin/users/:id/reset-password", requireRole("admin"), ah(async (req, res) => {
    const u = await requireUser(req.params.id);
    if (isAgentAccount(u)) return res.status(400).json({ error: "Agent accounts have no password — manage their MCP keys instead" });
    if (u.sso_sub) return res.status(400).json({ error: "This account signs in with Entra ID — the password is managed there" });
    const { link, expires } = await issuePasswordReset(u, req.user);
    const m = await mailPasswordReset(u, link, req.user.name);
    await sysAudit(req.user, "user", "updated", u.email, [{ field: "passwordReset", from: null, to: m.mailed ? "link mailed" : "link issued" }]);
    res.json({ link, expires, hours: RESET_HOURS, ...m });
  }));

  /* one endpoint, two use cases (server/user-admin.js, v1.73): role fields → updateRoles, otherwise name / e-mail */
  r.patch("/admin/users/:id", requireRole("admin"), ah(async (req, res) => {
    const u = await requireUser(req.params.id);
    const body = req.body || {};
    const changed = isRoleChange(body) ? await updateRoles(u, body, req.user) : await updateProfile(u, body, req.user);
    res.json({ user: { ...safeUser(u), ...changed } });
  }));

  r.delete("/admin/users/:id", requireRole("admin"), ah(async (req, res) => {
    const u = await requireUser(req.params.id);
    if (u.id === req.user.id) return res.status(400).json({ error: "You cannot delete yourself" });
    if (await isLastAdmin(u)) return res.status(400).json({ error: "Cannot delete the last admin" });
    await q("DELETE FROM users WHERE id = ?", [u.id]);
    await q("DELETE FROM sessions WHERE user_id = ?", [u.id]);
    await q("DELETE FROM password_resets WHERE user_id = ?", [u.id]);
    await sysAudit(req.user, "user", "deleted", u.email);
    res.json({ ok: true });
  }));
  return r;
}
