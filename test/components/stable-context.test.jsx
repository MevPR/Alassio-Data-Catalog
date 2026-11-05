/* v1.71 (F-F1) — the catalog context keeps its identity when nothing it carries changed: action functions are
   stable (useStableCallbacks) and always reach the newest closure. Before, five per-render closures in the memo's
   dependency array rebuilt the context on every render (a language switch changed 40 function keys).
   v1.73 (F-F8): three contexts — the Actions value never changes identity, the Data value survives a language switch
   and a navigation step, the Nav value changes only when navigation does. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, renderHook, act } from "@testing-library/react";
import { useStableCallbacks } from "../../src/hooks/use-stable-callbacks.js";
import { appShellFetch } from "../helpers/fetch.js";

const seen = [];
vi.mock("../../src/views/main.jsx", async () => {
  const { useCatalogData, useNav, useActions } = await import("../../src/catalog-context.jsx");
  return { MainView: () => { seen.push({ data: useCatalogData(), nav: useNav(), actions: useActions() }); return <div data-testid="main-probe" />; } };
});
const { default: App } = await import("../../src/App.jsx");
afterEach(cleanup);

describe("useStableCallbacks", () => {
  it("keeps one identity per key and calls the newest implementation; non-functions are dropped", () => {
    let n = 1;
    const { result, rerender } = renderHook(() => useStableCallbacks({ get: () => n, value: n }));
    const first = result.current;
    expect(first.get()).toBe(1); expect("value" in first).toBe(false);
    n = 2; rerender();
    expect(result.current).toBe(first);            /* same object, same function */
    expect(result.current.get()).toBe(2);           /* but the newest closure */
  });
});

describe("catalog context identity", () => {
  it("survives a language switch and a navigation step: same Data and Actions objects, newest closures", async () => {
    const me = { id: "u", name: "Tester", email: "t@x.io", role: "admin", roles: ["admin"] };
    const cat = { hubs: [{ id: "h", name: "Health" }], databases: [], schemas: [], tables: [], attributes: [], domains: [], people: [], lineage: [], glossary: [] };
    globalThis.fetch = appShellFetch({ me, catalog: cat });
    try { localStorage.setItem("cortex.lang", "en"); } catch { }
    render(<App />);
    await screen.findByTestId("main-probe");
    await waitFor(() => expect(globalThis.fetch.mock.calls.some(([u]) => String(u).includes("/api/stewardship/policy"))).toBe(true));
    await act(async () => {});   /* let the remaining effects settle */
    const before = seen[seen.length - 1];
    const select = screen.getByRole("combobox", { name: /Language/ });
    fireEvent.change(select, { target: { value: "de" } });
    await waitFor(() => expect(screen.getByRole("combobox", { name: /Sprache/ })).toBeTruthy());
    const afterLang = seen[seen.length - 1];
    expect(afterLang.data).toBe(before.data);         /* nothing in the catalog data changed → same object */
    expect(afterLang.actions).toBe(before.actions);   /* the actions never change */
    expect(afterLang.nav).toBe(before.nav);
    /* a navigation step changes Nav only */
    act(() => before.nav.setView("glossary"));
    await waitFor(() => expect(seen[seen.length - 1].nav.view).toBe("glossary"));
    const afterNav = seen[seen.length - 1];
    expect(afterNav.nav).not.toBe(before.nav);
    expect(afterNav.data).toBe(before.data);
    expect(afterNav.actions).toBe(before.actions);
    expect(typeof afterNav.actions.openRef).toBe("function"); expect(afterNav.nav.openRef).toBe(afterNav.actions.openRef);
  });
});
