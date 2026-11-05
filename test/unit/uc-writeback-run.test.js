/* v1.72 (F-S15): server/uc-writeback-run.js (server/uc-writeback.js until v1.73) runWriteBack — profile resolution, preview (dry run) vs. write, bookkeeping and
   audit. The profile store and the catalog store are mocked; the Databricks workspace is a fake fetch. */
import { describe, it, expect, vi, beforeEach } from "vitest";

const store = vi.hoisted(() => ({ catalog: null, attributes: [], profiles: [] }));
vi.mock("../../server/catalog-store.js", () => ({
  assembleLite: vi.fn(async () => ({ catalog: store.catalog ? structuredClone(store.catalog) : null, version: 1 })),
  attributesOfTables: vi.fn(async (ids) => store.attributes.filter((a) => ids.includes(a.tableId))),
}));
vi.mock("../../server/audit.js", () => ({ sysAudit: vi.fn(async () => {}) }));
const authors = vi.hoisted(() => ({ byLabel: {} }));
vi.mock("../../server/writeback-authors.js", async (orig) => { const m = await orig(); return { ...m, attributeOps: vi.fn(async (ops) => { for (const o of ops) o.author = authors.byLabel[o.label] || null; return ops; }) }; });
vi.mock("../../server/sync-profiles.js", () => ({
  syncProfiles: vi.fn(async () => store.profiles),
  bearerFor: vi.fn(async () => "tok-1"),
  hostOf: vi.fn(() => "https://adb-1.azuredatabricks.net"),
  recordWriteBack: vi.fn(async () => {}),
  warehouseOf: (p) => p.warehouseId || p.writeBack?.warehouseId || "",
}));

const { runWriteBack, UC_WRITEBACK_TASK } = await import("../../server/uc-writeback-run.js");
const { ucRequester } = await import("../../server/unity-client.js");   /* v1.73 (F-S8): the requester lives with the Databricks client */
const { sysAudit } = await import("../../server/audit.js");
const { recordWriteBack } = await import("../../server/sync-profiles.js");

const CATALOG = {
  hubs: [{ id: "h", name: "Health" }], people: [], domains: [], lineage: [], glossary: [],
  databases: [{ id: "d", name: "main", source: "unity", hubId: "h", description: "Claims DWH" }],
  schemas: [{ id: "s", databaseId: "d", name: "claims", description: "" }],
  tables: [{ id: "t1", schemaId: "s", name: "fact_claims", description: "One row per claim" }],
};
const ATTRS = [{ id: "a1", tableId: "t1", name: "claim_id", description: "Claim number" }];
const profile = (extra = {}) => ({ id: "prof-1", name: "Main", catalog: "main", writeBack: { enabled: true }, ...extra });

/* fake workspace: catalog / schema / table reads, PATCHes (optionally failing) and SQL statements */
const fakeWorkspace = ({ patchStatus = 200 } = {}) => {
  const calls = [];
  const resp = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const fetchImpl = vi.fn(async (url, opts = {}) => {
    const path = url.replace("https://adb-1.azuredatabricks.net", "");
    calls.push({ path, method: opts.method || "GET", headers: opts.headers, body: opts.body ? JSON.parse(opts.body) : null });
    if (opts.method === "PATCH") return resp({}, patchStatus);
    if (path === "/api/2.1/unity-catalog/catalogs/main") return resp({ name: "main", comment: "old comment", properties: {} });
    if (path.startsWith("/api/2.1/unity-catalog/schemas?")) return resp({ schemas: [{ name: "claims", comment: "" }] });
    if (path.startsWith("/api/2.1/unity-catalog/tables?")) return resp({ tables: [{ name: "fact_claims", comment: "", properties: {}, columns: [{ name: "claim_id", comment: "" }] }] });
    if (path === "/api/2.0/sql/statements") return resp({ status: { state: "SUCCEEDED" }, result: { data_array: [] } });
    return resp({ error: "not found" }, 404);
  });
  return { fetchImpl, calls, patches: () => calls.filter((c) => c.method === "PATCH"), sql: () => calls.filter((c) => c.path === "/api/2.0/sql/statements").map((c) => c.body.statement) };
};

beforeEach(() => {
  vi.clearAllMocks();
  store.catalog = CATALOG; store.attributes = ATTRS; store.profiles = [profile()];
});

