/* v1.66 — the Unity Catalog import dialog talks to the server only: profiles, catalog list, job start */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n.jsx";
import { UnityModalC } from "../../src/components/source-import.jsx";
import { okJson as ok } from "../helpers/fetch.js";

afterEach(cleanup);

describe("UnityModalC (server-side import)", () => {
  it("lists sync profiles, fetches the catalogs through the server and starts the import job", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      const u = String(url); calls.push([u, opts.method || "GET", opts.body ? JSON.parse(opts.body) : null]);
      if (u === "/admin/sync/profiles") return ok({ profiles: [{ id: "p1", name: "Nightly", host: "adb-1.net", catalog: "main", hubId: "h1", country: "DE", layer: "gold", lineage: true, importTags: true, auth: { type: "sp" } }] });
      if (u === "/api/import/unity/catalogs") return ok({ catalogs: [{ name: "main", comment: "prod" }, { name: "dev", comment: "" }] });
      if (u === "/api/import/unity") return ok({ job: { id: "j1", kind: "unity", status: "running", phase: "fetching" } });
      return ok({});
    });
    const onStarted = vi.fn();
    render(<I18nProvider initial="en"><UnityModalC hubs={[{ id: "h1", name: "Health" }, { id: "central", name: "Central" }]} onClose={() => {}} onStarted={onStarted} /></I18nProvider>);
    /* one-off connection: workspace + PAT */
    fireEvent.change(screen.getByLabelText("Workspace URL"), { target: { value: "https://adb-9.azuredatabricks.net/" } });
    fireEvent.change(screen.getByLabelText("Personal access token"), { target: { value: "dapi123" } });
    fireEvent.change(screen.getByLabelText(/^SQL warehouse ID \(optional — imports/), { target: { value: "wh1" } });
    fireEvent.change(screen.getByLabelText(/Save as sync profile/), { target: { value: "Kept" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText(/Connected — 2 catalogs found/)).toBeTruthy();
    const listCall = calls.find(([u]) => u === "/api/import/unity/catalogs")[2];
    expect(listCall).toEqual({ host: "https://adb-9.azuredatabricks.net/", auth: { type: "pat", token: "dapi123" }, warehouseId: "wh1" });
    fireEvent.click(screen.getByRole("button", { name: /main/ }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    const startCall = calls.find(([u]) => u === "/api/import/unity")[2];
    expect(startCall).toMatchObject({ catalog: "main", hubId: "central", country: "GLOBAL", lineage: true, importTags: true, saveProfile: { name: "Kept" }, auth: { type: "pat" } });
    expect(onStarted.mock.calls[0][0].id).toBe("j1"); expect(onStarted.mock.calls[0][1]).toBe("main");
    expect(screen.queryByText(/dapi123/)).toBeNull();
  });
  it("a chosen sync profile hides the credential fields and sends only the profile id", async () => {
    globalThis.fetch = vi.fn(async (url) => String(url) === "/admin/sync/profiles"
      ? ok({ profiles: [{ id: "p1", name: "Nightly", host: "adb-1.net", catalog: "main", hubId: "central", country: "DE", layer: "gold", lineage: false, importTags: false, auth: { type: "sp" } }] })
      : ok({ catalogs: [{ name: "main" }] }));
    render(<I18nProvider initial="de"><UnityModalC hubs={[{ id: "central", name: "Central" }]} onClose={() => {}} onStarted={() => {}} /></I18nProvider>);
    const sel = await screen.findByLabelText("Sync-Profil");
    fireEvent.change(sel, { target: { value: "p1" } });
    expect(screen.queryByLabelText("Workspace-URL")).toBeNull();
    expect(screen.getByLabelText(/Governance-Tags importieren/).checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Verbinden" }));
    await waitFor(() => expect(globalThis.fetch.mock.calls.some(([u, o]) => String(u) === "/api/import/unity/catalogs" && JSON.parse(o.body).profileId === "p1" && !JSON.parse(o.body).host)).toBe(true));
  });
});
