/* v1.73 (F-F8) — render a component inside the three catalog contexts (data, navigation, actions) the way App.jsx
   provides them, without the whole application. Defaults: an empty catalog, an admin account, English, no-op actions
   (vi.fn(), so a test can assert calls), and navigation state with vi.fn() setters.
     renderWithCatalog(<GlossaryViewC />, { catalog: { glossary: [...] }, me, data: { … }, nav: { … }, actions: { … }, lang: "de", toast: { flash } })
   Returns RTL's render result plus { data, nav, actions } — the values that were provided. */
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { buildPerms } from "../../permissions.js";
import { makeLookups } from "../../src/lib/lookups.js";
import { DEFAULT_POLICY } from "../../src/lib/stewardship.js";
import { CatalogProviders } from "../../src/catalog-context.jsx";
import { I18nProvider } from "../../src/i18n.jsx";
import { ToastStub } from "./toast.jsx";

export const EMPTY_CATALOG = { hubs: [], people: [], domains: [], databases: [], schemas: [], tables: [], attributes: [], lineage: [], glossary: [] };
export const ADMIN = { id: "u", name: "Tester", email: "t@x.io", role: "admin", roles: ["admin"] };

/* the three context values; any key can be overridden */
export function catalogValues({ catalog = {}, me = ADMIN, data = {}, nav = {}, actions = {} } = {}) {
  const state = { ...EMPTY_CATALOG, ...catalog };
  const lazy = { on: false, loaded: new Set(), stats: null };
  const perm = buildPerms(state, me);
  const dataValue = {
    ...makeLookups(state, lazy), state, lazy, catVersion: { current: 1 }, catalogVersion: 1, me, isAdmin: perm.isAdmin, isPm: perm.isAdmin, perm,
    canEdit: perm.canEditAnything, canStructure: perm.canEditStructure, unread: 0,
    tableOptions: [], searchResults: [], knownSources: [], mpProducts: [], sourceTree: [], projectValues: [], useCaseValues: [], glossaryRefOptions: {},
    glossaryFilesTick: 0, stewardshipPolicy: DEFAULT_POLICY,
    ...data,
  };
  const navValue = {
    view: "catalog", sel: { type: "home" }, open: {}, query: "", modal: null, tableTab: "technical", linSc: "all", sFacet: { type: "", hub: "", layer: "", sensitivity: "" },
    mpPreset: null, glossaryFocus: null, railOpen: false,
    setView: vi.fn(), setSel: vi.fn(), setOpen: vi.fn(), setQuery: vi.fn(), setModal: vi.fn(), setTableTab: vi.fn(), setLinSc: vi.fn(), setSFacet: vi.fn(),
    setMpPreset: vi.fn(), setGlossaryFocus: vi.fn(), setRailOpen: vi.fn(), openRef: vi.fn(),
    ...nav,
  };
  /* any action a component calls exists: unknown keys resolve to a shared vi.fn() per key */
  const fns = { ...actions };
  const actionsValue = new Proxy(fns, { get: (o, k) => (typeof k === "string" && !(k in o) ? (o[k] = vi.fn()) : o[k]) });
  return { data: dataValue, nav: navValue, actions: actionsValue };
}

export function renderWithCatalog(ui, { lang = "en", toast, ...opts } = {}) {
  const values = catalogValues(opts);
  const tree = <CatalogProviders {...values}>{ui}</CatalogProviders>;
  const result = render(<I18nProvider initial={lang}>{toast ? <ToastStub {...toast}>{tree}</ToastStub> : tree}</I18nProvider>);
  return { ...result, ...values };
}
