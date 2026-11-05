import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
afterEach(cleanup);
import App from "../../src/App.jsx";
import { okJson as ok, appShellFetch } from "../helpers/fetch.js";

const me = { id: "u", name: "Tester", email: "t@x.io", role: "admin", roles: ["admin"], lang: "de" };
const routes = (signedIn) => async (url) => {
  const u = String(url);
  if (u.includes("/auth/bootstrap-needed")) return ok({ needed: false });
  if (u.includes("/auth/me/lang")) return ok({ lang: "de" });
  if (u.includes("/auth/me")) return signedIn ? ok({ user: me }) : { ok: false, status: 401, json: async () => ({}), headers: { get: () => null } };
  if (u.includes("/auth/sso/config")) return ok({ enabled: true, buttonLabel: "Sign in with Microsoft" });
  if (u.includes("/api/catalog")) return ok({ catalog: { hubs: [{ id: "h", name: "Health" }], databases: [], schemas: [], tables: [], attributes: [], domains: [], people: [], lineage: [], glossary: [] }, version: 1, lazy: false });
  return ok({ requests: [], messages: [], unread: 0, users: [], invites: [], entries: [], toAct: [], initiated: [], tasks: [], personIds: [], keys: [] });
};

describe("App root", () => {
  beforeEach(() => { localStorage.clear(); });
  it("renders the sign-in screen (with the Entra button and language selector) when signed out", async () => {
    globalThis.fetch = vi.fn(routes(false));
    render(<App />);
    expect(await screen.findByText("Sign in with Microsoft")).toBeTruthy();
  });
  it("renders the catalog shell when signed in and applies the account language", async () => {
    globalThis.fetch = vi.fn(routes(true));
    render(<App />);
    expect(await screen.findByText("Mein Dashboard")).toBeTruthy();   // German label after the account language was applied
  });
});

describe("App root — opening a table", () => {
  it("renders the table page after selecting a table in the tree", { timeout: 30000 }, async () => {
    const cat = { hubs: [{ id: "h", name: "Health" }], databases: [{ id: "d", name: "GOLD", hubId: "h", layer: "gold", country: "DE" }], schemas: [{ id: "s", databaseId: "d", name: "partners" }],
      tables: [{ id: "t1", schemaId: "s", name: "loss_ratio", description: "x" }], attributes: [{ id: "a1", tableId: "t1", name: "lr", dataType: "INT" }], domains: [], people: [], lineage: [], glossary: [] };
    const me = { id: "u", name: "Tester", email: "t@x.io", role: "admin", roles: ["admin"] };
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("/auth/bootstrap-needed")) return ok({ needed: false });
      if (u.includes("/auth/me")) return ok({ user: me });
      if (u.includes("/api/catalog")) return ok({ catalog: cat, version: 1, lazy: false });
      return ok({ requests: [], messages: [], unread: 0, users: [], invites: [], entries: [], toAct: [], initiated: [], tasks: [], personIds: [], keys: [], enabled: false });
    });
    localStorage.clear();                                                  // English UI for the assertions below
    render(<App />);
    await screen.findAllByText("Health", {}, { timeout: 15000 });
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(screen.getAllByPlaceholderText(/Search|suchen/i)[0], { target: { value: "loss_ratio" } });
    const hits = await screen.findAllByText(/loss_ratio/, {}, { timeout: 15000 });
    fireEvent.click(hits[hits.length - 1].closest("div"));                 // open the table from the search result
    expect(await screen.findByText(/Request business descriptions|Fachliche Beschreibungen anfordern/, {}, { timeout: 15000 })).toBeTruthy();   /* generous: CI runners are slow (v1.67.4) */
    expect(screen.getByText("lr")).toBeTruthy();                           // attribute row rendered
    /* breadcrumb: data hub level is navigable and opens the data hub page with its databases */
    fireEvent.click(screen.getAllByText("DE").find((e) => e.closest(".crumb")));
    expect(await screen.findByText(/New database/, {}, { timeout: 15000 })).toBeTruthy();
    expect(screen.getAllByText("GOLD").length).toBeGreaterThan(0);
  });
});

