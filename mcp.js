/**
 * Alassio Data Catalog — MCP server for AI agents.
 *
 * Implements the Model Context Protocol over Streamable HTTP (stateless):
 * a single POST /mcp endpoint speaking JSON-RPC 2.0 with the methods
 * initialize, ping, tools/list and tools/call.
 * Layout since v1.69: mcp/lookups.js (reference resolution), mcp/schema.js (schemas + argument validation),
 * mcp/views.js (result shapes), mcp/tools/*.js (one module per tool group); this file keeps the protocol plumbing,
 * the per-request identity, the delta-save `mutate` and the HTTP endpoint.
 *
 * Scope: every catalog action (read, search, lineage, audit trail, full
 * CRUD on hubs, databases, schemas, tables, attributes, lineage links)
 * EXCEPT user management — accounts, roles, invitations, 2FA and dumps
 * are deliberately not exposed. Unity-Catalog-imported lineage stays
 * locked, and hub deletion guards match the UI.
 *
 * Auth: bearer token — either the static MCP_TOKEN from the environment or a per-agent key
 * issued to an account with the role "agent" (User management). Agent keys bypass 2FA by design.
 *
 * Scaling (v1.56): tools work on the lite document (no attribute payloads) and call `c.$load([tableIds])` for the
 * attributes they need; writes are computed as deltas against that snapshot and saved with per-object conflict
 * detection (applyChanges) — the full catalog is assembled only for the OKF bundle.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "crypto";
import { buildOkfBundle } from "./okf.js";
import { AUDIT_COLL, changesBetween } from "./catalog-diff.js";
import { load } from "./mcp/lookups.js";
import { validateArgs, withoutNulls } from "./mcp/schema.js";
import { PRODUCT } from "./src/lib/model.js";
import readTools from "./mcp/tools/read.js";
import structureTools from "./mcp/tools/structure.js";
import stewardshipTools from "./mcp/tools/stewardship.js";
import collabTools from "./mcp/tools/collab.js";
import attributeTools from "./mcp/tools/attributes.js";
import lineageTools from "./mcp/tools/lineage.js";
import glossaryTools from "./mcp/tools/glossary.js";
import okfTools from "./mcp/tools/okf.js";
export { validateArgs, MAX_STRING, MAX_ITEMS, MAX_DEPTH } from "./mcp/schema.js";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MCP_USER = { id: "mcp-agent", name: "MCP Agent", email: "mcp@agent.local" };
/* ── tool registry ──
   v1.69: the tools live in mcp/tools/*.js, one module per group; each exports (ctx) => [tool…]. Every tool that changes
   the catalog carries `mutating: true` explicitly (the flag drives the write-scope gate and the write rate limit;
   test/unit/pentest-followup.test.js calls every tool and checks that exactly the flagged ones reach a writer — v1.71). The
   caller's identity reaches the tools through ctx.currentUser() — never through module state. */
export const TOOL_GROUPS = [readTools, structureTools, stewardshipTools, collabTools, attributeTools, lineageTools, glossaryTools, okfTools];
/* v1.73 (F-M7): `currentUser` and `appVersion` are required — no module-level version and no privileged default identity
   for a caller outside registerMcp */
export function buildTools({ readCatalog, mutate, queryAudit, searchRows, collab = null, currentUser, isPrivileged: priv = isPrivileged, appVersion }) {
  if (typeof currentUser !== "function") throw new TypeError("buildTools: currentUser() is required");
  if (typeof appVersion !== "function") throw new TypeError("buildTools: appVersion() is required");
  const ctx = { readCatalog, mutate, queryAudit, searchRows, collab, currentUser, isPrivileged: priv, appVersion };
  return TOOL_GROUPS.flatMap((group) => group(ctx));
}

/* v1.66.1 (security review): the caller's identity travels in a per-request async context — the former shared
   variable could be overwritten by a concurrent request between two awaits, so a read-only caller's batch could run
   under another caller's write scope and the audit trail named the wrong person. */
const safeEqual = (a, b) => { const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || "")); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };
const reqCtx = new AsyncLocalStorage();
/* v1.73 (F-M7): outside a request there is no caller — fail closed instead of acting as the privileged MCP_USER */
const curUser = () => { const u = reqCtx.getStore()?.user; if (!u) throw new Error("No MCP caller in this context"); return u; };
/* human-backed credentials (OAuth tokens, forwarded SSO identities) are subject to the same people-based gate as the UI;
   agent keys and the static MCP_TOKEN are gated by scope only */
const isHuman = (u) => !!(u?.oauth || u?.identity);
const isPrivileged = (u) => !isHuman(u) || (u.roles || [u.role]).some((r) => r === "admin" || r === "steward");
const MAX_BATCH = Math.max(1, Number(process.env.MCP_MAX_BATCH || 50));

/* ── protocol plumbing ── */
/* v1.68: changesBetween / canonical comparison live in catalog-diff.js (the shared change engine) so the catalog domain
   no longer depends on this protocol adapter; re-exported here for callers that still import it from mcp.js */
