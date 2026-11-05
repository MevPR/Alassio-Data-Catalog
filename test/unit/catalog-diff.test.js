import { describe, it, expect } from "vitest";
import { diffCatalogs, recChanges } from "../../catalog-diff.js";

const user = { id: "u", name: "Tester", email: "t@x.io" };
const base = () => ({
  hubs: [{ id: "h1", name: "Health" }], databases: [{ id: "d1", name: "GOLD", hubId: "h1" }],
  schemas: [{ id: "s1", databaseId: "d1", name: "partners" }], tables: [{ id: "t1", schemaId: "s1", name: "loss_ratio", description: "a" }],
  attributes: [{ id: "a1", tableId: "t1", name: "lr", dataType: "INT" }], domains: [], people: [], lineage: [], glossary: [],
});

describe("change engine", () => {
  it("reports field-level updates with context and scope", () => {
    const prev = base(), next = base();
    next.tables[0].description = "b";
    const e = diffCatalogs(prev, next, user);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ action: "updated", entityType: "table", entityId: "t1", context: "GOLD.partners" });
    expect(e[0].changes).toEqual([{ field: "description", from: "a", to: "b" }]);
    expect(e[0].scope).toContain("d1");
  });
  it("reports created and deleted objects", () => {
    const prev = base(), next = base();
    next.attributes = [{ id: "a2", tableId: "t1", name: "new", dataType: "STRING" }];
    const e = diffCatalogs(prev, next, user);
    expect(e.map((x) => [x.action, x.entityId]).sort()).toEqual([["created", "a2"], ["deleted", "a1"]]);
  });
  it("names lineage links by table names and is empty when nothing changed", () => {
    const prev = base(), next = base();
    next.tables.push({ id: "t2", schemaId: "s1", name: "src" });
    next.lineage = [{ id: "e1", from: "t2", to: "t1" }];
    const e = diffCatalogs(prev, next, user);
    expect(e.find((x) => x.entityType === "lineage").name).toBe("src → loss_ratio");
    expect(diffCatalogs(base(), base(), user)).toHaveLength(0);
    expect(recChanges({ a: 1 }, { a: 1 })).toEqual([]);
  });
});
