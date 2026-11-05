/* v1.77 — the preview-first write-back dialog: loads the targets, previews on the server, shows the caller's own
   changes and the other users' counts, writes only after the click, and never calls run on its own. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "../../src/i18n.jsx";
import { WriteBackModalC } from "../../src/components/writeback.jsx";
import { ToastStub } from "../helpers/toast.jsx";
import { routeFetch } from "../helpers/fetch.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const preview = { ok: true, dryRun: true, scope: "mine", total: 2, skipped: 1, tagsReadable: true,
  pending: { mine: 2, unattributed: 1, others: [{ id: "u2", name: "Jonas Klein", count: 3 }], writable: 2 },
  log: [
    { ok: true, planned: true, label: "Table main.claims.fact_claims — description", mine: true, author: { id: "u1", name: "Anna", ts: 1 } },
    { ok: true, planned: true, label: "Column main.claims.fact_claims.claim_id — tag Sensitivity", mine: true, author: { id: "u1", name: "Anna", ts: 2 } },
    { ok: true, planned: true, label: "Catalog main — description", mine: false, author: { id: "u2", name: "Jonas Klein", ts: 3 } },
    { ok: true, planned: true, label: "Catalog main — property data_hub", mine: false, author: null },
  ] };
const mount = (routes, props = {}, lang = "en") => {
  const calls = [];
  vi.stubGlobal("fetch", routeFetch([
    [/\/api\/writeback\/targets/, () => ({ targets: [{ id: "p1", name: "Main", catalog: "main", host: "adb-1.azuredatabricks.net", lastWriteBack: null }, { id: "p2", name: "Finance", catalog: "fin", host: "", lastWriteBack: { at: 1, ok: true, written: 3 } }] })],
    ...routes,
  ], () => ({}), { calls }));
  render(<I18nProvider initial={lang}><ToastStub><WriteBackModalC onClose={() => {}} {...props} /></ToastStub></I18nProvider>);
  return calls;
};

describe("WriteBackModalC", () => {
  it("previews the selected target, lists own changes, the other users' counts and writes only on click", async () => {
    const calls = mount([
      [/\/api\/writeback\/p1\/preview/, () => ({ result: preview })],
      [/\/api\/writeback\/p1\/run/, () => ({ result: { ok: true, dryRun: false, total: 2, written: 2, failed: 0, log: [] } })],
    ]);
    expect(await screen.findByText(/Table main\.claims\.fact_claims — description/)).toBeTruthy();
    expect(screen.getByRole("combobox").value).toBe("p1");   /* two targets → a select, the first preselected */
    expect(screen.getByTestId("wb-mine").textContent).not.toMatch(/Catalog main — description/);   /* Jonas' change is not in my list */
    expect(screen.getByTestId("wb-others").textContent).toMatch(/Jonas Klein.*3 changes/);
    expect(screen.getByTestId("wb-others").textContent).toMatch(/Without recorded author \(an administrator writes these\).*1 change/);
    expect(screen.getByText(/1 skipped \(no SQL warehouse\)/)).toBeTruthy();
    expect(calls.some(([u]) => u.includes("/run"))).toBe(false);
    const btn = screen.getByTestId("wb-run");
    expect(btn.textContent).toMatch(/Write 2 changes back/); expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(await screen.findByText(/2 \/ 2 change\(s\) written to Unity Catalog/)).toBeTruthy();
    expect(calls.filter(([u, m]) => u.includes("/api/writeback/p1/run") && m === "POST")).toHaveLength(1);
  });
  it("admins see the unattributed changes in their own list; nothing to write disables the button", async () => {
    const adminPreview = { ...preview, pending: { mine: 0, unattributed: 1, others: [{ id: "u2", name: "Jonas Klein", count: 3 }], writable: 1 },
      log: [{ ok: true, planned: true, label: "Catalog main — property data_hub", mine: true, author: null }, { ok: true, planned: true, label: "Catalog main — description", mine: false, author: { id: "u2", name: "Jonas Klein", ts: 3 } }] };
    mount([[/\/api\/writeback\/p1\/preview/, () => ({ result: adminPreview })]], { isAdmin: true });
    expect(await screen.findByText("Your changes and changes without a recorded author")).toBeTruthy();
    expect(screen.getByTestId("wb-mine").textContent).toMatch(/property data_hub.*no recorded author/);
    expect(screen.getByTestId("wb-others").textContent).not.toMatch(/Without recorded author/);
    expect(screen.getByTestId("wb-run").textContent).toMatch(/Write 1 change back/);
  });
  it("nothing of mine → explains and keeps the button disabled; a fixed profile is preselected", async () => {
    mount([[/\/api\/writeback\/p2\/preview/, () => ({ result: { ...preview, pending: { mine: 0, unattributed: 0, others: [{ id: "u2", name: "Jonas Klein", count: 1 }], writable: 0 }, log: [{ ok: true, planned: true, label: "Catalog fin — description", mine: false, author: { id: "u2", name: "Jonas Klein", ts: 1 } }] } })]], { profileId: "p2" }, "de");
    expect(await screen.findByText("Nichts zu schreiben — keine der offenen Abweichungen stammt von dir.")).toBeTruthy();
    expect(screen.getByTestId("wb-run").disabled).toBe(true);
    expect(screen.getByText(/Letztes Write-back|Last write-back/)).toBeTruthy();
    expect(screen.getByRole("combobox").value).toBe("p2");   /* the fixed profile is preselected, switching stays possible */
  });
  it("no targets → points to the admin setup", async () => {
    vi.stubGlobal("fetch", routeFetch([[/\/api\/writeback\/targets/, () => ({ targets: [] })]]));
    render(<I18nProvider initial="en"><ToastStub><WriteBackModalC onClose={() => {}} /></ToastStub></I18nProvider>);
    expect(await screen.findByText(/No Unity Catalog connection is set up yet/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("wb-run")).toBeNull());
  });
});
