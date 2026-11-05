/**
 * E2E — MCP: protocol basics and argument validation, tools on the lazy document, OAuth 2.1, per-credential rate limiting.
 * v1.73 (F-T6): split out of the former server.e2e.test.mjs. This file resets the test database, boots its own server
 * on port 3984 (E2E_PORT_BASE + 4), bootstraps the admin, seeds hub → e2e_gold → prod → kpi and removes it again.
 * Run alone: DB_USER=… DB_PASSWORD=… DB_NAME=datahub_catalog_test node --test test/e2e/mcp.e2e.test.mjs
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { ADMIN, requireDb, startSuite, cleanupTree } from "./helpers.mjs";

let S;   /* the running suite: { base, c (cookie client), m (MCP client), hubName, seeded, stop } */
const req = (...a) => S.c.req(...a);
const mcp = (...a) => S.m.call(...a);
const tool = (...a) => S.m.tool(...a);

describe("E2E mcp", { skip: requireDb() }, () => {
  before(async () => {
    S = await startSuite({ name: "mcp" });
  });
  after(async () => { if (S) { await cleanupTree(S.m, S.hubName); await S.stop(); } });

  test("MCP: protocol basics and no user-management tools", async () => {
    const init = await mcp("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
    assert.ok(init.result.capabilities.resources);
    const list = await mcp("tools/list");
    assert.ok(list.result.tools.length >= 35);
    assert.ok(!list.result.tools.some((t) => /user|invite|role/.test(t.name)));
    const res = await mcp("resources/read", { uri: "okf://index.md" });
    assert.ok(res.result.contents[0].text.startsWith("---"));
    const unauth = await fetch(S.base + "/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(unauth.status, 401);
    /* v1.67: arguments are validated against the tool schema before the tool runs */
    const bad = await mcp("tools/call", { name: "get_table", arguments: { table: 42 } });
    assert.equal(bad.error?.code, -32602); assert.match(bad.error.message, /arguments\.table must be a string/);
    const unknown = await mcp("tools/call", { name: "list_hubs", arguments: { verbose: true } });
    assert.equal(unknown.error?.code, -32602); assert.match(unknown.error.message, /verbose is not a known parameter/);
    const missing = await mcp("tools/call", { name: "get_table", arguments: {} });
    assert.equal(missing.error?.code, -32602); assert.match(missing.error.message, /table is required/);
  });

  test("MCP on the lazy document: attribute CRUD, counts from stats, cascade delete, glossary attribute refs", async () => {
    const tbl = `e2e_gold.prod.lazy_${Date.now()}`;
    assert.equal((await tool("create_table", { schema: "e2e_gold.prod", name: tbl.split(".")[2], description: "lazy test" })).isError, false);
    assert.equal((await tool("create_attribute", { table: tbl, name: "id", data_type: "BIGINT", is_pk: true })).isError, false);
    assert.equal((await tool("create_attribute", { table: tbl, name: "amount", data_type: "DECIMAL(12,2)", sensitivity: "Confidential" })).isError, false);
    const dup = await tool("create_attribute", { table: tbl, name: "ID" });
    assert.equal(dup.isError, true); assert.match(dup.data, /already exists/);
    const det = (await tool("get_table", { table: tbl })).data;
    assert.deepEqual(det.attributes.map((a) => a.name), ["id", "amount"]); assert.equal(det.attributes[0].is_pk, true);
    assert.equal((await tool("update_attribute", { attribute: `${tbl}.amount`, new_name: "paid_amount", description: "paid" })).isError, false);
    const listed = (await tool("list_tables", { schema: "e2e_gold.prod" })).data.find((t) => t.path === tbl);
    assert.equal(listed.attributes, 2, "attribute count comes from the per-table stats");
    const ov = (await tool("get_overview")).data; assert.ok(ov.attributes >= 2);
    /* glossary term referencing the attribute: the path is resolved by loading just that attribute */
    assert.equal((await tool("create_glossary_term", { name: `Paid amount ${Date.now()}`, definition: "x", references: [{ type: "attribute", path: `${tbl}.paid_amount` }] })).isError, false);
    const terms = (await tool("list_glossary_terms", { query: "Paid amount" })).data;
    const term = (await tool("get_glossary_term", { term: terms[0].name })).data;
    assert.deepEqual(term.linked_entities, [{ type: "attribute", path: `${tbl}.paid_amount` }]);
    assert.equal((await tool("delete_glossary_term", { term: terms[0].name })).isError, false);
    /* the UI endpoint sees the same rows; deleting the table cascades to attributes the tool never loaded */
    const t = (await req("/api/catalog")).json.catalog.tables.find((x) => x.name === tbl.split(".")[2]);
    assert.equal((await req(`/api/tables/${t.id}/attributes`)).json.attributes.length, 2);
    assert.equal((await tool("delete_attribute", { attribute: `${tbl}.id` })).isError, false);
    assert.equal((await req(`/api/tables/${t.id}/attributes`)).json.attributes.map((a) => a.name).join(), "paid_amount");
    assert.equal((await tool("delete_table", { table: tbl })).isError, false);
    assert.equal((await req(`/api/tables/${t.id}/attributes`)).json.attributes.length, 0, "cascade removed the remaining attribute");
    const audit = await req("/api/audit?q=paid_amount&limit=10");
    assert.ok(audit.json.entries.some((e) => e.entityType === "attribute" && e.action === "deleted"), "cascade deletes are audited");
  });

  test("OAuth 2.1 for MCP: discovery, dynamic registration, consent, PKCE, refresh rotation, revocation, role-bound scope", async () => {
    const adminCookie = S.c.cookie;
    const meta = (await req("/.well-known/oauth-authorization-server")).json;
    assert.equal(meta.issuer, S.base); assert.equal(meta.token_endpoint, `${S.base}/oauth/token`); assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
    const prm = (await req("/.well-known/oauth-protected-resource")).json;
    assert.equal(prm.resource, `${S.base}/mcp`); assert.deepEqual(prm.authorization_servers, [S.base]);
    /* 401 without a token advertises the resource metadata (MCP clients start discovery from it) */
    const anon = await fetch(S.base + "/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    assert.equal(anon.status, 401); assert.match(anon.headers.get("www-authenticate") || "", /resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource"/);
    /* registration */
    const bad = await req("/oauth/register", { method: "POST", body: { client_name: "Bad", redirect_uris: ["http://evil.example/cb"] }, csrf: false });
    assert.equal(bad.status, 400); assert.equal(bad.json.error, "invalid_redirect_uri");
    const reg = await req("/oauth/register", { method: "POST", body: { client_name: "E2E MCP Client", redirect_uris: ["http://localhost:9/cb"], client_uri: "https://client.example" }, csrf: false });
    assert.equal(reg.status, 201, JSON.stringify(reg.json)); assert.match(reg.json.client_id, /^cxc_/); assert.equal(reg.json.client_secret, undefined);
    const clientId = reg.json.client_id;
    const { createHash, randomBytes } = await import("node:crypto");
    const verifier = randomBytes(32).toString("base64url"), challenge = createHash("sha256").update(verifier).digest("base64url");
    const authUrl = `/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent("http://localhost:9/cb")}&scope=${encodeURIComponent("catalog:read catalog:write")}&state=xyz&code_challenge=${challenge}&code_challenge_method=S256`;
    /* no session → bounce through the SPA login with next= */
    const noSess = await fetch(S.base + authUrl, { redirect: "manual" });
    assert.equal(noSess.status, 302); assert.match(noSess.headers.get("location"), /^\/\?next=%2Foauth%2Fauthorize/);
    /* consent page for the signed-in admin */
    const page = await fetch(S.base + authUrl, { headers: { Cookie: S.c.cookie }, redirect: "manual" });
    assert.equal(page.status, 200); const html = await page.text();
    assert.match(html, /E2E MCP Client/); assert.match(html, /name="_csrf" value="[^"]+"/); assert.match(html, /catalog:write/);
    assert.doesNotMatch(page.headers.get("content-security-policy") || "", /form-action/, "consent responses drop form-action (the redirect after the form post)");
    const csrf = html.match(/name="_csrf" value="([^"]+)"/)[1];
    const form = (o) => new URLSearchParams(o).toString();
    const consent = (decision, c = S.c.cookie) => fetch(S.base + "/oauth/authorize", { method: "POST", redirect: "manual", headers: { Cookie: c, "Content-Type": "application/x-www-form-urlencoded", Origin: S.base },
      body: form({ client_id: clientId, redirect_uri: "http://localhost:9/cb", scope: "catalog:read catalog:write", state: "xyz", code_challenge: challenge, _csrf: csrf, decision }) });
    const denied = await consent("deny"); assert.equal(denied.status, 302); assert.match(denied.headers.get("location"), /error=access_denied.*state=xyz|state=xyz.*error=access_denied/);
    const noCsrf = await fetch(S.base + "/oauth/authorize", { method: "POST", redirect: "manual", headers: { Cookie: S.c.cookie, "Content-Type": "application/x-www-form-urlencoded", Origin: S.base }, body: form({ client_id: clientId, decision: "allow", code_challenge: challenge }) });
    assert.equal(noCsrf.status, 403, "form token required");
    const allowed = await consent("allow"); assert.equal(allowed.status, 302);
    const loc = new URL(allowed.headers.get("location")); assert.equal(loc.origin + loc.pathname, "http://localhost:9/cb"); assert.equal(loc.searchParams.get("state"), "xyz");
    const code = loc.searchParams.get("code"); assert.match(code, /^cxa_/);
    /* token: wrong verifier fails and burns the code? no — a failed PKCE check is a real failure, the code is single use either way */
    const tok = (body) => fetch(S.base + "/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form(body) }).then(async (r) => ({ status: r.status, json: await r.json(), cache: r.headers.get("cache-control") }));
    const t1 = await tok({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: "http://localhost:9/cb" });
    assert.equal(t1.status, 200, JSON.stringify(t1.json)); assert.match(t1.json.access_token, /^cxo_/); assert.match(t1.json.refresh_token, /^cxr_/); assert.equal(t1.json.scope, "catalog:read catalog:write"); assert.equal(t1.cache, "no-store");
    const again = await tok({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier }); assert.equal(again.status, 400); assert.equal(again.json.error, "invalid_grant");
    /* the token drives /mcp as the admin: reads and writes work, audit carries the human's name */
    const asTok = async (token, method, params = {}) => { const r = await fetch(S.base + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); return { status: r.status, headers: r.headers, json: await r.json().catch(() => ({})) }; };
    let r = await asTok(t1.json.access_token, "tools/list"); assert.equal(r.status, 200); assert.ok(r.json.result.tools.length > 20); assert.ok(Number(r.headers.get("x-ratelimit-remaining")) > 0);
    r = await asTok(t1.json.access_token, "tools/call", { name: "create_table", arguments: { schema: "e2e_gold.prod", name: "oauth_tbl" } }); assert.equal(r.json.result.isError, false, r.json.result?.content?.[0]?.text);
    const audit = (await req("/api/audit?type=table&q=oauth_tbl")).json.entries;
    assert.ok(audit.some((e) => e.name === "oauth_tbl" && e.user?.email === ADMIN.email), JSON.stringify(audit.slice(0, 3)));
    /* refresh rotation: new pair, the old refresh token and old access token die */
    const t2 = await tok({ grant_type: "refresh_token", client_id: clientId, refresh_token: t1.json.refresh_token });
    assert.equal(t2.status, 200, JSON.stringify(t2.json)); assert.notEqual(t2.json.access_token, t1.json.access_token);
    assert.equal((await tok({ grant_type: "refresh_token", client_id: clientId, refresh_token: t1.json.refresh_token })).json.error, "invalid_grant", "rotated refresh token rejected");
    r = await asTok(t1.json.access_token, "tools/list"); assert.equal(r.status, 401); assert.match(r.headers.get("www-authenticate"), /resource_metadata/);
    r = await asTok(t2.json.access_token, "tools/list"); assert.equal(r.status, 200);
    /* connected apps + revoke */
    const apps = (await req("/oauth/apps")).json.apps; assert.ok(apps.some((a) => a.clientId === clientId && a.active > 0 && a.scope.includes("catalog:write")), JSON.stringify(apps));
    assert.ok((await req("/oauth/apps?all=1")).json.limits.perMinute >= 1);
    assert.equal((await req(`/oauth/apps/${clientId}`, { method: "DELETE" })).json.revoked, 1);
    r = await asTok(t2.json.access_token, "tools/list"); assert.equal(r.status, 401, "revoked app token stops working");
    /* a guest never gets catalog:write, whatever the client asks for */
    const gm = `guest-oauth-${Date.now()}@example.com`;
    const inv = await req("/admin/invite", { method: "POST", body: { email: gm, role: "guest" } }); const token = new URL(inv.json.link).searchParams.get("invite");
    S.c.cookie = ""; assert.equal((await req("/auth/accept-invite", { method: "POST", body: { token, name: "Gus Guest", password: "wf-pass-123" } })).status, 200);
    const gpage = await (await fetch(S.base + authUrl, { headers: { Cookie: S.c.cookie } })).text(); const gcsrf = gpage.match(/name="_csrf" value="([^"]+)"/)[1];
    const gal = await fetch(S.base + "/oauth/authorize", { method: "POST", redirect: "manual", headers: { Cookie: S.c.cookie, "Content-Type": "application/x-www-form-urlencoded", Origin: S.base },
      body: form({ client_id: clientId, redirect_uri: "http://localhost:9/cb", scope: "catalog:read catalog:write", code_challenge: challenge, _csrf: gcsrf, decision: "allow" }) });
    const gcode = new URL(gal.headers.get("location")).searchParams.get("code");
    const gt = await tok({ grant_type: "authorization_code", client_id: clientId, code: gcode, code_verifier: verifier });
    assert.equal(gt.json.scope, "catalog:read");
    r = await asTok(gt.json.access_token, "tools/call", { name: "delete_table", arguments: { table: "e2e_gold.prod.oauth_tbl" } }); assert.equal(r.json.result.isError, true); assert.match(r.json.result.content[0].text, /read scope/);
    r = await asTok(gt.json.access_token, "tools/call", { name: "get_table", arguments: { table: "e2e_gold.prod.oauth_tbl" } }); assert.equal(r.json.result.isError, false);
    /* revocation endpoint (RFC 7009) */
    const rv = await fetch(S.base + "/oauth/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ token: gt.json.access_token, client_id: clientId }) }); assert.equal(rv.status, 200);
    r = await asTok(gt.json.access_token, "tools/list"); assert.equal(r.status, 401);
    S.c.cookie = adminCookie;
    assert.equal((await tool("delete_table", { table: "e2e_gold.prod.oauth_tbl" })).isError, false);
  });

  test("MCP rate limiting: per-credential sliding window returns 429 with Retry-After", async () => {
    const ag = await req("/admin/agents", { method: "POST", body: { name: "Burst Agent", scope: "read" } }); assert.equal(ag.status, 200);
    const call = () => fetch(S.base + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ag.json.key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping" }) });
    let first = await call(); assert.equal(first.status, 200); assert.equal(first.headers.get("x-ratelimit-limit"), "600");
    const statuses = [];
    for (let b = 0; b < 7; b++) statuses.push(...(await Promise.all(Array.from({ length: 100 }, call))).map((r) => r.status));   /* 701 calls against a limit of 600 */
    assert.equal(statuses.filter((s) => s === 200).length, 599); assert.equal(statuses.filter((s) => s === 429).length, 101);
    const limited = await call(); assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) >= 1 && Number(limited.headers.get("retry-after")) <= 60); assert.equal(limited.headers.get("x-ratelimit-remaining"), "0");
    const j = await limited.json(); assert.equal(j.error.code, -32000); assert.match(j.error.message, /600 requests per minute/); assert.equal(j.id, 7);
    /* other credentials are unaffected */
    assert.equal((await mcp("ping")).result !== undefined, true);
  });
});
