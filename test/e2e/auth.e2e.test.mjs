/**
 * E2E — accounts and sessions: bootstrap/login, multi-role, agent keys, named agents, login rate limiting, Entra/SSO settings, CSRF and security headers, passwords.
 * v1.73 (F-T6): split out of the former server.e2e.test.mjs. This file resets the test database, boots its own server
 * on port 3982 (E2E_PORT_BASE + 2), bootstraps the admin, seeds hub → e2e_gold → prod → kpi and removes it again.
 * Run alone: DB_USER=… DB_PASSWORD=… DB_NAME=datahub_catalog_test node --test test/e2e/auth.e2e.test.mjs
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { ADMIN, MCP_TOKEN, requireDb, startSuite, cleanupTree, signIn } from "./helpers.mjs";

let S;   /* the running suite: { base, c (cookie client), m (MCP client), hubName, seeded, stop } */
const req = (...a) => S.c.req(...a);
const mcp = (...a) => S.m.call(...a);
const tool = (...a) => S.m.tool(...a);

describe("E2E auth", { skip: requireDb() }, () => {
  before(async () => {
    S = await startSuite({ name: "auth" });
    /* the lazy-catalog check needs at least one attribute on kpi */
    assert.equal((await tool("create_attribute", { table: "e2e_gold.prod.kpi", name: "col1", data_type: "INT" })).isError, false);
  });
  after(async () => { if (S) { await cleanupTree(S.m, S.hubName); await S.stop(); } });

  test("auth: bootstrap or login", async () => {
    const { json } = await req("/auth/bootstrap-needed");
    if (json.needed) assert.equal((await req("/auth/bootstrap", { method: "POST", body: ADMIN })).status, 200);
    else assert.equal((await req("/auth/login", { method: "POST", body: { email: ADMIN.email, password: ADMIN.password } })).status, 200);
    assert.equal((await req("/auth/me")).json.user.email, ADMIN.email);
  });

  test("multi-role accounts: permissions follow the highest role", async () => {
    const mail = `multi-${Date.now()}@example.com`;
    const inv = await req("/admin/invite", { method: "POST", body: { email: mail, roles: ["guest", "pm", "ingestion"] } });
    assert.equal(inv.status, 200);
    assert.deepEqual([...inv.json.roles].sort(), ["guest", "ingestion", "pm"]);
    const token = new URL(inv.json.link).searchParams.get("invite");
    const adminCookie = S.c.cookie; S.c.cookie = "";
    const acc = await req("/auth/accept-invite", { method: "POST", body: { token, name: "Multi Role", password: "multi-pass-123" } });
    assert.equal(acc.status, 200);
    assert.equal(acc.json.user.role, "pm", "effective role is the highest one");
    assert.deepEqual([...acc.json.user.roles].sort(), ["guest", "ingestion", "pm"]);
    const list = await req("/api/marketplace/requests");
    assert.equal(list.json.scope, "all", "workflow role grants the full request list");
    S.c.cookie = adminCookie;
    const users = (await req("/admin/users")).json.users;
    const u = users.find((x) => x.email === mail);
    const patch = await req(`/admin/users/${u.id}`, { method: "PATCH", body: { roles: ["guest", "steward"] } });
    assert.equal(patch.json.user.role, "steward");
    await req(`/admin/users/${u.id}`, { method: "DELETE" });
  });

  test("agent accounts: admin-issued keys authenticate MCP without a session; revoked keys stop working", async () => {
    const mail = `agent-${Date.now()}@example.com`;
    const inv = await req("/admin/invite", { method: "POST", body: { email: mail, roles: ["agent"] } });
    assert.equal(inv.status, 200);
    const token = new URL(inv.json.link).searchParams.get("invite");
    const adminCookie = S.c.cookie; S.c.cookie = "";
    const acc = await req("/auth/accept-invite", { method: "POST", body: { token, name: "Alassio Bot", password: "agent-pass-123" } });
    assert.equal(acc.json.user.role, "agent");
    /* agent self-service key */
    const own = await req("/auth/me/keys", { method: "POST", body: { name: "self" } });
    assert.equal(own.status, 200); assert.ok(own.json.key.startsWith("cxk_"));
    /* agent cannot edit the catalog in the UI path */
    const c = (await req("/api/catalog")).json.catalog; const t = c.tables.find((x) => x.name === "kpi");
    const edit = await req("/api/catalog", { method: "PATCH", body: { baseVersion: 0, changes: [{ entityType: "table", action: "updated", id: t.id, before: t, after: { ...t, description: "x" } }] } });
    assert.equal(edit.status, 403, "agents have no governance rights");
    S.c.cookie = adminCookie;
    const users = (await req("/admin/users")).json.users; const u = users.find((x) => x.email === mail);
    const issued = await req(`/admin/users/${u.id}/keys`, { method: "POST", body: { name: "Claude Desktop" } });
    assert.equal(issued.status, 200);
    const mcpWith = async (key) => (await fetch(S.base + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "update_table", arguments: { table: "e2e_gold.prod.kpi", description: "via agent key" } } }) }));
    assert.equal((await mcpWith(issued.json.key)).status, 200, "agent key authenticates MCP");
    const audit = (await req("/api/audit?limit=3")).json.entries;
    assert.ok(audit.some((e) => e.user?.name === "Alassio Bot"), "audit records the agent's identity");
    assert.equal((await mcpWith("cxk_invalid-key-value-xxxxxxxxxxxx")).status, 401);
    assert.equal((await req(`/admin/keys/${issued.json.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await mcpWith(issued.json.key)).status, 401, "revoked key is rejected");
    const nonAgent = users.find((x) => x.email === ADMIN.email);
    assert.equal((await req(`/admin/users/${nonAgent.id}/keys`, { method: "POST", body: { name: "x" } })).status, 400, "keys only for agents");
    await req(`/admin/users/${u.id}`, { method: "DELETE" });
  });

  test("named agents with scope, lazy catalog, login rate limiting, Entra settings", async () => {
    /* named agent with read scope: browsing works, mutations are refused; write agent may mutate */
    const ag = await req("/admin/agents", { method: "POST", body: { name: "Reader Bot", scope: "read" } });
    assert.equal(ag.status, 200); assert.ok(ag.json.key.startsWith("cxk_")); assert.equal(ag.json.scope, "read");
    const mcp = async (key, name, args) => (await (await fetch(S.base + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result;
    assert.equal((await mcp(ag.json.key, "list_hubs", {})).isError, false, "read scope can browse");
    assert.equal((await mcp(ag.json.key, "update_table", { table: "e2e_gold.prod.kpi", description: "x" })).isError, true, "read scope cannot mutate");
    const wr = await req("/admin/agents", { method: "POST", body: { name: "Writer Bot", scope: "write" } });
    assert.equal((await mcp(wr.json.key, "update_table", { table: "e2e_gold.prod.kpi", description: "via write agent" })).isError, false);
    /* agents cannot sign in with a password */
    const adminCookie = S.c.cookie; S.c.cookie = "";
    const login = await req("/auth/login", { method: "POST", body: { email: ag.json.user.email, password: "anything" } });
    assert.equal(login.status, 401); assert.ok(/MCP key/.test(login.json.error));
    /* login rate limiting: 3 failures then slowdown (measured), lock after 10 */
    const t0 = Date.now();
    for (let i = 0; i < 4; i++) await req("/auth/login", { method: "POST", body: { email: "nobody@example.com", password: "wrong" } });
    assert.ok(Date.now() - t0 >= 1500, "fourth attempt was delayed");
    S.c.cookie = adminCookie;
    /* lazy catalog document on request */
    const lite = await req("/api/catalog?lite=1");
    assert.equal(lite.json.lazy, true); assert.equal(lite.json.catalog.attributes.length, 0); assert.equal(lite.json.attrIndex, undefined); assert.ok(lite.json.stats.attributes >= 1);
    const t = lite.json.catalog.tables.find((x) => x.name === "kpi");
    const attrs = await req(`/api/tables/${t.id}/attributes`);
    assert.ok(attrs.json.attributes.length >= 1, "per-table attributes");
    /* Entra settings: admin-only, validation, public config */
    assert.equal((await req("/admin/sso")).status, 200);
    const bad = await req("/admin/sso", { method: "PUT", body: { enabled: true, tenantId: "", clientId: "" } });
    assert.equal(bad.status, 400);
    const ok = await req("/admin/sso", { method: "PUT", body: { enabled: false, tenantId: "t", clientId: "c", clientSecret: "s", buttonLabel: "Sign in with Microsoft" } });
    assert.equal(ok.status, 200);
    const pub = await fetch(S.base + "/auth/sso/config"); assert.equal((await pub.json()).enabled, false);
    assert.equal((await fetch(S.base + "/auth/sso/login")).status, 404, "disabled SSO does not redirect");
    /* v1.59: SSO enforcement with break-glass accounts, group → role mapping */
    const adminCookie2 = S.c.cookie;
    let enf = await req("/admin/sso", { method: "PUT", body: { enabled: true, tenantId: "t", clientId: "c", clientSecret: "s", enforce: true, breakGlass: ["someone.else@example.com"] } });
    assert.equal(enf.status, 200); assert.equal(enf.json.enforce, true);
    assert.equal((await (await fetch(S.base + "/auth/sso/config")).json()).enforce, true);
    S.c.cookie = "";
    const refused = await req("/auth/login", { method: "POST", body: { email: ADMIN.email, password: ADMIN.password } });
    assert.equal(refused.status, 403); assert.equal(refused.json.code, "sso_enforced");
    S.c.cookie = adminCookie2;
    enf = await req("/admin/sso", { method: "PUT", body: { enabled: true, tenantId: "t", clientId: "c", clientSecret: "s", enforce: true, breakGlass: [] } });
    assert.equal(enf.status, 200);
    assert.deepEqual((await req("/admin/sso")).json.breakGlass, [ADMIN.email], "the saving admin becomes the break-glass account when the list is empty");
    S.c.cookie = "";
    assert.equal((await req("/auth/login", { method: "POST", body: { email: ADMIN.email, password: ADMIN.password } })).status, 200, "break-glass sign-in works");
    assert.equal((await req("/admin/sso", { method: "PUT", body: { enabled: false, tenantId: "t", clientId: "c", clientSecret: "s", enforce: false } })).status, 200);
    const gm = await req("/admin/sso/groups", { method: "PUT", body: { rules: [{ group: "DATA-STEWARDS", roles: ["steward", "pm"] }, { group: "", roles: ["admin"] }, { group: "x", roles: ["agent"] }], syncRoles: true, unmatched: "deny" } });
    assert.equal(gm.status, 200); assert.deepEqual(gm.json.mapping, { rules: [{ group: "DATA-STEWARDS", roles: ["steward", "pm"] }], syncRoles: true, unmatched: "deny" });
    const gget = (await req("/admin/sso/groups")).json; assert.equal(gget.identity.mode, "local"); assert.ok(gget.roles.includes("steward") && !gget.roles.includes("agent"));
    await req("/admin/sso/groups", { method: "PUT", body: { rules: [], syncRoles: false, unmatched: "default" } });
    /* language preference */
    assert.equal((await req("/auth/me/lang", { method: "PATCH", body: { lang: "de" } })).json.lang, "de");
    assert.equal((await req("/auth/me")).json.user.lang, "de");
    for (const u of (await req("/admin/users")).json.users.filter((x) => x.email.endsWith("@agents.local"))) await req(`/admin/users/${u.id}`, { method: "DELETE" });
  });

  test("security: CSRF protection and response headers", async () => {
    const t = (await req("/api/catalog")).json;
    const tab = t.catalog.tables.find((x) => x.name === "kpi");
    const patch = { baseVersion: t.version, changes: [{ entityType: "table", action: "updated", id: tab.id, before: tab, after: { ...tab, description: "csrf" } }] };
    /* a state-changing request with a session cookie but no token is blocked */
    const noTok = await req("/api/catalog", { method: "PATCH", body: patch, csrf: false });
    assert.equal(noTok.status, 403); assert.equal(noTok.json.code, "csrf");
    assert.equal((await req("/api/catalog", { method: "PATCH", body: patch, csrf: false, headers: { "X-CSRF-Token": "wrong" } })).status, 403);
    /* … also when a foreign site posts a form (origin mismatch) or omits the form field */
    assert.equal((await req("/api/catalog", { method: "PATCH", body: patch, headers: { Origin: "https://evil.example" } })).status, 403);
    assert.equal((await req("/api/export/csv", { method: "POST", csrf: false, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "selection=%7B%7D", raw: true })).status, 403);
    /* the same requests pass with the token (header or form field), and with a matching Origin */
    const ok = await req("/api/catalog", { method: "PATCH", body: patch, headers: { Origin: S.base } });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal((await req("/api/export/csv", { method: "POST", csrf: false, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `selection=%7B%7D&_csrf=${S.c.csrf()}`, raw: true })).status, 200);
    /* bearer-authenticated agents (no cookie) are unaffected */
    const saved = S.c.cookie; S.c.cookie = "";
    assert.equal((await mcp("tools/list")).result.tools.length > 0, true);
    /* v1.66.1: batches are capped (MCP_MAX_BATCH=5 in this run) and every message counts against the rate limit */
    const big = await req("/mcp", { method: "POST", headers: { Authorization: `Bearer ${MCP_TOKEN}` }, body: Array.from({ length: 6 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "ping" })) });
    assert.equal(big.status, 400, JSON.stringify(big.json)); assert.match(big.json.error.message, /Batch too large/);
    const okBatch = await req("/mcp", { method: "POST", headers: { Authorization: `Bearer ${MCP_TOKEN}` }, body: Array.from({ length: 5 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "ping" })) });
    assert.equal(okBatch.status, 200); assert.equal(okBatch.json.length, 5);
    S.c.cookie = saved;
    /* the token is bound to the session: logout clears it, login issues a fresh one */
    const before = S.c.csrf(); assert.ok(before);
    assert.equal((await req("/auth/logout", { method: "POST" })).status, 200); assert.equal(S.c.csrf(), "");
    assert.equal((await req("/auth/login", { method: "POST", body: { email: ADMIN.email, password: ADMIN.password } })).status, 200);
    assert.ok(S.c.csrf() && S.c.csrf() !== before);
    /* security headers on every response */
    const r = await req("/auth/me", { raw: true });
    assert.match(r.headers.get("content-security-policy"), /default-src 'self'; script-src 'self';.*frame-ancestors 'none'/);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff"); assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.equal(r.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    assert.equal(r.headers.get("strict-transport-security"), null, "no HSTS on plain http");
    assert.equal((await req("/auth/me", { raw: true, headers: { "X-Forwarded-Proto": "https" } })).headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  });

  test("passwords (v1.67): change with session revocation, admin reset link, forgot without SMTP, hashed invitations", async () => {
    const adminCookie = S.c.cookie;
    const mail = `pw-${Date.now()}@example.com`;
    const inv = await req("/admin/invite", { method: "POST", body: { email: mail, role: "guest" } });
    const token = new URL(inv.json.link).searchParams.get("invite");
    /* the open-invitation list carries no link any more (tokens are stored hashed) — renew and withdraw exist instead */
    const listed = (await req("/admin/users")).json.invites.find((i) => i.email === mail);
    assert.ok(listed && !listed.link && listed.expires > Date.now());
    assert.equal((await req(`/admin/invites/${encodeURIComponent("nobody-" + mail)}`, { method: "DELETE" })).status, 404);
    S.c.cookie = ""; assert.equal((await req("/auth/accept-invite", { method: "POST", body: { token, name: "Pat Password", password: "first-pass-123" } })).status, 200);
    assert.equal((await req("/auth/accept-invite", { method: "POST", body: { token, name: "Again", password: "first-pass-123" } })).status, 400, "an invitation works once");
    const sessionA = S.c.cookie;
    /* second session of the same account */
    assert.equal((await signIn(S.c, mail, "first-pass-123")).status, 200);
    const sessionB = S.c.cookie;
    assert.equal((await req("/auth/me")).json.user.passwordAuth, true);
    /* change the password from session B: wrong current → 400, new one works, session A is gone, B stays */
    assert.equal((await req("/auth/password", { method: "POST", body: { current: "nope", password: "second-pass-123" } })).status, 400);
    assert.equal((await req("/auth/password", { method: "POST", body: { current: "first-pass-123", password: "short" } })).status, 400);
    assert.equal((await req("/auth/password", { method: "POST", body: { current: "first-pass-123", password: "second-pass-123" } })).status, 200);
    assert.equal((await req("/auth/me")).status, 200, "the changing session stays signed in");
    S.c.cookie = sessionA; assert.equal((await req("/auth/me")).status, 401, "the other session was revoked");
    assert.equal((await signIn(S.c, mail, "first-pass-123")).status, 401);
    assert.equal((await req("/auth/login", { method: "POST", body: { email: mail, password: "second-pass-123" } })).status, 200);
    const sessionC = S.c.cookie;
    /* "forgot password" without SMTP tells the user to ask an admin; the admin issues a link */
    S.c.cookie = ""; const fg = await req("/auth/forgot", { method: "POST", body: { email: mail } }); assert.equal(fg.status, 400); assert.equal(fg.json.code, "no_mail");
    S.c.cookie = adminCookie;
    const users = (await req("/admin/users")).json.users; const u = users.find((x) => x.email === mail);
    const rs = await req(`/admin/users/${u.id}/reset-password`, { method: "POST", body: {} });
    assert.equal(rs.status, 200, JSON.stringify(rs.json)); assert.equal(rs.json.mailed, false); assert.equal(rs.json.hours, 24);
    const rt = new URL(rs.json.link).searchParams.get("reset"); assert.ok(rt && rt.length >= 32);
    S.c.cookie = "";
    assert.equal((await req(`/auth/reset-info?token=${rt}`)).json.email, mail);
    assert.equal((await req("/auth/reset-info?token=wrong")).status, 400);
    assert.equal((await req("/auth/reset-password", { method: "POST", body: { token: "wrong", password: "third-pass-123" } })).status, 400);
    assert.equal((await req("/auth/reset-password", { method: "POST", body: { token: rt, password: "tiny" } })).status, 400);
    const done = await req("/auth/reset-password", { method: "POST", body: { token: rt, password: "third-pass-123" } });
    assert.equal(done.status, 200); assert.equal(done.json.email, mail); assert.equal(S.c.jar().dhc_session, undefined, "a reset does not sign in by itself");
    assert.equal((await req("/auth/reset-password", { method: "POST", body: { token: rt, password: "fourth-pass-123" } })).status, 400, "a reset link works once");
    S.c.cookie = sessionC; assert.equal((await req("/auth/me")).status, 401, "every session ends with the reset");
    S.c.cookie = sessionB; assert.equal((await req("/auth/me")).status, 401);
    assert.equal((await signIn(S.c, mail, "third-pass-123")).status, 200);
    /* agent accounts and the admin's own invitation withdrawal */
    S.c.cookie = adminCookie;
    const inv2 = await req("/admin/invite", { method: "POST", body: { email: `wd-${mail}`, role: "guest" } }); assert.equal(inv2.status, 200);
    assert.equal((await req(`/admin/invites/${encodeURIComponent("wd-" + mail)}`, { method: "DELETE" })).status, 200);
    assert.ok(!(await req("/admin/users")).json.invites.some((i) => i.email === `wd-${mail}`));
    assert.equal((await req("/auth/accept-invite", { method: "POST", body: { token: new URL(inv2.json.link).searchParams.get("invite"), name: "X", password: "wf-pass-123" } })).status, 400, "withdrawn invitation is dead");
    await req(`/admin/users/${u.id}`, { method: "DELETE" });
  });
});
