import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { AuthGateC } from "../../src/components/auth.jsx";
import { GroupMappingC, EntraSettingsC } from "../../src/components/admin-agents-sso.jsx";
import { SyncProfilesC } from "../../src/components/sync-profiles.jsx";
import { I18nProvider } from "../../src/i18n.jsx";
import { ToastStub } from "../helpers/toast.jsx";
import { renderWithCatalog } from "../helpers/catalog.jsx";
import { routeFetch } from "../helpers/fetch.js";

afterEach(cleanup);
const calls = [];
const mockFetch = (routes) => routeFetch(routes, () => ({}), { calls });

/* v1.73: the catalog contexts come from renderWithCatalog() (test/helpers/catalog.jsx) */
const HUBS = { catalog: { hubs: [{ id: "h1", name: "Health" }, { id: "central", name: "Central" }] } };

describe("sign-in screen: SSO enforcement and header mode", () => {
  it("hides the password form when SSO is enforced and offers break-glass sign-in", async () => {
    globalThis.fetch = mockFetch([[/\/auth\/sso\/config/, () => ({ enabled: true, enforce: true, buttonLabel: "Sign in with Microsoft", mode: "local" })]]);
    render(<I18nProvider><AuthGateC screen={{ mode: "login" }} onAuthed={() => {}} /></I18nProvider>);
    expect(await screen.findByText("Sign in with Microsoft")).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Break-glass sign-in" }));
    expect(await screen.findByLabelText("Password")).toBeTruthy();
    expect(screen.getByLabelText("E-mail")).toBeTruthy();
  });
  it("shows the identity-provider notice in header mode instead of a form", async () => {
    globalThis.fetch = mockFetch([[/\/auth\/identity/, () => ({ mode: "header", headers: { email: "x-forwarded-email" }, error: "nobody@x is in no group that grants access to the catalog" })], [/\/auth\/sso\/config/, () => ({ enabled: false, mode: "header" })]]);
    render(<I18nProvider><AuthGateC screen={{ mode: "header" }} onAuthed={() => {}} /></I18nProvider>);
    expect(await screen.findByText("Sign-in is handled by your identity provider")).toBeTruthy();
    expect(await screen.findByText(/no group that grants access/)).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.queryByRole("button", { name: /Sign in$/ })).toBeNull();
  });
});

