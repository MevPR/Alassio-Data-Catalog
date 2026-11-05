import { describe, it, expect } from "vitest";
import { changesBetween } from "../../mcp.js";
import { diffCollection, diffCatalogs, catalogMaps } from "../../catalog-diff.js";
import { csvTouchedTableIds } from "../../csv-import.js";

const user = { id: "u", name: "U", email: "u@x" };
const small = () => ({ hubs: [{ id: "h", name: "H" }], domains: [], people: [], glossary: [], databases: [{ id: "d", name: "D", hubId: "h" }], schemas: [{ id: "s", databaseId: "d", name: "S" }],
  tables: [{ id: "t1", schemaId: "s", name: "T1", description: "" }, { id: "t2", schemaId: "s", name: "T2" }], lineage: [{ id: "e", from: "t1", to: "t2" }] });

describe("MCP delta writes on the lazy document", () => {
  it("reports created / updated / deleted records of the small collections and of the loaded attributes only", () => {
    const before = small();
    const after = { ...structuredClone(before), attributes: [] };
    Object.defineProperty(after, "$snapshot", { value: [{ id: "a1", tableId: "t1", name: "old", dataType: "INT" }, { id: "a2", tableId: "t1", name: "gone" }] });
    after.attributes = [{ id: "a1", tableId: "t1", name: "renamed", dataType: "INT" }, { id: "a3", tableId: "t1", name: "new" }];   /* a2 removed */
    after.tables[0].description = "documented";
    after.tables = after.tables.filter((t) => t.id !== "t2");                       /* t2 deleted — its unloaded attributes are the server's cascade */
    after.people.push({ id: "p", name: "Jane" });
    const ch = changesBetween(before, after);
    const key = (c) => `${c.entityType}:${c.action}:${c.id}`;
    expect(ch.map(key).sort()).toEqual(["attribute:created:a3", "attribute:deleted:a2", "attribute:updated:a1", "person:created:p", "table:deleted:t2", "table:updated:t1"]);
    expect(ch.find((c) => c.id === "t1").before.description).toBe("");
    expect(ch.find((c) => c.id === "a1").after.name).toBe("renamed");
  });
  it("treats a full document (no $snapshot) like before: attributes come from the before document", () => {
    const before = { ...small(), attributes: [{ id: "a1", tableId: "t1", name: "x" }] };
    const after = structuredClone(before); after.attributes[0].name = "y";
    expect(changesBetween(before, after)).toEqual([{ entityType: "attribute", action: "updated", id: "a1", before: before.attributes[0], after: after.attributes[0] }]);
  });
});

describe("per-collection diff (streamed restore)", () => {
  it("equals the whole-document diff when applied collection by collection", () => {
    const prev = { ...small(), attributes: [{ id: "a1", tableId: "t1", name: "x" }] };
    const next = structuredClone(prev); next.tables[0].description = "d"; next.attributes.push({ id: "a2", tableId: "t2", name: "n" }); next.lineage = [];
    const mPrev = catalogMaps(prev), mNext = catalogMaps(next);
    const perColl = [["table", "tables"], ["attribute", "attributes"], ["lineage", "lineage"]].flatMap(([type, key]) => diffCollection(type, prev[key], next[key], user, mPrev, mNext));
    const whole = diffCatalogs(prev, next, user);
    const strip = (e) => ({ type: e.entityType, action: e.action, id: e.entityId, context: e.context, name: e.name });
    expect(perColl.map(strip)).toEqual(whole.map(strip));
    expect(perColl.find((e) => e.entityId === "a2").context).toBe("D.S.T2");
    expect(perColl.find((e) => e.entityId === "e").name).toBe("T1 → T2");   /* deletion context from the previous maps */
  });
});

describe("CSV import on the lite document", () => {
  it("names the existing tables a file addresses so only their attributes are loaded", () => {
    const rows = [{ database: "D", schema: "S", table: "T1", attribute: "a" }, { database: "D", schema: "S", table: "NEW", attribute: "b" }, { database: "X", schema: "S", table: "T1" }, { database: "D", schema: "S", table: "T2", attribute: "c" }];
    expect(csvTouchedTableIds(small(), rows).sort()).toEqual(["t1", "t2"]);
  });
});
