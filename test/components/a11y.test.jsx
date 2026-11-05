import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { Modal, MenuC, clickable } from "../../src/components/ui.jsx";
import { I18nProvider, useT, LangSwitchC } from "../../src/i18n.jsx";

afterEach(cleanup);

describe("accessible dialog", () => {
  it("is labelled, traps focus, closes on Escape and returns focus to the opener", () => {
    const Host = () => { const [open, setOpen] = useState(false); return (<div>
      <button onClick={() => setOpen(true)}>Open it</button>
      {open && <Modal title="Edit table" sub="Some help" onClose={() => setOpen(false)}><input aria-label="Name" /><button>Save</button></Modal>}
    </div>); };
    render(<Host />);
    const opener = screen.getByText("Open it"); opener.focus();
    fireEvent.click(opener);
    const dlg = screen.getByRole("dialog");
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(dlg.getAttribute("aria-labelledby")).toBe(dlg.querySelector("h3").id);
    expect(screen.getByRole("dialog", { name: "Edit table" })).toBeTruthy();
    expect(document.activeElement.closest('[role="dialog"]')).toBe(dlg);          /* focus moved into the dialog */
    const save = screen.getByText("Save"); save.focus();
    fireEvent.keyDown(document, { key: "Tab" });                                   /* wraps from the last to the first control */
    expect(document.activeElement).toBe(dlg.querySelector("button"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
  it("v1.74 (F-F1): with an autofocused field focus still returns to the opener, and Escape calls the current onClose", () => {
    const calls = [];
    const Host = () => { const [open, setOpen] = useState(false); const [n, setN] = useState(0); return (<div>
      <button onClick={() => setOpen(true)}>Open it</button>
      {open && <Modal title="Rename" onClose={() => { calls.push(n); setOpen(false); }}>
        <input aria-label="Name" autoFocus /><button onClick={() => setN((x) => x + 1)}>Bump</button></Modal>}
    </div>); };
    render(<Host />);
    const opener = screen.getByText("Open it"); opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));        /* autoFocus wins inside the dialog */
    fireEvent.click(screen.getByText("Bump")); fireEvent.click(screen.getByText("Bump"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(calls).toEqual([2]);                                                  /* the onClose of the latest render */
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);                                 /* was <body> in v1.71–v1.73 */
  });
});

describe("menu keyboard support", () => {
  it("moves focus with the arrow keys and closes on Escape", () => {
    const a = vi.fn(), b = vi.fn();
    render(<MenuC label="Admin" icon={null} items={[{ label: "Users", onClick: a }, { label: "Audit", onClick: b }]} />);
    const trigger = screen.getByRole("button", { name: /Admin/ });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(trigger);
    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document, { key: "ArrowDown" }); expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(document, { key: "ArrowDown" }); expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document, { key: "ArrowUp" }); expect(document.activeElement).toBe(items[1]);
    fireEvent.click(items[1]); expect(b).toHaveBeenCalled();
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull(); expect(document.activeElement).toBe(trigger);
  });
});

describe("clickable rows and language switching", () => {
  it("activates card-like elements with Enter and Space", () => {
    const on = vi.fn();
    render(<div data-testid="card" {...clickable(on)}>Card</div>);
    const card = screen.getByTestId("card");
    expect(card.getAttribute("role")).toBe("button"); expect(card.tabIndex).toBe(0);
    fireEvent.keyDown(card, { key: "Enter" }); fireEvent.keyDown(card, { key: " " }); fireEvent.keyDown(card, { key: "a" });
    expect(on).toHaveBeenCalledTimes(2);
  });
  it("translates to French and Italian and sets the document language", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    const Probe = () => { const { t, lang, setLang } = useT(); return (<div><span data-testid="txt">{t("My Dashboard")}</span><LangSwitchC lang={lang} setLang={setLang} /></div>); };
    render(<I18nProvider initial="en"><Probe /></I18nProvider>);
    expect(screen.getByTestId("txt").textContent).toBe("My Dashboard");
    const sel = screen.getByRole("combobox");
    expect([...sel.options].map((o) => o.value)).toEqual(["en", "de", "pl", "es", "fr", "it"]);
    await act(async () => { fireEvent.change(sel, { target: { value: "fr" } }); });
    expect(screen.getByTestId("txt").textContent).toBe("Mon tableau de bord"); expect(document.documentElement.lang).toBe("fr");
    await act(async () => { fireEvent.change(sel, { target: { value: "it" } }); });
    expect(screen.getByTestId("txt").textContent).toBe("La mia dashboard"); expect(document.documentElement.lang).toBe("it");
    vi.unstubAllGlobals();
  });
});

/* v1.74 (F-F6 of the third review): list rows that open something are reachable with the keyboard */
describe("clickable rows", () => {
  it("dashboard, inbox, discussion, request and lineage rows use clickable() (role=button, Enter / Space)", async () => {
    const fs = await import("node:fs");
    const files = ["src/components/my-dashboard.jsx", "src/components/collab.jsx", "src/components/inbox.jsx", "src/components/admin.jsx",
      "src/components/data-product-status.jsx", "src/components/marketplace/request-list.jsx", "src/views/table-view.jsx"];
    for (const f of files) {
      const mouseOnly = fs.readFileSync(f, "utf8").split("\n").filter((l) => /<(tr|div|li|span)\b[^>]*\sonClick=/.test(l) && !/stopPropagation|e\.target === e\.currentTarget/.test(l));
      expect(mouseOnly, f).toEqual([]);
    }
  });
  it("a clickable row activates on Enter and Space, not on keys from inner controls", () => {
    const fn = vi.fn();
    render(<div {...clickable(fn)}>Row<button>inner</button></div>);
    const row = screen.getByRole("button", { name: /Row/ });
    fireEvent.keyDown(row, { key: "Enter" }); fireEvent.keyDown(row, { key: " " });
    fireEvent.keyDown(screen.getByText("inner"), { key: "Enter" });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
