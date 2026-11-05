/* OAuth 2.1 endpoints for MCP clients (v1.58): discovery, dynamic registration, consent, token, revocation and the
   "connected apps" self-service. Authorization needs a signed-in browser session (the consent page); the token and
   registration endpoints are public and client-authenticated (no session cookie, so no CSRF header — see security.js). */
import { Router } from "express";
import express from "express";
import { COOKIE, hasRole } from "../config.js";
import { ah, requireAuth } from "../auth.js";
import { csrfFor, requireCsrfBody, CSP } from "../security.js";
import { sysAudit } from "../audit.js";
import { metadata, resourceMetadata, registerClient, validateAuthorizeRequest, issueCode, tokenGrant, revokeToken, connectedApps, revokeApp, consentPage, rateLimits } from "../oauth.js";

const form = express.urlencoded({ extended: false, limit: "64kb" });
const jsonOrForm = [express.json({ limit: "64kb" }), form];
/* the consent form posts to /oauth/authorize and is then redirected to the client's redirect_uri — browsers apply
   form-action to that redirect, so the consent responses get a CSP without the form-action restriction */
const consentCsp = (res) => res.setHeader("Content-Security-Policy", CSP.split("; ").filter((d) => !d.startsWith("form-action")).join("; "));
const withParams = (url, params) => { const u = new URL(url); for (const [k, v] of Object.entries(params)) if (v != null && v !== "") u.searchParams.set(k, v); return u.toString(); };
const oauthFail = (res, e) => res.status(e.status || 400).json({ error: e.code || "invalid_request", error_description: e.message });

export function oauthRoutes() {
  const r = Router();
  const noStore = (res) => res.setHeader("Cache-Control", "no-store");

  /* discovery (RFC 8414 / RFC 9728) */
  r.get(["/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/mcp"], (req, res) => res.json(metadata()));
  r.get(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"], (req, res) => res.json(resourceMetadata()));

  /* dynamic client registration (RFC 7591) */
  r.post("/oauth/register", ...jsonOrForm, ah(async (req, res) => {
    noStore(res);
    try { res.status(201).json(await registerClient(req.body || {}, req.ip)); } catch (e) { oauthFail(res, e); }
  }));

  /* authorization: needs a browser session — otherwise bounce through the SPA login, which returns to `next` */
  r.get("/oauth/authorize", ah(async (req, res) => {
    noStore(res);
    if (!req.user) return res.redirect(`/?next=${encodeURIComponent(req.originalUrl)}`);
    if (hasRole(req.user, "agent")) return res.status(403).send("Agent accounts cannot authorize applications");
    const v = await validateAuthorizeRequest(req.query);
    if (v.error) return v.redirect ? res.redirect(withParams(v.redirect, { error: v.error, error_description: v.description, state: v.state })) : res.status(400).json({ error: v.error, error_description: v.description });
    consentCsp(res);
    res.type("html").send(consentPage({ client: v.client, user: req.user, scopes: v.scopes, state: v.state, redirect: v.redirect, challenge: v.challenge, csrf: csrfFor(req.cookies?.[COOKIE]) }));
  }));
  r.post("/oauth/authorize", form, ah(async (req, res) => {
    noStore(res);
    if (!req.user) return res.status(401).send("Not signed in");
    if (!requireCsrfBody(req, res)) return;
    const v = await validateAuthorizeRequest({ ...req.body, response_type: "code", code_challenge_method: "S256" });
    if (v.error) return v.redirect ? res.redirect(withParams(v.redirect, { error: v.error, error_description: v.description, state: v.state })) : res.status(400).json({ error: v.error, error_description: v.description });
    consentCsp(res);
    if (req.body.decision !== "allow") return res.redirect(withParams(v.redirect, { error: "access_denied", state: v.state }));
    const code = await issueCode({ client: v.client, user: req.user, redirect: v.redirect, scopes: v.scopes, challenge: v.challenge });
    await sysAudit(req.user, "user", "updated", req.user.email, [{ field: "oauth", from: null, to: `authorized ${v.client.name} (${v.scopes.join(" ")})` }]);
    res.redirect(withParams(v.redirect, { code, state: v.state }));
  }));

  /* token + revocation (RFC 6749 §5 / RFC 7009) */
  r.post("/oauth/token", ...jsonOrForm, ah(async (req, res) => {
    noStore(res); res.setHeader("Pragma", "no-cache");
    try { res.json(await tokenGrant(req.body || {})); } catch (e) { oauthFail(res, e); }
  }));
  r.post("/oauth/revoke", ...jsonOrForm, ah(async (req, res) => { noStore(res); await revokeToken(req.body || {}); res.status(200).json({ ok: true }); }));

  /* connected apps: own (any signed-in user) or all (admins) */
  r.get("/oauth/apps", requireAuth, ah(async (req, res) => {
    const all = req.query.all === "1" && hasRole(req.user, "admin");
    res.json({ apps: await connectedApps(all ? null : req.user.id), limits: rateLimits() });
  }));
  r.delete("/oauth/apps/:clientId", requireAuth, ah(async (req, res) => {
    const target = req.query.userId && hasRole(req.user, "admin") ? String(req.query.userId) : req.user.id;
    res.json({ ok: true, revoked: await revokeApp(req.params.clientId, target, req.user) });
  }));
  return r;
}
