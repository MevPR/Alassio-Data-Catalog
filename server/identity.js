/* Identity layer (v1.59, PLAN.md item 2): one place that turns an external identity — Entra ID claims, trusted
   reverse-proxy headers (Databricks Apps, oauth2-proxy, …) — into a catalog account with roles.

   • Group → role mapping (setting sso.groups): rules { group, roles[] } matched against the groups the identity
     provider delivers (Entra: `groups` / `roles` claims; header mode: a groups header or the Databricks SCIM /Me
     lookup). With `syncRoles` the account's roles follow the groups on every sign-in; without it the mapping only
     decides the roles of newly provisioned accounts.
   • AUTH_MODE=header: the app trusts identity headers set by an authenticating proxy in front of it (no password
     login, no local 2FA). Header names are configurable; AUTH_HEADER_SECRET requires a shared secret header so a
     client that reaches the Node port directly cannot impersonate anyone. AUTH_BOOTSTRAP_ADMINS names the e-mails
     that become admins when they first appear (otherwise the first-ever user becomes admin, as with bootstrap).
   • SSO enforcement (setting sso.entra.enforce): password sign-in is refused except for break-glass accounts. */
import { safeEqual } from "./security.js";
import { q } from "./db.js";
import { ROLES, highestRole, parseRoles, hasRole } from "./config.js";
import { scryptHash, randomPassword } from "./crypto.js";
import { sysAudit } from "./audit.js";
import { getSetting, setSetting } from "./settings.js";
import { isLastAdmin, countUsers, createUser, findBySsoSubOrEmail } from "./users.js";

export const AUTH_MODE = /^header$/i.test(process.env.AUTH_MODE || "") ? "header" : "local";
export const HEADER_CFG = {
  email: (process.env.AUTH_HEADER_EMAIL || "x-forwarded-email").toLowerCase(),
  name: (process.env.AUTH_HEADER_NAME || "x-forwarded-preferred-username").toLowerCase(),
  user: (process.env.AUTH_HEADER_USER || "x-forwarded-user").toLowerCase(),
  groups: (process.env.AUTH_HEADER_GROUPS || "x-forwarded-groups").toLowerCase(),
  token: (process.env.AUTH_HEADER_TOKEN || "x-forwarded-access-token").toLowerCase(),
  secretHeader: (process.env.AUTH_HEADER_SECRET_NAME || "x-auth-proxy-secret").toLowerCase(),
  secret: process.env.AUTH_HEADER_SECRET || "",
  groupsFrom: (process.env.AUTH_GROUPS_FROM || "").toLowerCase(),   /* "databricks" → SCIM /Me with the forwarded token */
  bootstrapAdmins: String(process.env.AUTH_BOOTSTRAP_ADMINS || "").split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean),
};

/* ── group → role mapping ── */
const ASSIGNABLE = ROLES.filter((r) => r !== "agent");
export const GROUPS_DEFAULT = { rules: [], syncRoles: false, unmatched: "default" };   /* unmatched: "default" (provider default roles) | "deny" */
export const groupMapping = async () => ({ ...GROUPS_DEFAULT, ...(await getSetting("sso.groups", {})) });
export const saveGroupMapping = async (body, by) => {
  const rules = (Array.isArray(body?.rules) ? body.rules : []).map((r) => ({ group: String(r.group || "").trim(), roles: (Array.isArray(r.roles) ? r.roles : []).filter((x) => ASSIGNABLE.includes(x)) }))
    .filter((r) => r.group && r.roles.length).slice(0, 200);
  const next = { rules, syncRoles: !!body?.syncRoles, unmatched: body?.unmatched === "deny" ? "deny" : "default" };
  await setSetting("sso.groups", next, by);
  return next;
};
/* pure: the roles a set of groups maps to (case-insensitive match on group id or name); null = no rule matched */
export const rolesForGroups = (mapping, groups) => {
  const have = new Set((groups || []).map((g) => String(g).trim().toLowerCase()).filter(Boolean));
  const roles = new Set();
  let matched = false;
  for (const rule of mapping?.rules || []) if (have.has(rule.group.toLowerCase())) { matched = true; for (const r of rule.roles) roles.add(r); }
  return matched ? [...roles] : null;
};
const sameRoles = (a, b) => a.length === b.length && a.every((r) => b.includes(r));

