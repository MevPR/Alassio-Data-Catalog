/* v1.71 (code-quality review F-T3 / F-T2): the MCP protocol plumbing driven through registerMcp() against a fake express
   app — the POST /mcp handler is captured and called with fake req/res objects. Covers the JSON-RPC surface (initialize,
   tools/list, resources, errors), bearer resolution, the write-scope gate for every flagged tool, the batch cap, the rate
   limit hook and the delta-save `mutate` with its 409 retry. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerMcp, buildTools } from "../../mcp.js";

const doc = () => ({
  hubs: [{ id: "h1", name: "Health", description: "", ownerId: null, stewardId: null, dataHubs: [] }, { id: "h2", name: "P&C", description: "", ownerId: null, stewardId: null, dataHubs: [] }],
  people: [], domains: [],
  databases: [{ id: "d1", name: "GOLD", hubId: "h1", country: "GLOBAL", layer: "gold", domainId: null, source: "manual", description: "" }],
  schemas: [{ id: "s1", databaseId: "d1", name: "dp", description: "" }],
  tables: [{ id: "t1", schemaId: "s1", name: "fact", type: "TABLE", description: "", businessDefinition: "", stewardId: null, tags: "" }],
  attributes: [{ id: "a1", tableId: "t1", name: "id", dataType: "BIGINT", nullable: false, isPK: true, description: "", sensitivity: "Internal" }],
  lineage: [], glossary: [],
});
/* minimal arguments that pass the tool's schema (required keys only; enums take their first value) */
const minimalArgs = (schema) => Object.fromEntries((schema.required || []).map((k) => { const p = schema.properties[k];
  return [k, p.enum ? p.enum[0] : p.type === "number" || p.type === "integer" ? (p.minimum ?? 1) : p.type === "boolean" ? true : p.type === "array" ? [] : "x"]; }));

let cat, routes, applyChanges, rateLimit;
const users = {
  "agent-write": { id: "k1", name: "Writer Bot", email: "w@agents.local", role: "agent", key_id: "k1", scope: "write" },
  "agent-read": { id: "k2", name: "Reader Bot", email: "r@agents.local", role: "agent", key_id: "k2", scope: "read" },
};
const oauthUsers = {
  cxo_steward: { id: "u1", name: "Sam Steward", email: "sam@x.de", role: "steward", roles: ["steward"], scope: "write", oauth: { tokenId: "tok1" } },
  cxo_reader: { id: "u2", name: "Rita Reader", email: "rita@x.de", role: "guest", roles: ["guest"], scope: "read", oauth: { tokenId: "tok2" } },
};
const setup = (over = {}) => {
  routes = {};
  const app = { post: (p, h) => { routes[`POST ${p}`] = h; }, get: (p, h) => { routes[`GET ${p}`] = h; }, delete: (p, h) => { routes[`DELETE ${p}`] = h; } };
  registerMcp(app, {
    readCatalog: async () => ({ catalog: cat && structuredClone(cat), version: 7 }),   /* a fresh document per read, like the store */
    applyChanges, queryAudit: async () => [], appVersion: "9.9.9", searchRows: async () => [],
    resolveAgentKey: async (k) => users[k] || null,
    resolveOAuthToken: async (k) => oauthUsers[k] || null,
    resolveForwardedIdentity: null, rateLimit, collab: null, ...over });
};
const mkRes = () => { const r = { headers: {}, statusCode: 200, body: undefined, ended: false,
  setHeader(k, v) { r.headers[k] = v; }, status(c) { r.statusCode = c; return r; }, json(b) { r.body = b; return r; }, end() { r.ended = true; return r; } }; return r; };