describe("admin: group → role mapping and SSO enforcement controls", () => {
  it("edits rules, toggles roles and saves the mapping", async () => {
    calls.length = 0;
    globalThis.fetch = mockFetch([
      [/\/admin\/sso\/groups/, (u, o) => (o.method === "PUT" ? { mapping: JSON.parse(o.body) } : { mapping: { rules: [{ group: "DATA-STEWARDS", roles: ["steward"] }], syncRoles: false, unmatched: "default" }, identity: { mode: "header", headers: { email: "x-forwarded-email", groups: "x-forwarded-groups", groupsFrom: "databricks", secretRequired: true } }, roles: ["admin", "steward", "guest", "pm", "ingestion", "ba", "dpd"] })],
    ]);
    const flash = vi.fn();
    render(<I18nProvider><ToastStub flash={flash}><GroupMappingC /></ToastStub></I18nProvider>);
    expect(await screen.findByDisplayValue("DATA-STEWARDS")).toBeTruthy();
    expect(screen.getByText(/shared secret required/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    const inputs = screen.getAllByLabelText(/^Group \d/); expect(inputs).toHaveLength(2);
    fireEvent.change(inputs[1], { target: { value: "PMO" } });
    const row = inputs[1].closest(".role-row");
    fireEvent.click(within(row).getByLabelText("Project Manager"));
    fireEvent.click(within(row).getByLabelText("Guest"));
    fireEvent.click(screen.getByLabelText("Roles follow groups on every sign-in"));
    fireEvent.change(screen.getByLabelText("Users in no mapped group"), { target: { value: "deny" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(flash).toHaveBeenCalledWith("Group mapping saved"));
    const put = calls.find(([u, m]) => u.includes("/admin/sso/groups") && m === "PUT")[2];
    expect(put.rules).toEqual([{ group: "DATA-STEWARDS", roles: ["steward"] }, { group: "PMO", roles: ["pm"] }]);
    expect(put.syncRoles).toBe(true); expect(put.unmatched).toBe("deny");
  });
  it("offers SSO enforcement with break-glass accounts in the Entra panel", async () => {
    calls.length = 0;
    globalThis.fetch = mockFetch([[/\/admin\/sso$/, (u, o) => (o.method === "PUT" ? { ok: true, enabled: true, enforce: true } : { enabled: true, tenantId: "t", clientId: "c", clientSecret: "", hasSecret: true, autoProvision: false, defaultRoles: ["guest"], buttonLabel: "Sign in with Microsoft", enforce: false, breakGlass: [], redirectUri: "https://x/auth/sso/callback" })]]);
    render(<I18nProvider><EntraSettingsC /></I18nProvider>);
    const enforce = await screen.findByLabelText("Enforce SSO");
    fireEvent.change(enforce, { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/Break-glass accounts/), { target: { value: "boss@x.de, ops@x.de" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(calls.some(([u, m]) => u.endsWith("/admin/sso") && m === "PUT")).toBe(true));
    const body = calls.find(([u, m]) => u.endsWith("/admin/sso") && m === "PUT")[2];
    expect(body.enforce).toBe(true); expect(body.breakGlass).toBe("boss@x.de, ops@x.de");
  });
});

describe("scheduled Unity Catalog sync panel", () => {
  it("lists profiles with their last run, creates one and runs it", async () => {
    calls.length = 0;
    const profiles = [{ id: "p1", name: "Nightly main", host: "adb-1.azuredatabricks.net", catalog: "main", hubId: "h1", country: "DE", layer: "silver", mode: "apply", schedule: "daily", time: "03:00", deleteMissing: false, lineage: false, updateTypes: true, enabled: true,
      auth: { type: "pat", token: "••••••••", hasToken: true, clientId: "", clientSecret: "", hasSecret: false }, lastRun: { at: Date.now(), ms: 1200, ok: true, total: 3, applied: 3, notified: 1, counts: { newTables: 1, newColumns: 2 }, samples: { newTables: ["sales.returns"], newColumns: ["sales.returns.id", "sales.orders.status"], removedTables: [], removedColumns: [], changedTypes: [] } } }];
    globalThis.fetch = mockFetch([
      [/\/admin\/sync\/profiles\/p1\/run/, () => ({ result: { ok: true, total: 0, applied: 0 } })],
      [/\/admin\/sync\/profiles$/, (u, o) => (o.method === "PUT" ? { profile: { ...JSON.parse(o.body), id: "p2" } } : { profiles, due: ["p1"], scheduler: "internal", appIdentity: false })],
    ]);
    const flash = vi.fn();
    renderWithCatalog(<SyncProfilesC />, { ...HUBS, toast: { flash } });
    expect(await screen.findByText("Nightly main")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy(); expect(screen.getByText("apply")).toBeTruthy(); expect(screen.getByText("due")).toBeTruthy();
    expect(screen.getByText(/3 difference\(s\), 3 change\(s\) applied, 1 notified/)).toBeTruthy();
    fireEvent.click(screen.getByText("Details"));
    expect(screen.getByText(/newTables: sales\.returns/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Run now/ }));
    await waitFor(() => expect(flash).toHaveBeenCalledWith("Nightly main: 0 difference(s)"));
    fireEvent.click(screen.getByRole("button", { name: /New sync profile/ }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Hourly finance" } });
    fireEvent.change(screen.getByLabelText("Unity Catalog catalog"), { target: { value: "finance" } });
    fireEvent.change(screen.getByLabelText("Workspace host"), { target: { value: "adb-2.azuredatabricks.net" } });
    fireEvent.change(screen.getByLabelText("Personal access token"), { target: { value: "dapi123" } });
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "apply" } });
    fireEvent.change(screen.getByLabelText("Schedule"), { target: { value: "hourly" } });
    fireEvent.click(screen.getByLabelText(/Delete tables and columns/));
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(flash).toHaveBeenCalledWith("Sync profile saved"));
    const put = calls.find(([u, m]) => u.endsWith("/admin/sync/profiles") && m === "PUT")[2];
    expect(put).toMatchObject({ name: "Hourly finance", catalog: "finance", host: "adb-2.azuredatabricks.net", mode: "apply", schedule: "hourly", deleteMissing: true, auth: { type: "pat", token: "dapi123" } });
  });
});

describe("sync profile write-back (v1.64)", () => {
  it("shows the write-back settings in the form, previews and writes through the profile endpoints", async () => {
    calls.length = 0;
    const profiles = [{ id: "p1", name: "Nightly main", host: "adb-1.azuredatabricks.net", catalog: "main", hubId: "h1", country: "DE", layer: "silver", mode: "apply", schedule: "manual", time: "03:00", deleteMissing: false, lineage: false, updateTypes: true, enabled: true,
      auth: { type: "pat", token: "••••••••", hasToken: true, clientId: "", clientSecret: "", hasSecret: false }, lastRun: null,
      warehouseId: "wh1", importTags: true, writeBack: { enabled: true, comments: true, roles: true, columns: false, owner: false }, lastWriteBack: { at: Date.now(), ok: true, written: 4, failed: 0, total: 4, tagsReadable: true } }];
    globalThis.fetch = mockFetch([
      /* v1.77: the admin panel opens the preview-first dialog, which talks to /api/writeback (own changes only) */
      [/\/api\/writeback\/targets/, () => ({ targets: [{ id: "p1", name: "Nightly main", catalog: "main", host: "adb-1.azuredatabricks.net", lastWriteBack: null }] })],
      [/\/api\/writeback\/p1\/preview/, () => ({ result: { ok: true, dryRun: true, scope: "mine", total: 2, written: 0, failed: 0, skipped: 0, tagsReadable: true, pending: { mine: 2, unattributed: 0, others: [{ id: "u9", name: "Jonas Klein", count: 1 }], writable: 2 }, log: [{ ok: true, label: "Catalog main — description", planned: true, mine: true, author: { id: "me", name: "Tester", ts: 1 } }, { ok: true, label: "Table main.sales.orders — tag Data Steward", planned: true, mine: true, author: { id: "me", name: "Tester", ts: 2 } }, { ok: true, label: "Schema main.sales — description", planned: true, mine: false, author: { id: "u9", name: "Jonas Klein", ts: 3 } }] } })],
      [/\/api\/writeback\/p1\/run/, () => ({ result: { ok: true, dryRun: false, scope: "mine", total: 2, written: 2, failed: 0, tagsReadable: true, log: [{ ok: true, label: "Catalog main — description" }, { ok: true, label: "Table main.sales.orders — tag Data Steward" }] } })],
      [/\/admin\/sync\/profiles$/, (u, o) => (o.method === "PUT" ? { profile: { ...profiles[0], ...JSON.parse(o.body) } } : { profiles, due: [], scheduler: "internal", appIdentity: false })],
    ]);
    const flash = vi.fn();
    renderWithCatalog(<SyncProfilesC />, { ...HUBS, toast: { flash } });
    expect(await screen.findByText("write-back")).toBeTruthy();
    expect(screen.getByText(/Last write-back/)).toBeTruthy(); expect(screen.getByText(/4 change\(s\) written to Unity Catalog/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Write back Nightly main" }));
    expect(await screen.findByRole("dialog", { name: "Write back to Unity Catalog" })).toBeTruthy();
    expect(await screen.findByText(/Table main\.sales\.orders — tag Data Steward/)).toBeTruthy();   /* the preview came first */
    expect(screen.getByTestId("wb-others").textContent).toMatch(/Jonas Klein.*1 change/);
    expect(calls.some(([u]) => u.includes("/api/writeback/p1/run"))).toBe(false);
    fireEvent.click(screen.getByTestId("wb-run"));
    await waitFor(() => expect(flash).toHaveBeenCalledWith("{n} change(s) written to Unity Catalog", { n: 2, f: 0 }));
    expect(calls.some(([u, m]) => u.endsWith("/api/writeback/p1/run") && m === "POST")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    /* the form carries the write-back block */
    fireEvent.click(screen.getByRole("button", { name: "Edit Nightly main" }));
    const enabled = await screen.findByLabelText("Write catalog metadata back to Unity Catalog after each run");
    expect(enabled.checked).toBe(true);
    expect(screen.getByLabelText(/^SQL warehouse ID/).value).toBe("wh1");   /* v1.66: one warehouse per profile (import tags + write-back) */
    expect(screen.getByLabelText("Column comments and tags").checked).toBe(false);
    fireEvent.click(screen.getByLabelText("Column comments and tags"));
    fireEvent.change(screen.getByLabelText(/^SQL warehouse ID/), { target: { value: "wh2" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(flash).toHaveBeenCalledWith("Sync profile saved"));
    const put = calls.find(([u, m]) => u.endsWith("/admin/sync/profiles") && m === "PUT")[2];
    expect(put.writeBack).toMatchObject({ enabled: true, columns: true }); expect(put.warehouseId).toBe("wh2"); expect(put.importTags).toBe(true);
  });
});
