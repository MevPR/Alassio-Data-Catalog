/* v1.70 — route-resident logic moved into domain modules is testable without Express:
   server/tasks.js (the scheduled-task registry), server/sso.js (id_token verification, login halves),
   server/sync-profiles.js (the profile store without a cycle to uc-writeback.js), server/dump.js (dump streaming). */
import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { PassThrough } from "stream";

const settings = { store: {} };
vi.mock("../../server/settings.js", () => ({ getSetting: vi.fn(async (k, d) => (k in settings.store ? settings.store[k] : d)), setSetting: vi.fn(async (k, v) => { settings.store[k] = v; }) }));
vi.mock("../../server/audit.js", () => ({ sysAudit: vi.fn(async () => {}) }));
vi.mock("../../server/db.js", async () => (await import("../helpers/server-mocks.js")).mockDb());
vi.mock("../../server/identity.js", () => ({ resolveExternalIdentity: vi.fn(async ({ email }) => ({ user: { id: "u1", email } })), groupMapping: vi.fn(async () => ({ rules: [], syncRoles: false })), AUTH_MODE: "local" }));
vi.mock("../../server/catalog-store.js", () => ({ assembleLite: vi.fn(async () => ({ catalog: { hubs: [{ id: "h" }], tables: [{ id: "t1" }] }, version: 7 })), attributeChunks: vi.fn(async function* () { yield [{ id: "a1", tableId: "t1" }]; yield [{ id: "a2", tableId: "t1" }]; }), writeCatalog: vi.fn(), AUDIT_SUMMARY_ABOVE: 500 }));
vi.mock("../../server/catalog-migrate.js", () => ({ migrateStoredCatalog: vi.fn(async () => ({ changes: 0 })) }));
vi.mock("../../server/jobs.js", () => ({ finishJob: vi.fn(), setPhase: vi.fn() }));

const { registerTask, runTask, listTasks, taskNames } = await import("../../server/tasks.js");
const { verifyIdToken, beginSsoLogin, completeSsoLogin, ssoPublic } = await import("../../server/sso.js");
const { dueProfiles, workspaceHostAllowed, publicProfile, PROFILE_DEFAULT } = await import("../../server/sync-profiles.js");
const { writeDumpTo, dumpSource } = await import("../../server/dump.js");
const { sysAudit } = await import("../../server/audit.js");

beforeEach(() => { settings.store = {}; vi.clearAllMocks(); });

describe("tasks registry (server/tasks.js)", () => {
  it("runs a registered task, records the last run and audits it; unknown tasks are a 404", async () => {
    registerTask("t-ok", { description: "ok", schedule: "manual", run: async (user, body) => ({ got: body.x, by: user.email }) });
    registerTask("t-fail", { description: "fails", schedule: async () => "daily 03:00", run: async () => { throw new Error("boom"); } });
    const ok = await runTask("t-ok", { email: "ada@x.io" }, { x: 1 });
    expect(ok).toMatchObject({ task: "t-ok", ok: true, result: { got: 1, by: "ada@x.io" } });
    const bad = await runTask("t-fail");
    expect(bad).toMatchObject({ task: "t-fail", ok: false, error: "boom" });
    expect(settings.store["tasks.lastRuns"]["t-ok"].ok).toBe(true); expect(settings.store["tasks.lastRuns"]["t-fail"].error).toBe("boom");
    expect(sysAudit).toHaveBeenCalledWith(expect.anything(), "system", "failed", "task t-fail: boom");
    await expect(runTask("nope")).rejects.toMatchObject({ status: 404 });
    const list = await listTasks();
    expect(list.find((t) => t.name === "t-fail")).toMatchObject({ schedule: "daily 03:00", lastRun: expect.objectContaining({ ok: false }) });
    expect(taskNames()).toEqual(expect.arrayContaining(["t-ok", "t-fail"]));
  });
});

/* a signed id_token from a throw-away RSA key; the JWKS and the discovery document come from an injected fetch */
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const meta = { issuer: "https://login.microsoftonline.com/tid/v2.0", jwks_uri: "https://x/jwks", authorization_endpoint: "https://x/authorize", token_endpoint: "https://x/token" };
const sign = (payload, header = { alg: "RS256", kid: "k1" }) => { const body = `${b64(header)}.${b64(payload)}`; const sig = crypto.sign("sha256", Buffer.from(body), privateKey).toString("base64url"); return `${body}.${sig}`; };
const now = Math.floor(Date.now() / 1000);
const claims = { aud: "client", iss: meta.issuer, exp: now + 600, nonce: "n1", tid: "11111111-2222-3333-4444-555555555555", sub: "s1", preferred_username: "Ada@X.io", name: "Ada" };
const fetchJwks = async (url) => ({ ok: true, json: async () => (String(url).endsWith("/jwks") ? { keys: [jwk] } : meta) });

