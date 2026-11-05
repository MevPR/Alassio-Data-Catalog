/* v1.73 (F-F6 / F-F8) — the marketplace composer: a new preset is applied in place (no remount, typed design input
   survives), the design form is one object (useDesignForm) and the view reads the catalog contexts. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, renderHook, act } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n.jsx";
import { CatalogProviders } from "../../src/catalog-context.jsx";
import { MarketplaceViewC } from "../../src/components/marketplace.jsx";
import { useDesignForm } from "../../src/hooks/use-design-form.js";
import { catalogValues } from "../helpers/catalog.jsx";
import { okJson as ok } from "../helpers/fetch.js";

afterEach(cleanup);

describe("useDesignForm", () => {
  it("derives the tag until it is typed, loads a design for editing and resets keeping the hub", () => {
    const { result } = renderHook(() => useDesignForm("Sales"));
    act(() => result.current.set("name", "Churn List"));
    expect(result.current.tagValue).toMatch(/^Sales Gold\..+ \(Churn List\)$/);
    act(() => result.current.setTag("custom"));
    expect(result.current.tagValue).toBe("custom");
    act(() => result.current.resetTag());
    expect(result.current.tagValue).toBe(result.current.suggested);
    expect(result.current.valid).toBe(false);
    act(() => result.current.startEdit({ id: "r1", name: "DP", hub: "Finance", purpose: "why", project: "GenAI", useCase: "UC", tagValue: "t", tableIds: ["a"], advanced: { retention: "1 year" } }));
    expect(result.current.form).toMatchObject({ editingId: "r1", hubName: "Finance", advOpen: true, tagTouched: true });
    expect(result.current.valid).toBe(true);
    expect(result.current.payload()).toMatchObject({ name: "DP", hub: "Finance", purpose: "why", tagKey: "Data Product", tagValue: "t", tableIds: ["a"], project: "GenAI", useCase: "UC" });
    act(() => result.current.reset());
    expect(result.current.form).toMatchObject({ editingId: null, name: "", hubName: "Finance", tableIds: [] });
  });
});

describe("MarketplaceViewC", () => {
  it("applies a new preset without losing what was typed in the design form", async () => {
    globalThis.fetch = vi.fn(async () => ok({ requests: [], scope: "all" }));
    const base = { catalog: { hubs: [{ id: "h", name: "Health" }, { id: "source", name: "SOURCE" }] }, data: { mpProducts: [{ id: "s1", label: "Health · GOLD.partners", ownerName: "Owen" }] } };
    const v1 = catalogValues(base);
    const ui = (values) => <I18nProvider initial="en"><CatalogProviders {...values}><MarketplaceViewC /></CatalogProviders></I18nProvider>;
    const { rerender } = render(ui(v1));
    expect(await screen.findByRole("button", { name: /All requests \(0\)/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Design a new data product/ }));
    expect(screen.queryByRole("option", { name: "SOURCE" })).toBeNull();   /* the SOURCE hub is not a design target */
    fireEvent.change(screen.getByLabelText("Name (required)"), { target: { value: "Churn" } });
    /* "Request access" on a gold schema: a new preset arrives while the view is mounted */
    rerender(ui({ ...v1, nav: { ...v1.nav, mpPreset: { productId: "s1" } } }));
    expect(screen.getByRole("combobox").value).toBe("s1");
    expect(screen.getByText(/Data owner: Owen/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Design a new data product/ }));
    expect(screen.getByLabelText("Name (required)").value).toBe("Churn");   /* not remounted */
    expect(globalThis.fetch.mock.calls.filter(([u]) => String(u) === "/api/marketplace/requests")).toHaveLength(1);
  });
});
