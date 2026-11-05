import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/db.js", async () => (await import("../helpers/server-mocks.js")).mockDb());
vi.mock("../../server/settings.js", () => ({ getSetting: vi.fn(async () => []), setSetting: vi.fn(async () => {}) }));
vi.mock("../../server/catalog-store.js", () => ({ assembleLite: vi.fn(), attributesOfTables: vi.fn(), applyChanges: vi.fn() }));
vi.mock("../../server/mail.js", () => ({ notifyI18n: vi.fn(async () => 1), emailsByRole: vi.fn(async () => []) }));
vi.mock("../../server/audit.js", () => ({ sysAudit: vi.fn(async () => {}) }));

const { computeDrift } = await import("../../server/uc-sync.js");
const { dueProfiles, publicProfile, PROFILE_DEFAULT } = await import("../../server/sync-profiles.js");
const { renderMessage } = await import("../../server/i18n.js");

const catalog = {
  hubs: [{ id: "h", name: "Central" }], databases: [{ id: "d", name: "main", source: "unity", hubId: "h" }], schemas: [{ id: "s", databaseId: "d", name: "sales" }],
  tables: [{ id: "t1", schemaId: "s", name: "orders" }, { id: "t2", schemaId: "s", name: "customers" }],
  attributes: [{ id: "a1", tableId: "t1", name: "id", dataType: "INT" }, { id: "a2", tableId: "t1", name: "amount", dataType: "DECIMAL(10,2)" }, { id: "a3", tableId: "t2", name: "id", dataType: "INT" }],
  people: [], domains: [], lineage: [], glossary: [],
};
const payload = [
  { name: "sales", tables: [{ name: "orders", columns: [{ name: "id", type_text: "INT" }, { name: "amount", type_text: "DOUBLE" }, { name: "status", type_text: "STRING" }] }] },
  { name: "finance", tables: [{ name: "ledger", columns: [{ name: "id", type_text: "BIGINT" }] }] },
];

describe("Unity Catalog drift", () => {
  it("finds new schemas/tables/columns, removed ones and type changes", () => {
    const d = computeDrift(catalog, "main", payload);
    expect(d.counts).toEqual({ newSchemas: 1, newTables: 1, newColumns: 2, removedTables: 1, removedColumns: 0, changedTypes: 1 });
    expect(d.newTables).toEqual(["finance.ledger"]); expect(d.newColumns.sort()).toEqual(["finance.ledger.id", "sales.orders.status"]);
    expect(d.removedTables).toEqual([{ path: "sales.customers", tableId: "t2" }]);
    expect(d.changedTypes[0]).toMatchObject({ path: "sales.orders.amount", from: "DECIMAL(10,2)", to: "DOUBLE", attributeId: "a2" });
    expect(d.total).toBe(6); expect(d.database).toBe("d");
  });
  it("treats an unknown catalog as entirely new and can ignore type changes", () => {
    const d = computeDrift(catalog, "other", payload);
    expect(d.database).toBeNull(); expect(d.counts.newSchemas).toBe(2); expect(d.counts.newTables).toBe(2); expect(d.counts.removedTables).toBe(0);
    expect(computeDrift(catalog, "main", payload, { updateTypes: false }).counts.changedTypes).toBe(0);
  });
  it("picks the due profiles by schedule", () => {
    const now = new Date("2026-10-05T09:30:00");
    const p = (o) => ({ ...PROFILE_DEFAULT, id: o.id || "x", enabled: true, ...o });
    const due = dueProfiles([
      p({ id: "manual", schedule: "manual" }),
      p({ id: "hourly-fresh", schedule: "hourly", lastRun: { at: now.getTime() - 10 * 60000 } }),
      p({ id: "hourly-old", schedule: "hourly", lastRun: { at: now.getTime() - 61 * 60000 } }),
      p({ id: "daily-later", schedule: "daily", time: "10:00" }),
      p({ id: "daily-due", schedule: "daily", time: "09:00" }),
      p({ id: "daily-done", schedule: "daily", time: "09:00", lastRun: { at: new Date("2026-10-05T09:05:00").getTime() } }),
      p({ id: "disabled", schedule: "hourly", enabled: false }),
    ], now).map((x) => x.id);
    expect(due).toEqual(["hourly-old", "daily-due"]);
  });
  it("masks secrets in the public profile and renders the drift message in six languages", () => {
    const pub = publicProfile({ ...PROFILE_DEFAULT, id: "p", auth: { type: "pat", token: "dapi-secret", clientId: "", clientSecret: "" } });
    expect(pub.auth.token).toBe("••••••••"); expect(pub.auth.hasToken).toBe(true);
    for (const l of ["en", "de", "pl", "es", "fr", "it"]) {
      const m = renderMessage("uc_drift", l, { profile: "Nightly", catalog: "main", mode: "report", items: [{ kind: "newTable", path: "sales.returns" }, { kind: "changedType", path: "sales.orders.amount", from: "DECIMAL", to: "DOUBLE" }], more: 0 });
      expect(m.subject).toContain("main"); expect(m.body).toContain("sales.returns"); expect(m.body).toContain("DECIMAL → DOUBLE");
    }
    expect(renderMessage("uc_drift", "de", { profile: "N", catalog: "main", mode: "apply", items: [{ kind: "newColumn", path: "a.b.c" }], more: 3 }).body).toMatch(/neue Spalte[\s\S]*… und 3 weitere/);
  });
});