describe("Entra id_token verification (server/sso.js)", () => {
  it("accepts a valid token and rejects audience / nonce / tenant / expiry / signature problems", async () => {
    const p = await verifyIdToken(sign(claims), meta, "client", "n1", claims.tid, { fetchImpl: fetchJwks });
    expect(p.sub).toBe("s1");
    await expect(verifyIdToken(sign({ ...claims, aud: "other" }), meta, "client", "n1", "", { fetchImpl: fetchJwks })).rejects.toThrow(/audience/);
    await expect(verifyIdToken(sign(claims), meta, "client", "n2", "", { fetchImpl: fetchJwks })).rejects.toThrow(/nonce/);
    await expect(verifyIdToken(sign(claims), meta, "client", "n1", "99999999-2222-3333-4444-555555555555", { fetchImpl: fetchJwks })).rejects.toThrow(/tenant/);
    await expect(verifyIdToken(sign({ ...claims, exp: now - 3600 }), meta, "client", "n1", "", { fetchImpl: fetchJwks })).rejects.toThrow(/expired/);
    const [h, b] = sign(claims).split("."); const forged = `${h}.${b}.${Buffer.from("nope").toString("base64url")}`;
    await expect(verifyIdToken(forged, meta, "client", "n1", "", { fetchImpl: fetchJwks })).rejects.toThrow(/signature/);
    await expect(verifyIdToken(sign(claims, { alg: "RS256", kid: "unknown" }), meta, "client", "n1", "", { fetchImpl: fetchJwks })).rejects.toThrow(/Signing key/);
  });
  it("login halves: the authorization URL carries PKCE + state, the callback exchanges the code and resolves the account", async () => {
    const c = { enabled: true, tenantId: claims.tid, clientId: "client", clientSecret: "s", autoProvision: true, defaultRoles: ["guest"], buttonLabel: "Go", enforce: false };
    expect(ssoPublic(c)).toMatchObject({ enabled: true, buttonLabel: "Go", enforce: false });
    const url = new URL(await beginSsoLogin(c, { fetchImpl: fetchJwks }));
    expect(url.origin + url.pathname).toBe("https://x/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256"); expect(url.searchParams.get("client_id")).toBe("client");
    const state = url.searchParams.get("state"), nonce = url.searchParams.get("nonce");
    const calls = [];
    const fetchImpl = async (u, opts) => { calls.push([String(u), opts]); if (String(u) === meta.token_endpoint) return { ok: true, json: async () => ({ id_token: sign({ ...claims, nonce }) }) }; return fetchJwks(u); };
    const user = await completeSsoLogin(c, { code: "abc", state }, { fetchImpl });
    expect(user).toMatchObject({ id: "u1", email: "ada@x.io" });
    const tokenCall = calls.find(([u]) => u === meta.token_endpoint)[1];
    expect(String(tokenCall.body)).toMatch(/grant_type=authorization_code/); expect(String(tokenCall.body)).toMatch(/code_verifier=/);
    await expect(completeSsoLogin(c, { code: "abc", state }, { fetchImpl })).rejects.toThrow(/expired sign-in state/);   /* single use */
  });
});

describe("sync profiles (server/sync-profiles.js)", () => {
  it("dueProfiles honours schedule, enabled flag and last run; publicProfile masks secrets; host allow-list", () => {
    const at = new Date("2026-10-22T04:00:00"); const base = { ...PROFILE_DEFAULT, enabled: true, time: "03:00" };
    expect(dueProfiles([{ ...base, schedule: "manual" }], at)).toHaveLength(0);
    expect(dueProfiles([{ ...base, schedule: "hourly", lastRun: { at: at.getTime() - 3599000 } }], at)).toHaveLength(0);
    expect(dueProfiles([{ ...base, schedule: "hourly", lastRun: { at: at.getTime() - 3600000 } }], at)).toHaveLength(1);
    expect(dueProfiles([{ ...base, schedule: "daily", lastRun: null }], at)).toHaveLength(1);
    expect(dueProfiles([{ ...base, schedule: "daily", lastRun: { at: at.getTime() - 1000 } }], at)).toHaveLength(0);
    expect(dueProfiles([{ ...base, schedule: "daily", enabled: false }], at)).toHaveLength(0);
    const pub = publicProfile({ ...base, auth: { type: "sp", token: "", clientId: "cid", clientSecret: "sec" } });
    expect(pub.auth).toMatchObject({ clientId: "cid", hasSecret: true, hasToken: false }); expect(pub.auth.clientSecret).not.toBe("sec");
    expect(workspaceHostAllowed("adb-123.4.azuredatabricks.net")).toBe(true); expect(workspaceHostAllowed("evil.example.com")).toBe(false);
  });
});

describe("dump streaming (server/dump.js)", () => {
  it("writes a parseable dump with the attributes streamed from the chunk iterator", async () => {
    const out = new PassThrough(); let text = ""; out.on("data", (d) => { text += d; });
    const src = await dumpSource();
    await writeDumpTo(out, { ...src, users: [{ id: "u", name: "A", email: "a@x", role: "admin", totp_enabled: 1 }] });
    out.end();
    const d = JSON.parse(text);
    expect(d).toMatchObject({ format: "datahub-catalog-dump", version: 3, catalogVersion: 7 });
    expect(d.catalog.attributes.map((a) => a.id)).toEqual(["a1", "a2"]); expect(d.catalog.tables).toHaveLength(1);
    expect(d.users[0]).not.toHaveProperty("password_hash");
  });
});