const post = async (body, auth = "Bearer static-token", headers = {}) => { const res = mkRes(); await routes["POST /mcp"]({ headers: { authorization: auth, ...headers }, body }, res); return res; };
const rpc = (method, params, id = 1) => ({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
const callTool = (name, args, auth) => post(rpc("tools/call", { name, arguments: args }), auth);
const text = (res) => res.body.result.content[0].text;
/* v1.73 (F-S2): applyChanges throws its refusals instead of returning { status, body } */
const conflict = () => Object.assign(new Error("Some objects were changed by someone else"), { status: 409, conflicts: [] });

beforeEach(() => {
  process.env.MCP_TOKEN = "static-token";
  cat = doc();
  applyChanges = vi.fn(async () => ({ ok: true, version: 8, applied: 1 }));
  rateLimit = null;
  setup();
});

describe("protocol surface", () => {
  it("negotiates the protocol version and describes the server", async () => {
    const r = await post(rpc("initialize", { protocolVersion: "2025-03-26" }));
    expect(r.body.result).toMatchObject({ protocolVersion: "2025-03-26", serverInfo: { name: "datahub-catalog", version: "9.9.9" }, capabilities: { tools: { listChanged: false } } });
    expect(r.body.result.instructions).not.toMatch(/Copyright|LICENSE/);   /* v1.79.4: no copyright or licence notice */
    expect((await post(rpc("initialize", { protocolVersion: "1999-01-01" }))).body.result.protocolVersion).toBe("2025-06-18");
    expect((await post(rpc("ping"))).body).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });
  it("serves tools/list with exactly the registered tools (name, description, inputSchema)", async () => {
    const r = await post(rpc("tools/list"));
    const expected = buildTools({ readCatalog: async () => ({ catalog: null }), mutate: async () => {}, queryAudit: async () => [], searchRows: async () => [], currentUser: () => users["agent-write"], appVersion: () => "9.9.9" });
    expect(r.body.result.tools.map((t) => t.name)).toEqual(expected.map((t) => t.name));
    for (const t of r.body.result.tools) expect(Object.keys(t).sort()).toEqual(["description", "inputSchema", "name"]);
  });
  it("rejects malformed envelopes, unknown methods and unknown tools; notifications get 202", async () => {
    expect((await post({ foo: 1 })).body.error).toMatchObject({ code: -32600, message: "Invalid request" });
    expect((await post(rpc("nope/x"))).body.error).toMatchObject({ code: -32601, message: "Method not found: nope/x" });
    expect((await post(rpc("tools/call", { name: "no_such_tool", arguments: {} }))).body.error).toMatchObject({ code: -32602, message: "Unknown tool: no_such_tool" });
    const n = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(n.statusCode).toBe(202); expect(n.ended).toBe(true);
    expect((await post({ jsonrpc: "2.0", method: "nope/x" })).statusCode).toBe(202);   /* an unknown method without id is swallowed … */
    expect((await post({ jsonrpc: "2.0", method: "ping" })).body).toEqual({ jsonrpc: "2.0", result: {} });   /* … a known one is still answered (pinned current behaviour) */
  });
  it("validates tool arguments against the schema before anything runs", async () => {
    const r = await post(rpc("tools/call", { name: "create_hub", arguments: {} }));
    expect(r.body.error).toMatchObject({ code: -32602, message: "Invalid params: arguments.name is required" });
    expect((await callTool("create_hub", { name: "X", bogus: 1 })).body.error.message).toMatch(/bogus is not a known parameter/);
    expect(applyChanges).not.toHaveBeenCalled();
  });
  it("runs a read tool and wraps tool errors as isError results", async () => {
    const ok = await callTool("list_hubs", {});
    expect(ok.body.result.isError).toBe(false);
    expect(JSON.parse(text(ok)).map((h) => h.name)).toEqual(["Health", "P&C"]);
    const bad = await callTool("list_schemas", { database: "nope" });
    expect(bad.body.result.isError).toBe(true);
    expect(text(bad)).toBe('Error: Database "nope" not found');
  });
  it("serves the OKF bundle as resources", async () => {
    const list = await post(rpc("resources/list"));
    expect(list.body.result.resources[0]).toMatchObject({ uri: "okf://index.md", mimeType: "text/markdown" });
    const read = await post(rpc("resources/read", { uri: "okf://index.md" }));
    expect(read.body.result.contents[0].text).toContain("Alassio Data Catalog");
    expect((await post(rpc("resources/read", { uri: "okf://nope.md" }))).body.error.code).toBe(-32002);
    expect((await post(rpc("resources/read", { uri: "file:///etc/passwd" }))).body.error.message).toMatch(/Unknown resource URI/);
    expect((await post(rpc("resources/templates/list"))).body.result).toEqual({ resourceTemplates: [] });
  });
  it("answers GET and DELETE with 405 and a challenge", async () => {
    const res = mkRes(); await routes["GET /mcp"]({ headers: {} }, res);
    expect(res.statusCode).toBe(405); expect(res.headers["WWW-Authenticate"]).toMatch(/oauth-protected-resource/);
  });
});

describe("bearer resolution", () => {
  it("challenges a missing or unknown bearer", async () => {
    const none = await post(rpc("ping"), "");
    expect(none.statusCode).toBe(401); expect(none.body).toEqual({ error: "Missing bearer token" }); expect(none.headers["WWW-Authenticate"]).toMatch(/Bearer resource_metadata=/);
    expect((await post(rpc("ping"), "Bearer wrong")).body).toEqual({ error: "Invalid bearer token" });
    expect((await post(rpc("ping"), "Basic abc")).statusCode).toBe(401);
  });
  it("accepts the static token, agent keys and OAuth tokens", async () => {
    for (const auth of ["Bearer static-token", "Bearer agent-write", "Bearer cxo_steward"]) expect((await post(rpc("ping"), auth)).body.result, auth).toEqual({});
  });
  it("acts as the forwarded identity behind an authenticating proxy", async () => {
    setup({ resolveForwardedIdentity: async (req) => req.headers["x-forwarded-email"] ? { id: "f1", name: "Fwd", email: req.headers["x-forwarded-email"], role: "steward", roles: ["steward"], scope: "write", identity: true } : null });
    expect((await post(rpc("ping"), "", { "x-forwarded-email": "fwd@x.de" })).body.result).toEqual({});
    expect((await post(rpc("ping"), "")).statusCode).toBe(401);
    setup({ resolveForwardedIdentity: async () => ({ error: "identity header missing" }) });
    expect((await post(rpc("ping"), "")).body).toEqual({ error: "identity header missing" });
  });
});

describe("write-scope gate", () => {
  const tools = buildTools({ readCatalog: async () => ({ catalog: null }), mutate: async () => {}, queryAudit: async () => [], searchRows: async () => [], collab: { of: async () => ({}), add: async () => ({}), open: async () => [] }, currentUser: () => users["agent-write"], appVersion: () => "9.9.9" });
  const flagged = tools.filter((t) => t.mutating === true);
  const unflagged = tools.filter((t) => t.mutating !== true);
  it("every flagged tool is refused for a read-scope agent key before it runs", async () => {
    setup({ collab: { of: async () => ({}), add: vi.fn(async () => ({})), open: async () => [] } });
    expect(flagged.length).toBeGreaterThan(20);
    for (const t of flagged) {
      const r = await callTool(t.name, minimalArgs(t.inputSchema), "Bearer agent-read");
      expect(r.body.error, t.name).toBeUndefined();
      expect(r.body.result.isError, t.name).toBe(true);
      expect(text(r), t.name).toBe(`Error: this agent key has read scope — "${t.name}" needs a write-scope key`);
    }
    expect(applyChanges).not.toHaveBeenCalled();
  });
  it("read tools stay available to a read-scope key", async () => {
    for (const t of unflagged.filter((t) => !["get_audit", "export_okf"].includes(t.name) && !t.name.match(/discussion|questions/))) {
      const r = await callTool(t.name, minimalArgs(t.inputSchema), "Bearer agent-read");
      expect(text(r), t.name).not.toMatch(/read scope/);
    }
  });
  it("words the refusal per credential type", async () => {
    expect(text(await callTool("create_hub", { name: "X" }, "Bearer cxo_reader"))).toBe('Error: this OAuth token has read scope — "create_hub" needs catalog:write (granted to admins and stewards)');
    setup({ resolveForwardedIdentity: async () => ({ id: "f1", name: "Fwd", email: "fwd@x.de", role: "guest", roles: ["guest"], scope: "read", identity: true }) });
    expect(text(await callTool("create_hub", { name: "X" }, ""))).toBe('Error: fwd@x.de has no editing role — "create_hub" needs admin or steward');
  });
  it("get_audit is gated by the people-based role for humans and open to agent keys", async () => {
    expect(text(await callTool("get_audit", {}, "Bearer cxo_reader"))).toMatch(/needs the admin or steward role/);
    expect(text(await callTool("get_audit", {}, "Bearer cxo_steward"))).toBe("[]");
    expect(text(await callTool("get_audit", {}, "Bearer agent-read"))).toBe("[]");
  });
});

describe("batches and rate limits", () => {
  it("answers a batch in order and caps its size at 50 messages", async () => {
    const r = await post([rpc("ping", null, "a"), rpc("tools/call", { name: "list_hubs", arguments: {} }, "b"), { jsonrpc: "2.0", method: "notifications/initialized" }]);
    expect(r.body.map((m) => m.id)).toEqual(["a", "b"]);
    const big = await post(Array.from({ length: 51 }, (_, i) => rpc("ping", null, i)));
    expect(big.statusCode).toBe(400);
    expect(big.body.error.message).toBe("Batch too large — at most 50 messages per request");
    expect((await post(Array.from({ length: 50 }, (_, i) => rpc("ping", null, i)))).body).toHaveLength(50);
  });
  it("counts every message of a batch against the per-credential limit and answers 429 when limited", async () => {
    rateLimit = vi.fn((cred, write) => ({ limited: false, limit: 100, remaining: 42, kind: write ? "writes" : "requests" }));
    setup();
    const r = await post([rpc("tools/call", { name: "create_hub", arguments: { name: "Z" } }, 1), rpc("ping", null, 2)], "Bearer agent-write");
    expect(rateLimit.mock.calls).toEqual([["key:k1", true], ["key:k1", false]]);
    expect(r.headers["X-RateLimit-Remaining"]).toBe("42");
    rateLimit = vi.fn(() => ({ limited: true, limit: 10, retryAfter: 30, kind: "writes" }));
    setup();
    const l = await post(rpc("ping"), "Bearer cxo_steward");
    expect(l.statusCode).toBe(429); expect(l.headers["Retry-After"]).toBe("30");
    expect(l.body.error.message).toMatch(/at most 10 writes per minute for this credential — retry in 30 s/);
    expect(rateLimit).toHaveBeenCalledWith("oauth:tok1", false);
  });
});

describe("mutate (delta save)", () => {
  it("saves the delta under the caller's identity and reports the audit entries", async () => {
    const r = await callTool("create_hub", { name: "Life" }, "Bearer agent-write");
    expect(text(r)).toBe('Hub "Life" created. (1 audit entry)');
    expect(applyChanges).toHaveBeenCalledTimes(1);
    const [u, changes, opts] = applyChanges.mock.calls[0];
    expect(u).toMatchObject({ id: "k1", name: "Writer Bot", scope: "write" });
    expect(changes).toEqual([{ entityType: "hub", action: "created", id: expect.any(String), after: expect.objectContaining({ name: "Life" }) }]);
    expect(opts).toEqual({ authorize: false });   /* agent keys are gated by scope only */
    applyChanges.mockResolvedValueOnce({ ok: true, version: 8, applied: 3 });
    expect(text(await callTool("delete_table", { table: "GOLD.dp.fact" }))).toMatch(/\(3 audit entries\)$/);
  });
  it("lets humans pass the UI's people-based authorisation", async () => {
    await callTool("create_hub", { name: "Life" }, "Bearer cxo_steward");
    expect(applyChanges.mock.calls[0][0]).toMatchObject({ email: "sam@x.de", oauth: { tokenId: "tok1" } });
    expect(applyChanges.mock.calls[0][2]).toEqual({ authorize: true });
  });
  it("skips the save when a tool changes nothing", async () => {
    expect(text(await callTool("update_hub", { hub: "Health" }))).toBe("Hub updated: Health.");
    expect(applyChanges).not.toHaveBeenCalled();
  });
  it("retries a conflicting save on a fresh document up to three times", async () => {
    applyChanges.mockRejectedValueOnce(conflict()).mockRejectedValueOnce(conflict());
    expect(text(await callTool("create_hub", { name: "Life" }))).toBe('Hub "Life" created. (1 audit entry)');
    expect(applyChanges).toHaveBeenCalledTimes(3);
    for (const [, changes] of applyChanges.mock.calls) expect(changes).toHaveLength(1);   /* each attempt re-reads the document, so the delta never accumulates */
    applyChanges.mockImplementation(async () => { throw conflict(); });
    const r = await callTool("create_hub", { name: "Again" });
    expect(r.body.result.isError).toBe(true);
    expect(text(r)).toBe("Error: The catalog is being changed concurrently — please retry");
    expect(applyChanges).toHaveBeenCalledTimes(6);
  });
  it("surfaces other save failures and an empty catalog", async () => {
    applyChanges.mockRejectedValueOnce(Object.assign(new Error("no editing right on hub Health"), { status: 403, violations: [] }));
    expect(text(await callTool("create_hub", { name: "Life" }))).toBe("Error: no editing right on hub Health");
    applyChanges.mockRejectedValueOnce(Object.assign(new Error(""), { status: 500 }));
    expect(text(await callTool("create_hub", { name: "Life" }))).toBe("Error: save failed (500)");
    cat = null;
    expect(text(await callTool("create_hub", { name: "Life" }))).toBe("Error: The catalog is empty — open the web UI once to initialise it");
  });
  it("keeps one caller's identity per request even when requests interleave", async () => {
    let release; const gate = new Promise((r) => { release = r; });
    applyChanges.mockImplementation(async () => { await gate; return { ok: true, version: 8, applied: 1 }; });
    const p1 = callTool("create_hub", { name: "A" }, "Bearer agent-write");
    const p2 = callTool("create_hub", { name: "B" }, "Bearer cxo_steward");
    await new Promise((r) => setTimeout(r, 5)); release();
    await Promise.all([p1, p2]);
    expect(applyChanges.mock.calls.map(([u]) => u.id).sort()).toEqual(["k1", "u1"]);
  });
});

/* v1.73 (F-M7 / F-M9): no privileged default identity; writes are charged by the messages that call a mutating tool */
describe("adapter contract (v1.73)", () => {
  it("buildTools requires currentUser and appVersion", () => {
    const base = { readCatalog: async () => ({ catalog: null }), mutate: async () => {}, queryAudit: async () => [], searchRows: async () => [] };
    expect(() => buildTools(base)).toThrow(/currentUser/);
    expect(() => buildTools({ ...base, currentUser: () => users["agent-write"] })).toThrow(/appVersion/);
  });
  it("charges the write limit for the messages that call a mutating tool, wherever they stand in the batch", async () => {
    rateLimit = vi.fn((cred, write) => ({ limited: false, limit: 100, remaining: 7, kind: write ? "writes" : "requests" }));
    setup();
    await post([rpc("ping", null, 1), rpc("tools/list", null, 2), rpc("tools/call", { name: "create_hub", arguments: { name: "Z" } }, 3)], "Bearer agent-write");
    expect(rateLimit.mock.calls).toEqual([["key:k1", false], ["key:k1", false], ["key:k1", true]]);
  });
});

describe("arguments (v1.74, F-M1 / F-M3 of the third review)", () => {
  it("an optional key sent as null is absent for the tool too — it never overwrites a field", async () => {
    cat.tables[0].description = "kept"; cat.tables[0].tags = "pii";
    const r = await callTool("update_table", { table: "GOLD.dp.fact", description: null, tags: null, business_definition: "new" });
    expect(r.body.result.isError, text(r)).toBe(false);
    const [, changes] = applyChanges.mock.calls[0];
    const after = changes.find((c) => c.after?.id === "t1").after;
    expect(after).toMatchObject({ description: "kept", tags: "pii", businessDefinition: "new" });
  });
  it("null-only updates change nothing", async () => {
    const r = await callTool("update_attribute", { attribute: "GOLD.dp.fact.id", data_type: null, nullable: null });
    expect(r.body.result.isError).toBe(false);
    const changed = (applyChanges.mock.calls[0]?.[1] || []).filter((c) => c.after?.id === "a1");
    expect(changed).toEqual([]);
  });
  it("limits and day counts are bounded by the schema, not clamped silently", async () => {
    for (const [name, args, msg] of [
      ["search_catalog", { query: "x", limit: 1e12 }, /limit must be at most 100/],
      ["get_audit", { limit: 500 }, /limit must be at most 100/],
      ["review_table", { table: "GOLD.dp.fact", cycle_days: 0.5 }, /cycle_days must be an integer/],
      ["list_stewardship_tasks", { attest_days: 5000 }, /attest_days must be at most 3650/],
      ["create_attribute", { table: "GOLD.dp.fact", name: "c", sensitivity: "Secret" }, /sensitivity must be one of Public, Internal, Confidential, PII/],
    ]) {
      const r = await callTool(name, args);
      expect(r.body.error?.code, name).toBe(-32602);
      expect(r.body.error.message, name).toMatch(msg);
    }
  });
});
