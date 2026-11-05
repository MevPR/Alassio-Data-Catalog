/* /auth/* — bootstrap, password sign-in (+ TOTP), sessions, 2FA setup, invitations, password change / reset (v1.67), language */
import { Router } from "express";
import { q } from "../db.js";
import { UI_LANGS, COOKIE, isAgentAccount } from "../config.js";
import { scryptHash, scryptVerify, scryptDummy, scryptNeedsUpgrade, totpMatch, totpValid, newTotpSecret } from "../crypto.js";
import { ah, safeUser, startSession, endSession, revokeSessions, tokenHash, requireAuth, loginGate, loginFailed, loginOk } from "../auth.js";
import { sysAudit } from "../audit.js";
import { passwordLoginAllowed, AUTH_MODE } from "../identity.js";
import { mailEnabled } from "../mail.js";
import { ssoConfig } from "../sso.js";
import { countUsers, createUser, findByEmail, emailTaken } from "../users.js";
import { passwordProblem, issuePasswordReset, mailPasswordReset } from "../password-reset.js";

export function authRoutes() {
  const r = Router();

  r.get("/auth/bootstrap-needed", ah(async (req, res) => {
    res.json({ needed: (await countUsers()) === 0 && AUTH_MODE !== "header", mode: AUTH_MODE, mail: mailEnabled() });   /* mail: "forgot password" is offered only when SMTP is configured (v1.67) */
  }));
  r.post("/auth/bootstrap", ah(async (req, res) => {
    if ((await countUsers()) > 0) return res.status(403).json({ error: "Already initialised" });
    const { name, email, password } = req.body || {};
    if (!name || !email || passwordProblem(password)) return res.status(400).json({ error: "Name, e-mail and a password of at least 8 characters are required" });
    const u = await createUser({ name, email, role: "admin", passwordHash: await scryptHash(password) });
    await sysAudit(u, "user", "created", u.email, [{ field: "role", from: null, to: "admin" }]);
    await startSession(res, u, req);
    res.json({ user: { ...u, totpEnabled: false } });
  }));

  r.post("/auth/login", ah(async (req, res) => {
    const { email, password, code } = req.body || {};
    if (!(await loginGate(req, res, email))) return;
    if (!passwordLoginAllowed(await ssoConfig(), email)) return res.status(403).json({ error: AUTH_MODE === "header" ? "Sign-in is handled by your identity provider" : "Password sign-in is disabled — use \"Sign in with Microsoft\"", code: "sso_enforced" });
    const u = await findByEmail(email);
    if (u && isAgentAccount(u)) { loginFailed(req, email); return res.status(401).json({ error: "Agents sign in with their MCP key, not with a password" }); }
    if (!u || !(await scryptVerify(password || "", u.password_hash))) { if (!u) await scryptDummy(); loginFailed(req, email); return res.status(401).json({ error: "Wrong e-mail or password" }); }
    if (u.totp_enabled) {
      if (!code) return res.json({ need2fa: true });
      const ctr = totpMatch(u.totp_secret, code, u.totp_last_counter);   /* v1.66.1: a code is accepted once */
      if (ctr === null) { loginFailed(req, email); return res.status(401).json({ error: "Wrong authenticator code" }); }
      await q("UPDATE users SET totp_last_counter = ? WHERE id = ?", [ctr, u.id]);
    }
    if (scryptNeedsUpgrade(u.password_hash)) q("UPDATE users SET password_hash = ? WHERE id = ?", [await scryptHash(password), u.id]).catch(() => {});
    loginOk(req, email);
    await startSession(res, u, req);
    res.json({ user: safeUser(u) });
  }));
  r.post("/auth/logout", ah(async (req, res) => { await endSession(req, res); res.json({ ok: true }); }));
  r.get("/auth/me", requireAuth, (req, res) => res.json({ user: safeUser(req.user) }));

  /* 2FA */
  r.post("/auth/2fa/setup", requireAuth, ah(async (req, res) => {
    const secret = newTotpSecret();
    await q("UPDATE users SET totp_pending = ? WHERE id = ?", [secret, req.user.id]);
    const label = encodeURIComponent(`Alassio Data Catalog:${req.user.email}`);
    res.json({ secret, otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent("Alassio Data Catalog")}` });
  }));
  r.post("/auth/2fa/enable", requireAuth, ah(async (req, res) => {
    const { code } = req.body || {};
    if (!(await loginGate(req, res, req.user.email))) return;   /* v1.66.1: 2FA endpoints share the login throttle */
    const ctr = req.user.totp_pending ? totpMatch(req.user.totp_pending, code) : null;
    if (ctr === null) { loginFailed(req, req.user.email); return res.status(400).json({ error: "Code does not match — check your authenticator app" }); }
    loginOk(req, req.user.email);
    await q("UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled = 1, totp_last_counter = ? WHERE id = ?", [ctr, req.user.id]);
    await sysAudit(req.user, "user", "updated", req.user.email, [{ field: "totpEnabled", from: false, to: true }]);
    res.json({ user: { ...safeUser(req.user), totpEnabled: true } });
  }));
  r.post("/auth/2fa/disable", requireAuth, ah(async (req, res) => {
    const { code } = req.body || {};
    if (!req.user.totp_enabled) return res.status(400).json({ error: "2FA is not enabled" });
    if (!(await loginGate(req, res, req.user.email))) return;
    if (!totpValid(req.user.totp_secret, code, req.user.totp_last_counter)) { loginFailed(req, req.user.email); return res.status(400).json({ error: "Wrong authenticator code" }); }
    loginOk(req, req.user.email);
    await q("UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?", [req.user.id]);
    await sysAudit(req.user, "user", "updated", req.user.email, [{ field: "totpEnabled", from: true, to: false }]);
    res.json({ user: { ...safeUser(req.user), totpEnabled: false } });
  }));

  /* invitations */
  r.post("/auth/accept-invite", ah(async (req, res) => {
    const { token: t, name, password } = req.body || {};
    const rows = await q("SELECT * FROM invites WHERE token = ? AND expires > ?", [tokenHash(t), Date.now()]);
    const inv = rows[0];
    if (!inv) return res.status(400).json({ error: "Invitation is invalid or has expired" });
    if (!name || passwordProblem(password)) return res.status(400).json({ error: "Name and a password of at least 8 characters are required" });
    if (await emailTaken(inv.email)) return res.status(400).json({ error: "An account with this e-mail already exists" });
    const u = await createUser({ name, email: inv.email, role: inv.role, roles: inv.roles ? JSON.parse(inv.roles) : [inv.role], passwordHash: await scryptHash(password) });
    await q("DELETE FROM invites WHERE token = ?", [tokenHash(t)]);
    await sysAudit(u, "user", "created", u.email, [{ field: "role", from: null, to: u.role }]);
    await startSession(res, u, req);
    res.json({ user: { ...u, totpEnabled: false } });
  }));

  /* ── passwords (v1.67, pentest L9) ── */
  /* change the own password: current password required, the other sessions of the account end */
  r.post("/auth/password", requireAuth, ah(async (req, res) => {
    const { current, password } = req.body || {};
    if (isAgentAccount(req.user)) return res.status(400).json({ error: "Agent accounts have no password — use MCP keys" });
    if (AUTH_MODE === "header") return res.status(400).json({ error: "Passwords are managed by your identity provider" });
    if (req.user.sso_sub) return res.status(400).json({ error: "This account signs in with Entra ID — change the password there" });
    const bad = passwordProblem(password);
    if (bad) return res.status(400).json({ error: bad });
    if (!(await loginGate(req, res, req.user.email))) return;
    if (!(await scryptVerify(current || "", req.user.password_hash))) { loginFailed(req, req.user.email); return res.status(400).json({ error: "The current password is wrong" }); }
    loginOk(req, req.user.email);
    if (current === password) return res.status(400).json({ error: "The new password must differ from the current one" });
    await q("UPDATE users SET password_hash = ? WHERE id = ?", [await scryptHash(password), req.user.id]);
    await revokeSessions(req.user.id, req.cookies?.[COOKIE] || null);
    await sysAudit(req.user, "user", "updated", req.user.email, [{ field: "password", from: null, to: "changed" }]);
    res.json({ ok: true });
  }));
  /* "forgot password": a reset link by e-mail — only with SMTP; the answer never reveals whether the account exists */
  r.post("/auth/forgot", ah(async (req, res) => {
    const em = String(req.body?.email || "").toLowerCase().trim();
    if (!mailEnabled()) return res.status(400).json({ error: "Password reset by e-mail is not available here — ask an administrator for a reset link", code: "no_mail" });
    if (AUTH_MODE === "header") return res.status(400).json({ error: "Passwords are managed by your identity provider" });
    if (!(await loginGate(req, res, em))) return;
    loginFailed(req, em);   /* every request counts against the sign-in throttle (no mail bombing) */
    const u = em ? await findByEmail(em) : null;
    if (u && !isAgentAccount(u) && !u.sso_sub && passwordLoginAllowed(await ssoConfig(), em)) {
      const { link } = await issuePasswordReset(u, null);
      await mailPasswordReset(u, link, null);
      await sysAudit({ id: u.id, name: u.name, email: u.email }, "user", "updated", u.email, [{ field: "passwordReset", from: null, to: "link mailed" }]);
    }
    res.json({ ok: true });
  }));
  /* the reset link: whom it is for (the token is 192 bits of randomness, so this does not enumerate accounts) */
  r.get("/auth/reset-info", ah(async (req, res) => {
    const rows = await q("SELECT u.email FROM password_resets p JOIN users u ON u.id = p.user_id WHERE p.token = ? AND p.expires > ?", [tokenHash(String(req.query.token || "")), Date.now()]);
    if (!rows.length) return res.status(400).json({ error: "The reset link is invalid or has expired" });
    res.json({ email: rows[0].email });
  }));
  /* set a new password with a reset link; every session of the account ends, 2FA stays as it is; sign in afterwards */
  r.post("/auth/reset-password", ah(async (req, res) => {
    const { token: t, password } = req.body || {};
    const rows = await q("SELECT u.* FROM password_resets p JOIN users u ON u.id = p.user_id WHERE p.token = ? AND p.expires > ?", [tokenHash(String(t || "")), Date.now()]);
    const u = rows[0];
    if (!u) return res.status(400).json({ error: "The reset link is invalid or has expired" });
    const bad = passwordProblem(password);
    if (bad) return res.status(400).json({ error: bad });
    await q("UPDATE users SET password_hash = ? WHERE id = ?", [await scryptHash(password), u.id]);
    await q("DELETE FROM password_resets WHERE user_id = ?", [u.id]);
    await revokeSessions(u.id);
    loginOk(req, u.email);
    await sysAudit({ id: u.id, name: u.name, email: u.email }, "user", "updated", u.email, [{ field: "password", from: null, to: "reset" }]);
    res.json({ ok: true, email: u.email });
  }));

  /* user language preference */
  r.patch("/auth/me/lang", requireAuth, ah(async (req, res) => {
    const lang = UI_LANGS.includes(req.body?.lang) ? req.body.lang : "en";
    await q("UPDATE users SET lang = ? WHERE id = ?", [lang, req.user.id]); res.json({ lang });
  }));
  return r;
}