/* ── provisioning shared by every external provider ── */
/* identity: { email, name, sub, groups?: string[], provider: "entra" | "header" }
   policy:   { autoProvision, defaultRoles, mapping }  →  { user, created, rolesChanged } or throws { status, message } */
export const resolveExternalIdentity = async (identity, policy) => {
  const email = String(identity.email || "").toLowerCase().trim();
  if (!email) throw Object.assign(new Error("The identity provider did not deliver an e-mail address"), { status: 400 });
  const sub = identity.sub ? String(identity.sub) : null;
  const mapping = policy.mapping || GROUPS_DEFAULT;
  const mapped = identity.groups ? rolesForGroups(mapping, identity.groups) : null;
  let u = await findBySsoSubOrEmail(sub, email);
  const actor = { id: identity.provider, name: identity.provider === "entra" ? "Entra ID" : "Identity proxy", email: `${identity.provider}@identity` };
  if (!u) {
    const firstUser = (await countUsers()) === 0, bootstrapAdmin = HEADER_CFG.bootstrapAdmins.includes(email);
    if (!policy.autoProvision && !firstUser && !bootstrapAdmin) throw Object.assign(new Error(`No catalog account for ${email} — ask an admin for an invitation`), { status: 403 });
    if (identity.groups && mapped === null && mapping.unmatched === "deny" && !firstUser && !bootstrapAdmin) throw Object.assign(new Error(`${email} is in no group that grants access to the catalog`), { status: 403 });
    const roles = firstUser || bootstrapAdmin ? ["admin"] : (mapped?.length ? mapped : (policy.defaultRoles?.length ? policy.defaultRoles : ["guest"]));
    u = await createUser({ name: String(identity.name || email).slice(0, 255), email, role: highestRole(roles), roles, passwordHash: await scryptHash(randomPassword()), ssoSub: sub });
    await sysAudit(actor, "user", "created", u.email, [{ field: "roles", from: null, to: roles.join(",") }, { field: "provider", from: null, to: identity.provider }]);
    return { user: { ...u, sso_sub: sub, totp_enabled: 0 }, created: true, rolesChanged: false };
  }
  u.roles = parseRoles(u);
  if (hasRole(u, "agent")) throw Object.assign(new Error("Agent accounts cannot sign in interactively"), { status: 403 });
  if (sub && !u.sso_sub) await q("UPDATE users SET sso_sub = ? WHERE id = ?", [sub, u.id]);
  let rolesChanged = false;
  const bootstrapAdmin = HEADER_CFG.bootstrapAdmins.includes(email);
  if (mapping.syncRoles && identity.groups && !bootstrapAdmin) {   /* bootstrap admins are the break-glass of header mode: mappings never touch them */
    const lastAdmin = () => isLastAdmin(u);
    if (mapped === null && mapping.unmatched === "deny") {
      if (await lastAdmin()) return { user: u, created: false, rolesChanged: false };   /* never lock the last admin out */
      throw Object.assign(new Error(`${email} is in no group that grants access to the catalog`), { status: 403 });
    }
    const target = mapped?.length ? [...mapped] : (policy.defaultRoles?.length ? [...policy.defaultRoles] : ["guest"]);
    /* never let a mapping demote the last admin */
    if (hasRole(u, "admin") && !target.includes("admin") && (await lastAdmin())) target.push("admin");
    if (!sameRoles(target, u.roles)) {
      await q("UPDATE users SET role = ?, roles = ? WHERE id = ?", [highestRole(target), JSON.stringify(target), u.id]);
      await sysAudit(actor, "user", "updated", u.email, [{ field: "roles", from: u.roles.join(","), to: target.join(",") }]);
      u.role = highestRole(target); u.roles = target; rolesChanged = true;
    }
  }
  return { user: u, created: false, rolesChanged };
};

