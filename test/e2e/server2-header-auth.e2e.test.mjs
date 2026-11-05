/* E2E: AUTH_MODE=header — identity from a trusted proxy (Databricks Apps, oauth2-proxy). Runs its own server on a
   separate port (3988 = E2E_PORT_BASE + 8) against a freshly reset test database; the bootstrap admin is the proxy
   identity boss@proxy.example, so no local admin is needed. v1.73 (F-T6): boot, reset and skipping via helpers.mjs. */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { requireDb, resetDb, bootServer, portOf } from "./helpers.mjs";

const SECRET = "proxy-shared-secret";
let srv, BASE;
const hdr = (email, extra = {}) => ({ "x-forwarded-email": email, "x-forwarded-preferred-username": email.split("@")[0], "x-auth-proxy-secret": SECRET, ...extra });
/* raw fetch on purpose: this suite checks exactly which headers and cookies the proxy flow needs, so it sets them by hand */
const cookiesOf = (r) => r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

describe("E2E header auth", { skip: requireDb() }, () => {
  before(async () => {
    await resetDb();
    srv = await bootServer({ AUTH_MODE: "header", AUTH_HEADER_SECRET: SECRET, AUTH_BOOTSTRAP_ADMINS: "boss@proxy.example", AUTH_HEADER_DEFAULT_ROLES: "guest", DATA_DIR: "/tmp/e2e-nodata-header", MCP_TOKEN: "hdr-token" }, { port: portOf("header"), label: "header-auth server" });
    BASE = srv.base;
  });
  after(() => srv?.stop());

  test("header mode: no bootstrap screen, no identity → 401, wrong secret → 401", async () => {
    const b = await (await fetch(BASE + "/auth/bootstrap-needed")).json();
    assert.equal(b.mode, "header"); assert.equal(b.needed, false);
    assert.equal((await fetch(BASE + "/auth/me")).status, 401);
    assert.equal((await fetch(BASE + "/auth/me", { headers: { "x-forwarded-email": "boss@proxy.example" } })).status, 401, "identity headers without the shared secret are ignored");
    const id = await (await fetch(BASE + "/auth/identity")).json();
    assert.equal(id.mode, "header"); assert.equal(id.headers.secretRequired, true); assert.equal(id.headers.email, "x-forwarded-email");
    const login = await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "boss@proxy.example", password: "x" }) });
    assert.equal(login.status, 403); assert.equal((await login.json()).code, "sso_enforced");
  });

  test("header mode: bootstrap admin, auto-provisioned guest, session cookie, group → role mapping with role sync", async () => {
    /* the configured bootstrap admin is provisioned as admin on first sight and receives a session cookie */
    let r = await fetch(BASE + "/auth/me", { headers: hdr("boss@proxy.example") });
    assert.equal(r.status, 200);
    const boss = (await r.json()).user; assert.deepEqual(boss.roles, ["admin"]); assert.equal(boss.email, "boss@proxy.example");
    const bossCookie = cookiesOf(r); assert.match(bossCookie, /dhc_session=/); assert.match(bossCookie, /dhc_csrf=/);
    /* the cookie alone keeps the session (no headers needed on later requests) */
    r = await fetch(BASE + "/auth/me", { headers: { Cookie: bossCookie } }); assert.equal(r.status, 200);
    /* a mutating request on the very first header-authenticated call passes without a CSRF token (same-origin), later ones need it */
    const csrf = bossCookie.match(/dhc_csrf=([^;]+)/)[1];
    r = await fetch(BASE + "/admin/sso/groups", { method: "PUT", headers: { ...hdr("boss@proxy.example"), "Content-Type": "application/json" }, body: JSON.stringify({ rules: [{ group: "DATA-STEWARDS", roles: ["steward"] }, { group: "PMO", roles: ["pm"] }], syncRoles: true, unmatched: "default" }) });
    assert.equal(r.status, 200, await r.text());
    r = await fetch(BASE + "/admin/sso/groups", { method: "PUT", headers: { Cookie: bossCookie, "Content-Type": "application/json" }, body: JSON.stringify({ rules: [{ group: "DATA-STEWARDS", roles: ["steward"] }, { group: "PMO", roles: ["pm"] }], syncRoles: true, unmatched: "default" }) });
    assert.equal(r.status, 403, "cookie session without X-CSRF-Token is blocked");
    r = await fetch(BASE + "/admin/sso/groups", { method: "PUT", headers: { Cookie: bossCookie, "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ rules: [{ group: "DATA-STEWARDS", roles: ["steward"] }, { group: "PMO", roles: ["pm"] }], syncRoles: true, unmatched: "default" }) });
    assert.equal(r.status, 200);
    /* an unknown user with no groups becomes a guest; with groups the mapping decides, and roles follow group changes */
    r = await fetch(BASE + "/auth/me", { headers: hdr("gina@proxy.example") });
    assert.equal(r.status, 200); assert.deepEqual((await r.json()).user.roles, ["guest"]);
    r = await fetch(BASE + "/auth/me", { headers: hdr("sam@proxy.example", { "x-forwarded-groups": "Everyone, DATA-STEWARDS" }) });
    assert.equal(r.status, 200); const sam = (await r.json()).user; assert.deepEqual(sam.roles, ["steward"]); assert.equal(sam.role, "steward");
    r = await fetch(BASE + "/auth/me", { headers: hdr("sam@proxy.example", { "x-forwarded-groups": "PMO, DATA-STEWARDS" }) });
    assert.deepEqual((await r.json()).user.roles.sort(), ["pm", "steward"], "roles follow the groups on the next sign-in");
    r = await fetch(BASE + "/auth/me", { headers: hdr("sam@proxy.example", { "x-forwarded-groups": "Everyone" }) });
    assert.deepEqual((await r.json()).user.roles, ["guest"], "no matching group → default roles");
    /* access denied for unmatched users when configured so */
    r = await fetch(BASE + "/admin/sso/groups", { method: "PUT", headers: { Cookie: bossCookie, "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ rules: [{ group: "DATA-STEWARDS", roles: ["steward"] }], syncRoles: true, unmatched: "deny" }) });
    assert.equal(r.status, 200);
    r = await fetch(BASE + "/auth/me", { headers: hdr("nobody@proxy.example", { "x-forwarded-groups": "Everyone" }) });
    assert.equal(r.status, 401);
    assert.match((await (await fetch(BASE + "/auth/identity", { headers: hdr("nobody@proxy.example", { "x-forwarded-groups": "Everyone" }) })).json()).error || "", /no group that grants access/);
    /* the admin is never demoted below the last admin by a mapping */
    r = await fetch(BASE + "/auth/me", { headers: hdr("boss@proxy.example", { "x-forwarded-groups": "Everyone" }) });
    assert.equal(r.status, 200); assert.ok((await r.json()).user.roles.includes("admin"));
    /* audit shows the provisioning under the identity proxy actor */
    r = await fetch(BASE + "/api/audit?type=user&limit=20", { headers: { Cookie: bossCookie } });
    const entries = (await r.json()).entries;
    assert.ok(entries.some((e) => e.name === "sam@proxy.example" && e.action === "created" && e.user?.name === "Identity proxy"), JSON.stringify(entries.slice(0, 3)));
    /* MCP: bearer tokens still rule … */
    r = await fetch(BASE + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer hdr-token", ...hdr("boss@proxy.example") }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
    assert.equal(r.status, 200);
    /* … and (v1.61) a request the platform already authenticated acts as the forwarded identity: admins write, guests read */
    const mcp = (email, groups, name, args = {}) => fetch(BASE + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", ...(email ? hdr(email, groups ? { "x-forwarded-groups": groups } : {}) : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    r = await mcp(null, null, "list_hubs"); assert.equal(r.status, 401, "no bearer, no identity → 401");
    r = await mcp("boss@proxy.example", null, "list_hubs"); assert.equal(r.status, 200, await r.clone().text());
    const hubs = JSON.parse((await r.json()).result.content[0].text); assert.ok(Array.isArray(hubs));
    r = await mcp("boss@proxy.example", null, "create_hub", { name: "Header MCP Hub", description: "via forwarded identity" });
    assert.equal(r.status, 200); const created = await r.json(); assert.equal(created.result.isError, false, JSON.stringify(created));
    r = await mcp("gina@proxy.example", null, "create_hub", { name: "Nope", description: "" });   /* no groups header → mapping not applied, gina stays guest */
    assert.equal(r.status, 200); const denied = await r.json(); assert.equal(denied.result.isError, true); assert.match(denied.result.content[0].text, /gina@proxy.example has no editing role/);
    r = await mcp("nobody@proxy.example", "Everyone", "list_hubs"); assert.equal(r.status, 401, "denied by the group mapping → 401");
    r = await fetch(BASE + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer platform-token", ...hdr("boss@proxy.example") }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "delete_hub", arguments: { hub: "Header MCP Hub" } } }) });
    assert.equal(r.status, 200, "an unknown bearer (the platform's own token) falls through to the forwarded identity"); assert.equal((await r.json()).result.isError, false);
    /* audit entry under the human's name */
    r = await fetch(BASE + "/api/audit?type=hub&limit=10", { headers: { Cookie: bossCookie } });
    assert.ok((await r.json()).entries.some((e) => e.name === "Header MCP Hub" && e.user?.email === "boss@proxy.example"));
    /* cleanup: delete the proxy users (boss last) */
    const users = (await (await fetch(BASE + "/admin/users", { headers: { Cookie: bossCookie } })).json()).users.filter((u) => u.email.endsWith("@proxy.example") && u.email !== "boss@proxy.example");
    for (const u of users) assert.equal((await fetch(`${BASE}/admin/users/${u.id}`, { method: "DELETE", headers: { Cookie: bossCookie, "X-CSRF-Token": csrf } })).status, 200);
    await fetch(BASE + "/admin/sso/groups", { method: "PUT", headers: { Cookie: bossCookie, "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ rules: [], syncRoles: false, unmatched: "default" }) });
  });
});