describe("ucRequester", () => {
  it("binds the profile's workspace host and bearer token to every request", async () => {
    const ws = fakeWorkspace();
    const req = await ucRequester(profile(), ws.fetchImpl);
    await req("/api/2.1/unity-catalog/catalogs/main");
    expect(ws.fetchImpl).toHaveBeenCalledWith("https://adb-1.azuredatabricks.net/api/2.1/unity-catalog/catalogs/main", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer tok-1", "Content-Type": "application/json" }) }));
  });
});

describe("runWriteBack", () => {
  it("dry run: plans the differences, writes nothing, records and audits nothing", async () => {
    const ws = fakeWorkspace();
    const r = await runWriteBack(profile(), undefined, { fetchImpl: ws.fetchImpl, dryRun: true });
    expect(r.ok).toBe(true); expect(r.dryRun).toBe(true); expect(r.written).toBe(0);
    expect(r.total).toBeGreaterThanOrEqual(2);
    expect(r.log.every((l) => l.planned && l.ok)).toBe(true);
    expect(r.log.map((l) => l.label)).toEqual(expect.arrayContaining(["Catalog main — description", "Table main.claims.fact_claims — description"]));
    expect(r.skipped).toBe(1);   /* the column comment needs SQL — no warehouse on the profile */
    expect(ws.patches()).toHaveLength(0);
    expect(sysAudit).not.toHaveBeenCalled(); expect(recordWriteBack).not.toHaveBeenCalled();
  });

  it("apply: writes the planned changes with the profile's token, records the result and audits as the system actor", async () => {
    const ws = fakeWorkspace();
    const r = await runWriteBack(profile(), undefined, { fetchImpl: ws.fetchImpl });
    expect(r.ok).toBe(true); expect(r.dryRun).toBe(false); expect(r.failed).toBe(0); expect(r.written).toBe(r.total);
    expect(ws.patches().map((p) => [p.path, p.body.comment])).toEqual(expect.arrayContaining([["/api/2.1/unity-catalog/catalogs/main", "Claims DWH"], ["/api/2.1/unity-catalog/tables/main.claims.fact_claims", "One row per claim"]]));
    expect(ws.patches().every((p) => p.headers.Authorization === "Bearer tok-1")).toBe(true);
    expect(recordWriteBack).toHaveBeenCalledWith("prof-1", r);
    expect(sysAudit).toHaveBeenCalledTimes(1);
    const [actor, type, action, name] = sysAudit.mock.calls[0];
    expect(actor).toEqual({ id: "system", name: "Unity Catalog write-back", email: "system" });
    expect([type, action]).toEqual(["system", "exported"]);
    expect(name).toMatch(/^Unity Catalog write-back Main \(main\): \d+ of \d+ change\(s\) written, 1 skipped \(no SQL warehouse\)$/);
  });

  it("with a warehouse the SQL-only changes run as statements; the caller is the audited actor", async () => {
    const ws = fakeWorkspace();
    const user = { id: "u1", name: "Ada Admin", email: "ada@x.io" };
    const r = await runWriteBack(profile({ warehouseId: "wh-1" }), user, { fetchImpl: ws.fetchImpl });
    expect(r.ok).toBe(true); expect(r.skipped).toBe(0); expect(r.tagsReadable).toBe(true);
    expect(ws.sql().some((s) => s === "ALTER TABLE `main`.`claims`.`fact_claims` ALTER COLUMN `claim_id` COMMENT 'Claim number'")).toBe(true);
    expect(sysAudit.mock.calls[0][0]).toBe(user);
  });

  it("failed operations are counted, never stop the run, and are audited as failed", async () => {
    const ws = fakeWorkspace({ patchStatus: 403 });
    const r = await runWriteBack(profile(), undefined, { fetchImpl: ws.fetchImpl });
    expect(r.ok).toBe(false); expect(r.failed).toBe(r.total); expect(r.written).toBe(0);
    expect(r.log.every((l) => !l.ok && /HTTP 403/.test(l.label))).toBe(true);
    expect(sysAudit.mock.calls[0][2]).toBe("failed");
    expect(recordWriteBack).toHaveBeenCalledWith("prof-1", r);
  });

  it("resolves a profile id through the profile store; an unknown id is a 404", async () => {
    const ws = fakeWorkspace();
    expect((await runWriteBack("prof-1", undefined, { fetchImpl: ws.fetchImpl, dryRun: true })).ok).toBe(true);
    await expect(runWriteBack("nope", undefined, { fetchImpl: ws.fetchImpl })).rejects.toMatchObject({ status: 404, message: "Unknown sync profile" });
  });

  it("a catalog that was never synced yields a failed result (recorded and audited), not an exception", async () => {
    store.catalog = { ...CATALOG, databases: [] };
    const ws = fakeWorkspace();
    const r = await runWriteBack(profile(), undefined, { fetchImpl: ws.fetchImpl });
    expect(r).toMatchObject({ ok: false, total: 0, written: 0, failed: 0, log: [] });
    expect(r.error).toMatch(/not in the data catalog yet/);
    expect(ws.fetchImpl).not.toHaveBeenCalled();
    expect(recordWriteBack).toHaveBeenCalledWith("prof-1", r);
    expect(sysAudit.mock.calls[0][2]).toBe("failed");
  });

  it("the task requires a profileId and passes dryRun through", async () => {
    await expect(UC_WRITEBACK_TASK.run(null, {})).rejects.toMatchObject({ status: 400 });
    store.catalog = { ...CATALOG, databases: [] };   /* stops before any workspace call — the task uses the real fetch */
    const r = await UC_WRITEBACK_TASK.run(null, { profileId: "prof-1", dryRun: true });
    expect(r).toMatchObject({ dryRun: true, ok: false });
    expect(recordWriteBack).not.toHaveBeenCalled();
  });

  /* v1.77: changes belong to the user who made them */
  describe("scope mine", () => {
    const anna = { id: "u-anna", name: "Anna Weber", email: "anna@x.de", role: "steward", roles: ["steward"] };
    const admin = { id: "u-admin", name: "Ada", email: "ada@x.de", role: "admin", roles: ["admin"] };
    beforeEach(() => { authors.byLabel = { "Catalog main — description": { id: "u-anna", name: "Anna Weber", ts: 10 }, "Table main.claims.fact_claims — description": { id: "u-jonas", name: "Jonas Klein", ts: 20 } }; });
    it("preview lists every pending change with its author and marks what the caller may write", async () => {
      const ws = fakeWorkspace();
      const r = await runWriteBack(profile(), anna, { fetchImpl: ws.fetchImpl, dryRun: true, scope: "mine" });
      expect(r.scope).toBe("mine"); expect(r.total).toBe(1);   /* total = what this user would write */
      expect(r.pending).toEqual({ mine: 1, unattributed: 1, others: [{ id: "u-jonas", name: "Jonas Klein", count: 1 }], writable: 1 });
      const byLabel = Object.fromEntries(r.log.map((l) => [l.label, l]));
      expect(byLabel["Catalog main — description"]).toMatchObject({ planned: true, mine: true, author: { name: "Anna Weber" } });
      expect(byLabel["Table main.claims.fact_claims — description"]).toMatchObject({ mine: false, author: { name: "Jonas Klein" } });
      expect(byLabel["Schema main.claims — description"] ?? byLabel[Object.keys(byLabel).find((k) => k.startsWith("Schema"))]).toBeUndefined();   /* schema comment equal → no op */
      expect(ws.patches()).toHaveLength(0);
    });
    it("apply writes only the caller's own changes; the others stay pending for their authors", async () => {
      const ws = fakeWorkspace();
      const r = await runWriteBack(profile(), anna, { fetchImpl: ws.fetchImpl, scope: "mine" });
      expect(r.ok).toBe(true); expect(r.total).toBe(1); expect(r.written).toBe(1);
      expect(ws.patches().map((p) => p.path)).toEqual(["/api/2.1/unity-catalog/catalogs/main"]);
      expect(sysAudit.mock.calls[0][3]).toMatch(/1 of 1 change\(s\) written.*\(own changes\)$/);
    });
    it("an admin writes the unattributed changes, not other users' ones", async () => {
      const ws = fakeWorkspace();
      authors.byLabel = { "Catalog main — description": { id: "u-anna", name: "Anna Weber", ts: 10 } };   /* the table comment has no author */
      const r = await runWriteBack(profile(), admin, { fetchImpl: ws.fetchImpl, scope: "mine" });
      expect(r.pending).toMatchObject({ mine: 0, unattributed: 2, others: [{ name: "Anna Weber", count: 1 }], writable: 2 });   /* table comment + data_hub property */
      expect(ws.patches().map((p) => [p.path, Object.keys(p.body)[0]])).toEqual([["/api/2.1/unity-catalog/catalogs/main", "properties"], ["/api/2.1/unity-catalog/tables/main.claims.fact_claims", "comment"]]);
    });
    it("scope all (automatic write-back) still writes everything and carries no author information", async () => {
      const ws = fakeWorkspace();
      const r = await runWriteBack(profile(), undefined, { fetchImpl: ws.fetchImpl });
      expect(r.scope).toBe("all"); expect(r.pending).toBeUndefined(); expect(ws.patches()).toHaveLength(3);
    });
    it("one write-back per profile at a time (409); previews are never blocked", async () => {
      let release; const gate = new Promise((res) => { release = res; });
      const slow = vi.fn(async (url, opts = {}) => { if ((opts.method || "GET") === "PATCH") await gate; return fakeWorkspace().fetchImpl(url, opts); });
      const first = runWriteBack(profile(), anna, { fetchImpl: slow, scope: "mine" });
      await new Promise((res) => setTimeout(res, 20));
      await expect(runWriteBack(profile(), anna, { fetchImpl: slow, scope: "mine" })).rejects.toMatchObject({ status: 409 });
      await expect(runWriteBack(profile(), anna, { fetchImpl: fakeWorkspace().fetchImpl, dryRun: true, scope: "mine" })).resolves.toMatchObject({ dryRun: true });
      release(); await first;
      await expect(runWriteBack(profile(), anna, { fetchImpl: fakeWorkspace().fetchImpl, scope: "mine" })).resolves.toMatchObject({ ok: true });
    });
  });
});