/* ── header mode: identity from the authenticating proxy ── */
const groupsCache = new Map();   /* token hash → { groups, until } */
const databricksGroups = async (token) => {
  const host = String(process.env.DATABRICKS_HOST || "").replace(/\/$/, "").replace(/^(?!https?:\/\/)/, "https://");
  if (!host || !token) return null;
  const key = token.slice(-32);
  const hit = groupsCache.get(key); if (hit && hit.until > Date.now()) return hit.groups;
  try {
    const r = await fetch(`${host}/api/2.0/preview/scim/v2/Me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) { console.warn(`Databricks groups lookup (SCIM /Me): HTTP ${r.status} — check the app's user-authorization scope iam.current-user:read`); groupsCache.set(key, { groups: null, until: Date.now() + 60000 }); return null; }
    const me = await r.json();
    const groups = (me.groups || []).map((g) => g.display || g.value).filter(Boolean);
    groupsCache.set(key, { groups, until: Date.now() + 5 * 60000 });
    if (groupsCache.size > 2000) groupsCache.clear();
    return groups;
  } catch { return null; }
};
/* returns the identity carried by the request headers, or null (not in header mode / no identity / bad secret) */
if (AUTH_MODE === "header" && !HEADER_CFG.secret) console.warn("WARNING: AUTH_MODE=header without AUTH_HEADER_SECRET — every request that can reach this port directly may impersonate any user; set AUTH_HEADER_SECRET and configure the proxy to send it (v1.66.1 security review)");
export const headerIdentity = async (req) => {
  if (AUTH_MODE !== "header") return null;
  if (HEADER_CFG.secret && !safeEqual(req.headers[HEADER_CFG.secretHeader], HEADER_CFG.secret)) return null;
  const email = String(req.headers[HEADER_CFG.email] || "").toLowerCase().trim();
  if (!email || !email.includes("@")) return null;
  const name = String(req.headers[HEADER_CFG.name] || req.headers[HEADER_CFG.user] || "").trim() || email;
  let groups = null;
  const raw = req.headers[HEADER_CFG.groups];
  if (raw) groups = String(raw).split(/[,;]/).map((g) => g.trim()).filter(Boolean);
  else if (HEADER_CFG.groupsFrom === "databricks") groups = await databricksGroups(String(req.headers[HEADER_CFG.token] || ""));
  return { email, name, sub: null, groups, provider: "header" };
};
export const headerPolicy = async () => ({ autoProvision: process.env.AUTH_HEADER_AUTOPROVISION !== "0", defaultRoles: String(process.env.AUTH_HEADER_DEFAULT_ROLES || "guest").split(/[,\s]+/).filter((r) => ASSIGNABLE.includes(r)), mapping: await groupMapping() });

/* ── SSO enforcement (password sign-in only for break-glass accounts) ── */
export const passwordLoginAllowed = (ssoCfg, email) => {
  if (AUTH_MODE === "header") return false;
  if (!ssoCfg?.enabled || !ssoCfg?.enforce) return true;
  return (ssoCfg.breakGlass || []).map((e) => String(e).toLowerCase()).includes(String(email || "").toLowerCase());
};
export const identityInfo = () => ({ mode: AUTH_MODE, headers: AUTH_MODE === "header" ? { email: HEADER_CFG.email, name: HEADER_CFG.name, groups: HEADER_CFG.groups, groupsFrom: HEADER_CFG.groupsFrom || null, secretRequired: !!HEADER_CFG.secret } : null });

/* MCP behind an authenticating proxy (Databricks Apps, v1.61): the platform has already verified the caller and
   forwards the identity headers, so the MCP request acts as that human — write scope follows the editing roles,
   exactly like an OAuth token. Returns null when the request carries no (trusted) identity; { error } when the
   identity is denied by the group mapping. */
export const forwardedMcpIdentity = async (req) => {
  const idn = await headerIdentity(req);
  if (!idn) return null;
  try {
    const { user } = await resolveExternalIdentity(idn, await headerPolicy());
    const roles = parseRoles(user);
    return { id: user.id, name: user.name, email: user.email, role: user.role, roles, scope: roles.includes("admin") || roles.includes("steward") ? "write" : "read", identity: "header" };
  } catch (e) { return { error: e.message }; }
};
