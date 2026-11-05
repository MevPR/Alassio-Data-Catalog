/* Entra ID sign-in routes and the SSO admin settings (v1.70: logic in server/sso.js) */
import { Router } from "express";
import { ROLES } from "../config.js";
import { ah, requireRole, startSession } from "../auth.js";
import { sysAudit } from "../audit.js";
import { groupMapping, saveGroupMapping, identityInfo } from "../identity.js";
import { ssoConfig, ssoPublic, saveSsoConfig, beginSsoLogin, completeSsoLogin, redirectUri, MASK } from "../sso.js";

export function ssoRoutes() {
  const r = Router();
  r.get("/auth/sso/config", ah(async (req, res) => res.json(ssoPublic(await ssoConfig()))));
  r.get("/admin/sso", requireRole("admin"), ah(async (req, res) => { const c = await ssoConfig(); res.json({ ...c, clientSecret: c.clientSecret ? MASK : "", hasSecret: !!c.clientSecret, redirectUri: redirectUri() }); }));
  r.put("/admin/sso", requireRole("admin"), ah(async (req, res) => res.json({ ok: true, ...ssoPublic(await saveSsoConfig(req.body || {}, req.user)) })));
  /* group → role mapping shared by Entra and header mode (v1.59) */
  r.get("/admin/sso/groups", requireRole("admin"), ah(async (req, res) => res.json({ mapping: await groupMapping(), identity: identityInfo(), roles: ROLES.filter((x) => x !== "agent") })));
  r.put("/admin/sso/groups", requireRole("admin"), ah(async (req, res) => {
    const before = await groupMapping();
    const next = await saveGroupMapping(req.body || {}, req.user);
    await sysAudit(req.user, "user", "updated", "group → role mapping", [{ field: "rules", from: String(before.rules.length), to: String(next.rules.length) }, { field: "syncRoles", from: String(before.syncRoles), to: String(next.syncRoles) }]);
    res.json({ mapping: next });
  }));
  r.get("/auth/identity", (req, res) => res.json({ ...identityInfo(), error: req.identityError || null }));
  r.get("/auth/sso/login", ah(async (req, res) => {
    const c = await ssoConfig(); if (!ssoPublic(c).enabled) return res.status(404).send("Entra sign-in is not enabled");
    res.redirect(await beginSsoLogin(c));
  }));
  r.get("/auth/sso/callback", ah(async (req, res) => {
    const { code, state, error, error_description } = req.query || {};
    const fail = (msg) => res.redirect(`/?sso_error=${encodeURIComponent(msg)}`);
    if (error) return fail(`${error}: ${error_description || ""}`);
    try {
      const u = await completeSsoLogin(await ssoConfig(), { code, state });
      await startSession(res, u, req);   /* Entra performs MFA — local 2FA is not asked again on this path */
      res.redirect("/");
    } catch (e) { console.error("SSO:", e.message); fail(e.message); }
  }));
  return r;
}