describe("App root — migration stays on the server (v1.66)", () => {
  it("adopts the server document without posting a migration delta", async () => {
    const oldCat = { hubs: [{ id: "h", name: "Health", ownerId: "owen" }], databases: [{ id: "d", name: "GOLD", hubId: "h", country: "DE" }], schemas: [], tables: [], attributes: [], domains: [], people: [{ id: "owen", name: "Owen", email: "o@x.io" }], lineage: [], glossary: [] };
    const me = { id: "u", name: "Tester", email: "t@x.io", role: "admin", roles: ["admin"] };
    const patches = [];
    globalThis.fetch = appShellFetch({ me, catalog: oldCat, onPatch: (p) => patches.push(p) });
    vi.useFakeTimers({ shouldAdvanceTime: true });                  /* v1.72: the 600 ms save debounce is fast-forwarded, not slept */
    try {
      render(<App />);
      await screen.findAllByText("Health");
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    } finally { vi.useRealTimers(); }
    const hubChange = patches.flatMap((p) => p.changes).find((c) => c.entityType === "hub" && c.id === "h");
    expect(hubChange, "no migration delta from the browser").toBeUndefined();
  });
});

describe("App root — translated dialogs and dashboard", () => {
  it("renders My Dashboard in German when the account language is German", async () => {
    const me = { id: "u", name: "Tester", email: "t@x.io", role: "admin", roles: ["admin"], lang: "de" };
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("/auth/bootstrap-needed")) return ok({ needed: false });
      if (u.includes("/auth/me/lang")) return ok({ lang: "de" });
      if (u.includes("/auth/me")) return ok({ user: me });
      if (u.includes("/api/catalog")) return ok({ catalog: { hubs: [{ id: "h", name: "Health" }], databases: [], schemas: [], tables: [], attributes: [], domains: [], people: [], lineage: [], glossary: [] }, version: 1, lazy: false });
      if (u.includes("/api/me/dashboard")) return ok({ toAct: [], initiated: [], tasks: [], personIds: [] });
      return ok({ requests: [], messages: [], unread: 0, users: [], invites: [], entries: [], keys: [], enabled: false });
    });
    render(<App />);
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(await screen.findByText("Mein Dashboard"));
    expect(await screen.findByText(/Was auf dich wartet/)).toBeTruthy();                       // page intro translated
    expect(await screen.findByText(/Nichts offen — alle Freigaben/)).toBeTruthy();             // empty state translated
  });
});

describe("Help modal — languages and chapters (v1.62)", () => {
  it("renders the German help with chapters, the role guide preselected from the account roles and the admin chapter", async () => {
    const { HelpModalC } = await import("../../src/components/help.jsx");
    const { I18nProvider } = await import("../../src/i18n.jsx");
    render(<I18nProvider initial="de"><HelpModalC isAdmin roles={["admin", "steward"]} onClose={() => {}} /></I18nProvider>);
    expect(screen.getByText("Hilfe — Funktionsübersicht")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 4, name: "Erste Schritte" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Anleitungen nach Rolle/ }));
    expect(screen.getByRole("tab", { name: "Admin", selected: true })).toBeTruthy();
    expect(screen.getByText(/Die Struktur aufbauen/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Data Steward" }));
    expect(screen.getByText(/Eine Tabelle beschreiben/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Administration/ }));
    expect(screen.getByText("Admin-Menü (nur Admins)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /KI-Agenten & MCP/ }));
    expect(screen.getByText("MCP-Server für KI-Agenten")).toBeTruthy();
  });
  it("hides the admin chapter for non-admins, defaults to the guest guide, searches across chapters, renders Polish and Spanish", async () => {
    const { HelpModalC } = await import("../../src/components/help.jsx");
    const { I18nProvider } = await import("../../src/i18n.jsx");
    const { unmount } = render(<I18nProvider initial="pl"><HelpModalC isAdmin={false} roles={["guest"]} onClose={() => {}} /></I18nProvider>);
    expect(screen.getByText("Pomoc — przewodnik po funkcjach")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Administracja/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Przewodniki według roli/ }));
    expect(screen.getByRole("tab", { name: "Gość", selected: true })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Przeszukaj pomoc…"), { target: { value: "lineage" } });
    expect(screen.getByText(/Wyniki wyszukiwania/)).toBeTruthy();
    expect(screen.getAllByText("Lineage danych").length).toBeGreaterThan(0);
    unmount();
    render(<I18nProvider initial="es"><HelpModalC isAdmin onClose={() => {}} /></I18nProvider>);
    expect(screen.getByText("Ayuda — guía de funciones")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 4, name: "Primeros pasos" })).toBeTruthy();
  });
});
