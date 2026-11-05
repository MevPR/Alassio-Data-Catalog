/* v1.71 (F-S1) — the design-workflow tag sync works on the lite document and saves a delta: no attribute rows are
   read, no whole-document write, and only the touched tables / schemas appear in the change set. */
import { describe, it, expect, vi, beforeEach } from "vitest";

const store = { catalog: null, calls: [] };
vi.mock("../../server/db.js", async () => (await import("../helpers/server-mocks.js")).mockDb());
vi.mock("../../server/i18n.js", () => ({ STATUS_TEXT_L10N: { en: {} } }));
vi.mock("../../server/catalog-store.js", () => ({
  assembleLite: vi.fn(async () => ({ catalog: structuredClone(store.catalog), stats: { attributes: 0, perTable: {} }, version: 3 })),
  applyChanges: vi.fn(async (user, changes, opts) => { store.calls.push({ user, changes, opts }); return { ok: true, version: 4, applied: changes.length }; }),
}));

const { syncDesignTags, applyDesignTags, isDesignOwner } = await import("../../server/design-workflow.js");
const { assembleLite, applyChanges } = await import("../../server/catalog-store.js");

const base = () => ({
  hubs: [{ id: "h1", name: "Health" }], domains: [], people: [{ id: "p1", name: "Owen", email: "owen@x.io" }],
  databases: [{ id: "d1", hubId: "h1", name: "gold_db", layer: "gold" }, { id: "d2", hubId: "h1", name: "src", layer: "bronze" }],
  schemas: [{ id: "s1", databaseId: "d1", name: "claims_product" }, { id: "s2", databaseId: "d2", name: "raw" }],
  tables: [{ id: "t1", schemaId: "s2", name: "a", kvTags: [] }, { id: "t2", schemaId: "s2", name: "b", kvTags: [{ key: "Project", value: "P-old" }] }, { id: "t3", schemaId: "s2", name: "c" }],
  attributes: [], lineage: [], glossary: [],
});
const user = { id: "u1", name: "Pat", email: "pat@x.io" };

beforeEach(() => { store.catalog = base(); store.calls = []; vi.clearAllMocks(); });

describe("design tag sync on the lite document", () => {
  it("syncDesignTags tags added tables, untags removed ones and saves one delta with only the touched tables", async () => {
    const prev = { table_ids: JSON.stringify(["t2"]), tag_key: "Data Product", tag_value: "DP", project: "P-old", use_case: null };
    const next = { table_ids: JSON.stringify(["t1"]), tag_key: "Data Product", tag_value: "DP", project: "P-new", use_case: "UC" };
    await syncDesignTags(prev, next, user);
    expect(assembleLite).toHaveBeenCalledTimes(1);
    expect(applyChanges).toHaveBeenCalledTimes(1);
    const { changes, opts } = store.calls[0];
    expect(opts).toEqual({ authorize: false });
    const ids = changes.map((c) => c.after?.id || c.before?.id).sort();
    expect(ids).toEqual(["t1", "t2"]);   /* t3 untouched → not in the delta */
    const t1 = changes.find((c) => c.after?.id === "t1").after;
    expect(t1.kvTags).toEqual([{ key: "Data Product", value: "DP" }, { key: "Project", value: "P-new" }, { key: "Use Case", value: "UC" }]);
    const t2 = changes.find((c) => c.after?.id === "t2").after;
    expect(t2.kvTags).toEqual([]);
  });
  it("nothing to do → no write at all", async () => {
    await syncDesignTags({ table_ids: "[]" }, { table_ids: "[]" }, user);
    expect(assembleLite).not.toHaveBeenCalled(); expect(applyChanges).not.toHaveBeenCalled();
    await syncDesignTags({ table_ids: JSON.stringify(["t2"]), project: "P-old" }, { table_ids: JSON.stringify(["t2"]), project: "P-old" }, user);
    expect(applyChanges).not.toHaveBeenCalled();   /* t2 already carries Project P-old: the document did not change */
  });
  it("applyDesignTags tags the gold schema named after the design and nothing else", async () => {
    await applyDesignTags({ name: "Claims Product", hub: "Health", project: "P1", use_case: "UC1", tag_value: "DP" }, user);
    expect(applyChanges).toHaveBeenCalledTimes(1);
    const { changes } = store.calls[0];
    expect(changes.map((c) => c.after.id)).toEqual(["s1"]);
    expect(changes[0].after.kvTags).toEqual([{ key: "Project", value: "P1" }, { key: "Use Case", value: "UC1" }, { key: "Data Product", value: "DP" }]);
  });
  it("isDesignOwner matches the BPO by e-mail through the lite document", async () => {
    const row = { sourcing_json: JSON.stringify({ bpo: "Owen" }) };
    expect(await isDesignOwner(row, { name: "Someone", email: "OWEN@x.io" })).toBe(true);
    expect(await isDesignOwner(row, { name: "Owen", email: "impostor@x.io" })).toBe(false);
  });
});
