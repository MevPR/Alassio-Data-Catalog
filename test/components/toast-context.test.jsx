/* v1.70 — ToastProvider: flash(key, vars) translates the key and fills the placeholders; confirm() / prompt() open an
   accessible dialog instead of window.confirm / prompt and resolve with the user's answer. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n.jsx";
import { ToastProvider, useToast } from "../../src/toast-context.jsx";
import { fill } from "../../src/lib/i18n-format.js";

afterEach(cleanup);

let api;
const Probe = () => { api = useToast(); return <div data-testid="probe" />; };
const mount = (lang = "en") => render(<I18nProvider initial={lang}><ToastProvider duration={400}><Probe /></ToastProvider></I18nProvider>);

describe("fill()", () => {
  it("fills placeholders and leaves unknown ones visible", () => {
    expect(fill("Deleted {name} ({n})", { name: "A", n: 2 })).toBe("Deleted A (2)");
    expect(fill("Hello {who}", { other: 1 })).toBe("Hello {who}");
    expect(fill("plain", null)).toBe("plain");
  });
});

describe("ToastProvider", () => {
  it("flash translates the key and fills the vars; the toast disappears after the duration", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });   /* v1.72: the toast duration is fast-forwarded, not waited for */
    try {
      mount("de");
      act(() => api.flash("Glossary term \"{name}\" deleted", { name: "Prämie" }));
      expect(screen.getByRole("status").textContent).toBe("Glossarbegriff „Prämie“ gelöscht");
      expect(document.querySelector(".toast").textContent.trim()).toBe("Glossarbegriff „Prämie“ gelöscht");
      act(() => { vi.advanceTimersByTime(399); });
      expect(document.querySelector(".toast")).not.toBeNull();
      act(() => { vi.advanceTimersByTime(2); });
      expect(document.querySelector(".toast")).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it("confirm opens a dialog and resolves true / false", async () => {
    mount();
    let p; act(() => { p = api.confirm("Delete table \"{name}\"?", { name: "claims" }, { danger: true }); });
    const dlg = await screen.findByRole("dialog");
    expect(dlg.textContent).toMatch(/Delete table "claims"\?/);
    const ok = screen.getByTestId("confirm-ok"); expect(ok.textContent).toBe("Delete"); expect(ok.className).toMatch(/btn-danger/);
    fireEvent.click(ok);
    expect(await p).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => { p = api.confirm("Delete this comment?"); });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(await p).toBe(false);
    act(() => { p = api.confirm("Delete this comment?"); });
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });   /* Escape = cancel */
    expect(await p).toBe(false);
  });
  it("prompt needs text when required, allows an empty note when not, and resolves null on cancel", async () => {
    mount();
    let p; act(() => { p = api.prompt("Reason for rejecting:", null, { confirmLabel: "Reject" }); });
    const ok = await screen.findByTestId("confirm-ok");
    expect(ok.disabled).toBe(true); expect(ok.textContent).toBe("Reject");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  too broad  " } });
    expect(ok.disabled).toBe(false);
    fireEvent.click(ok);
    expect(await p).toBe("too broad");
    act(() => { p = api.prompt("Reason for rejecting:", null, { required: false }); });
    fireEvent.click(await screen.findByTestId("confirm-ok"));
    expect(await p).toBe("");
    act(() => { p = api.prompt("Reason for rejecting:"); });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(await p).toBeNull();
  });
  it("v1.71: initial focus lands on the action, not on the close button; the text is the dialog's description", async () => {
    mount();
    act(() => { api.confirm("Delete this comment?"); });
    const dlg = await screen.findByRole("dialog");
    expect(document.activeElement).toBe(screen.getByTestId("confirm-ok"));   /* ordinary confirm → OK */
    expect(dlg.getAttribute("aria-describedby")).toBe("confirm-text"); expect(document.getElementById("confirm-text").textContent).toBe("Delete this comment?");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    act(() => { api.confirm("Delete table \"{name}\"?", { name: "t" }, { danger: true }); });
    await screen.findByRole("dialog");
    expect(document.activeElement.textContent).toBe("Cancel");   /* destructive → Cancel */
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    act(() => { api.prompt("Reason for rejecting:"); });
    await screen.findByRole("dialog");
    expect(document.activeElement.tagName).toBe("TEXTAREA");   /* prompt → the text area (React autoFocus wins) */
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });
  it("outside a provider the calls are harmless no-ops", async () => {
    let outside; const Out = () => { outside = useToast(); return null; };
    render(<Out />);
    expect(() => outside.flash("x")).not.toThrow();
    expect(await outside.confirm("x")).toBe(false); expect(await outside.prompt("x")).toBeNull();
  });
});
