/* v1.71 — openRef() is the one jump into the catalog; a table tab is validated against TABLE_TABS (a jump to a
   non-existent tab used to leave the table page blank), and the tree keys come from one vocabulary. */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNavigation } from "../../src/hooks/use-navigation.js";
import { TABLE_TABS, DEFAULT_TABLE_TAB, tableTabOr, treeKey, VIEWS } from "../../src/lib/navigation.js";

const L = {
  table: (id) => ({ t1: { id: "t1", schemaId: "s1" } }[id] || null),
  schema: (id) => ({ s1: { id: "s1", databaseId: "d1" } }[id] || null),
  db: (id) => ({ d1: { id: "d1", hubId: "h1", country: "DE" } }[id] || null),
  attribute: (id) => ({ a1: { id: "a1", tableId: "t1" } }[id] || null),
};

describe("navigation vocabulary", () => {
  it("tableTabOr falls back for unknown tabs; tree keys have one spelling", () => {
    expect(TABLE_TABS[0]).toBe(DEFAULT_TABLE_TAB);
    expect(tableTabOr("lineage")).toBe("lineage"); expect(tableTabOr("attributes")).toBe("technical"); expect(tableTabOr(undefined, "governance")).toBe("governance");
    expect(treeKey.hub("h1")).toBe("hub:h1"); expect(treeKey.country("h1", "")).toBe("co:h1:GLOBAL"); expect(treeKey.db("d1")).toBe("db:d1"); expect(treeKey.schema("s1")).toBe("sc:s1");
    expect(VIEWS).toContain("backups");
  });
});

describe("useNavigation().openRef", () => {
  it("an attribute reference opens its table on an existing tab, a table ref honours a valid tab and keeps the current one otherwise", () => {
    const { result } = renderHook(() => useNavigation({ L, me: null }));
    act(() => result.current.openRef({ type: "attribute", id: "a1" }));
    expect(result.current.sel).toEqual({ type: "table", id: "t1" }); expect(result.current.view).toBe("catalog");
    expect(TABLE_TABS).toContain(result.current.tableTab);   /* the old code set "attributes" here */
    act(() => result.current.openRef({ type: "table", id: "t1", tab: "lineage" }));
    expect(result.current.tableTab).toBe("lineage");
    act(() => result.current.openRef({ type: "table", id: "t1" }));
    expect(result.current.tableTab).toBe("lineage");   /* no tab asked → the current tab stays */
    act(() => result.current.openRef({ type: "table", id: "t1", tab: "nope" }));
    expect(result.current.tableTab).toBe(DEFAULT_TABLE_TAB);   /* a bogus tab never leaves the page blank */
    act(() => result.current.openRef({ type: "datahub", hubId: "h1", name: "DE" }));
    expect(result.current.sel).toEqual({ type: "datahub", hubId: "h1", name: "DE" });
  });
  it("the tree auto-expands to the selected table with the shared keys", () => {
    const { result } = renderHook(() => useNavigation({ L, me: null }));
    act(() => result.current.openRef({ type: "table", id: "t1" }));
    expect(result.current.open).toEqual({ [treeKey.hub("h1")]: true, [treeKey.country("h1", "DE")]: true, [treeKey.db("d1")]: true, [treeKey.schema("s1")]: true });
  });
});