export { changesBetween } from "./catalog-diff.js";
const snapshotSmall = (c) => Object.fromEntries(AUDIT_COLL.filter(([, key]) => key !== "attributes" || !c.$snapshot).map(([, key]) => [key, structuredClone(c[key] || [])]));

export function registerMcp(app, { readCatalog, applyChanges, queryAudit, appVersion, searchRows, resolveAgentKey, resolveOAuthToken = null, resolveForwardedIdentity = null, rateLimit = null, collab = null }) {
  const MCP_TOKEN = process.env.MCP_TOKEN || "";
  const APP_URL = (process.env.APP_URL || "http://localhost").replace(/\/$/, "");
  const challenge = (res) => res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${APP_URL}/.well-known/oauth-protected-resource"`);

  /* read-modify-write as a delta save with per-object conflict detection and retry; `fn` may be async and may load
     attributes with c.$load. (v1.68: the legacy whole-document path (writeCatalog) is gone — applyChanges is required.) */
  const mutate = async (fn) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { catalog } = await readCatalog();
      if (!catalog) throw new Error("The catalog is empty — open the web UI once to initialise it");
      const before = snapshotSmall(catalog);
      const msg = await fn(catalog);
      const changes = changesBetween(before, catalog);
      if (!changes.length) return msg;
      const u = curUser();
      let r;
      try { r = await applyChanges(u, changes, { authorize: isHuman(u) }); }   /* humans (OAuth / forwarded identity) pass the UI's people-based gate; agent keys are gated by scope */
      catch (e) { if (e?.status === 409) continue; throw e?.message ? e : new Error(`save failed (${e?.status})`); }   /* v1.73 (F-S2): refusals throw; a conflict retries on a fresh document */
      return `${msg}${r.applied ? ` (${r.applied} audit entr${r.applied === 1 ? "y" : "ies"})` : ""}`;
    }
    throw new Error("The catalog is being changed concurrently — please retry");
  };

  const tools = buildTools({ readCatalog, mutate, queryAudit, searchRows, collab, currentUser: curUser, isPrivileged, appVersion: () => appVersion });
  let okfCache = null; /* { version, files } — the bundle is rebuilt only when the catalog version changes */
  const okfFiles = async () => {
    const { catalog: c, version } = await readCatalog();
    if (!c) return {};
    if (okfCache && okfCache.version === version) return okfCache.files;
    await load(c, null);   /* the whole bundle needs every attribute — built once per catalog version */
    const files = await buildOkfBundle(c, { tableIds: null }, { version: appVersion, catalogVersion: version, title: "Alassio Data Catalog" });
    okfCache = { version, files };
    return files;
  };
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
  const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

  /* v1.73 (F-M9): one handler per JSON-RPC method instead of an if-chain; each takes (id, params) and returns the answer */
  const writeScopeRefusal = (cu, name) => cu.oauth ? `Error: this OAuth token has read scope — "${name}" needs catalog:write (granted to admins and stewards)`
    : cu.identity ? `Error: ${cu.email} has no editing role — "${name}" needs admin or steward` : `Error: this agent key has read scope — "${name}" needs a write-scope key`;
  const METHODS = {
    initialize: async (id, params) => {
      const want = params.protocolVersion;
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(want) ? want : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } },
        serverInfo: { name: "datahub-catalog", title: PRODUCT, version: appVersion },
        instructions: `${PRODUCT}. All catalog actions are available (read, search, lineage, audit, CRUD on hubs/databases/schemas/tables/attributes/lineage). User management is not exposed. Reference objects by path: database | database.schema | database.schema.table | database.schema.table.attribute. The whole catalog is also readable as an Open Knowledge Format (OKF) bundle via MCP resources: start at okf://index.md and follow the links (index.md per level), or call the export_okf tool.`,
      });
    },
    ping: async (id) => rpcResult(id, {}),
    "tools/list": async (id) => rpcResult(id, { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }),
    "resources/list": async (id) => {
      const files = await okfFiles();
      return rpcResult(id, { resources: Object.keys(files).sort((a, b) => (a === "index.md" ? -1 : b === "index.md" ? 1 : a.localeCompare(b)))
        .map((p) => ({ uri: `okf://${p}`, name: p, mimeType: "text/markdown", description: p === "index.md" ? "OKF bundle root — start here" : undefined })) });
    },
    "resources/templates/list": async (id) => rpcResult(id, { resourceTemplates: [] }),
    "resources/read": async (id, params) => {
      const uri = String(params.uri || "");
      if (!uri.startsWith("okf://")) return rpcError(id, -32602, `Unknown resource URI: ${uri}`);
      const p = uri.slice("okf://".length).replace(/^\/+/, "");
      const files = await okfFiles();
      if (!(p in files)) return rpcError(id, -32002, `Resource not found: ${uri}`);
      return rpcResult(id, { contents: [{ uri, mimeType: "text/markdown", text: files[p] }] });
    },
    "tools/call": async (id, params) => {
      const tool = toolMap.get(params.name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${params.name}`);
      const args = params.arguments ?? {};
      const bad = validateArgs(tool.inputSchema, args);
      if (bad) return rpcError(id, -32602, `Invalid params: ${bad}`);
      const cu = curUser();
      if (tool.mutating === true && cu.scope === "read") return rpcResult(id, { content: [{ type: "text", text: writeScopeRefusal(cu, params.name) }], isError: true });
      try {
        const out = await tool.run(withoutNulls(args));   /* null = absent, as for the validator (v1.74) */
        const text = typeof out === "string" ? out : JSON.stringify(out, null, 2);
        return rpcResult(id, { content: [{ type: "text", text }], isError: false });
      } catch (e) {
        return rpcResult(id, { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
      }
    },
  };

  const handle = async (msg) => {
    if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg?.id ?? null, -32600, "Invalid request");
    const { id, method, params = {} } = msg;
    try {
      if (method.startsWith("notifications/")) return null;
      if (Object.hasOwn(METHODS, method)) return await METHODS[method](id, params);
      if (id === undefined || id === null) return null;   /* an unknown notification gets no answer */
      return rpcError(id, -32601, `Method not found: ${method}`);
    } catch (e) {
      return rpcError(id, -32603, e.message);
    }
  };

  /* v1.73 (F-M9): the four credential paths in one place → { user, credential } or { error } (always a 401 + challenge).
     Order: static MCP_TOKEN, OAuth access token (cxo_…), agent key, then the forwarded identity of an authenticating proxy. */
  const resolveCredential = async (req) => {
    const auth = req.headers.authorization || "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (bearer) {
      if (MCP_TOKEN && safeEqual(bearer, MCP_TOKEN)) return { user: MCP_USER, credential: "static" };
      if (resolveOAuthToken && bearer.startsWith("cxo_")) { const u = await resolveOAuthToken(bearer); if (u) return { user: { id: u.id, name: u.name, email: u.email, role: u.role, roles: u.roles, scope: u.scope, oauth: u.oauth }, credential: `oauth:${u.oauth.tokenId}` }; }
      else if (resolveAgentKey) { const u = await resolveAgentKey(bearer); if (u) return { user: { id: u.id, name: u.name, email: u.email, role: u.role, roles: u.roles, scope: u.scope || "write" }, credential: `key:${u.key_id || u.id}` }; }
    }
    /* behind an authenticating proxy (Databricks Apps) the platform already verified the caller: act as the forwarded identity (v1.61) */
    if (resolveForwardedIdentity) {
      const u = await resolveForwardedIdentity(req);
      if (u && u.error) return { error: u.error };
      if (u) return { user: u, credential: `identity:${u.email}` };
    }
    if (!bearer) return { error: "Missing bearer token" };
    return { error: MCP_TOKEN ? "Invalid bearer token" : "Invalid bearer token — use an agent key issued in User management or connect via OAuth" };
  };
  /* a message that calls a mutating tool — charged against the write limit (v1.73: by message, not "the first N") */
  const isWrite = (m) => m?.method === "tools/call" && toolMap.get(String(m.params?.name || ""))?.mutating === true;

  app.post("/mcp", async (req, res) => {
    const { user, credential, error } = await resolveCredential(req);
    if (!user) { challenge(res); return res.status(401).json({ error }); }
    const msgs = Array.isArray(req.body) ? req.body : [req.body];
    if (msgs.length > MAX_BATCH) return res.status(400).json(rpcError(null, -32600, `Batch too large — at most ${MAX_BATCH} messages per request`));
    if (rateLimit) {
      /* v1.66.1: every message of a batch counts against the limits, not only the HTTP request */
      let rl = null;
      for (const m of msgs) { rl = rateLimit(credential, isWrite(m)); if (rl.limited) break; }
      rl = rl || rateLimit(credential, false);
      res.setHeader("X-RateLimit-Limit", String(rl.limit));
      if (rl.limited) {
        res.setHeader("Retry-After", String(rl.retryAfter)); res.setHeader("X-RateLimit-Remaining", "0");
        return res.status(429).json(rpcError(msgs[0]?.id ?? null, -32000, `Rate limit exceeded: at most ${rl.limit} ${rl.kind} per minute for this credential — retry in ${rl.retryAfter} s`));
      }
      res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
    }
    try {
      const body = req.body;
      const batch = Array.isArray(body);
      const answers = await reqCtx.run({ user }, async () => {
        const out = [];
        for (const m of batch ? body : [body]) {
          const a = await handle(m);
          if (a) out.push(a);
        }
        return out;
      });
      if (!answers.length) return res.status(202).end();
      res.json(batch ? answers : answers[0]);
    } catch (e) {
      console.error("MCP error:", e);
      res.status(500).json(rpcError(null, -32603, "Internal error"));
    }
  });
  const notAllowed = (req, res) => { challenge(res); res.status(405).json({ error: "Use POST with JSON-RPC 2.0 messages (bearer: MCP_TOKEN, an agent key or an OAuth access token)" }); };
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
}
