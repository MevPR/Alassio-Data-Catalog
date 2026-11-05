import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import App from "../../src/App.jsx";
import { BackupsViewC } from "../../src/components/backups.jsx";
import { ToastStub } from "../helpers/toast.jsx";
import { okJson as ok } from "../helpers/fetch.js";

afterEach(cleanup);

const now = Date.now();
const cat = {
  hubs: [{ id: "h", name: "Health", dataHubs: [{ name: "DE", bpoId: "p1" }] }],
  databases: [{ id: "d", name: "GOLD", hubId: "h", layer: "gold", country: "DE", domainId: "dm", ownerId: "p1" }],
  schemas: [{ id: "s", databaseId: "d", name: "partners" }],
  tables: [{ id: "t1", schemaId: "s", name: "loss_ratio", description: "Loss ratio", ownerId: "p1", stewardId: "p2", reviewCycleDays: 90, lastReviewedAt: now - 100 * 86400000, certStatus: "deprecated", certifiedBy: "Anna", certifiedAt: now, certNote: "old model", successorId: "t2" },
    { id: "t2", schemaId: "s", name: "loss_ratio_v2", certStatus: "endorsed", certifiedBy: "Anna", certifiedAt: now }],
  attributes: [], domains: [{ id: "dm", name: "Claims", ownerId: "p1" }], people: [{ id: "p1", name: "Tester", email: "t@x.io" }, { id: "p2", name: "Ben", email: "" }], lineage: [], glossary: [],
};
const me = { id: "u", name: "Tester", email: "t@x.io", role: "admin", roles: ["admin"] };
const patches = [];
const mockFetch = () => vi.fn(async (url, opts = {}) => {
  const u = String(url);
  if (u.includes("/auth/bootstrap-needed")) return ok({ needed: false });
  if (u.includes("/auth/me")) return ok({ user: me });
  if (u.includes("/api/catalog") && opts.method === "PATCH") { patches.push(JSON.parse(opts.body)); return ok({ ok: true, version: 2, applied: 1 }); }
  if (u.includes("/api/catalog")) return ok({ catalog: cat, version: 1, lazy: false });
  if (u.includes("/api/stewardship/policy")) return ok({ policy: { attestDays: 180, remindEveryDays: 7, soonDays: 14 } });
  return ok({ requests: [], messages: [], unread: 0, users: [], invites: [], entries: [], toAct: [], initiated: [], tasks: [], personIds: ["p1"], keys: [], enabled: false, files: [] });
});

describe("stewardship UI", () => {
  it("shows badges, the stewardship panel and lets the responsible person endorse / review / attest", async () => {
    globalThis.fetch = mockFetch(); localStorage.clear(); patches.length = 0;
    render(<App />);
    await screen.findAllByText("Health");
    /* dashboard lists the overdue review and the attestations of the signed-in owner */
    fireEvent.click(screen.getByRole("button", { name: /My Dashboard/ }));
    expect(await screen.findByText("Stewardship tasks")).toBeTruthy();
    expect(screen.getByText("Review overdue")).toBeTruthy();
    expect(screen.getAllByText(/Ownership never confirmed/).length).toBeGreaterThanOrEqual(3);   /* table, database, domain */
    fireEvent.click(screen.getAllByRole("button", { name: /^Confirm ownership$/ })[0]);   /* v1.74: the row itself is a button now (keyboard access) — pick the inner one */
    await waitFor(() => expect(patches.length).toBe(1));
    const upd = (i) => patches[i].changes.find((c) => c.action === "updated");
    expect(upd(0).after.ownerAttestedBy).toBe("Tester");
    /* table view: deprecated notice with successor, governance tab with the panel */
    /* the dashboard review row opens the table's Governance tab directly */
    fireEvent.click(screen.getByText("Review overdue").closest(".role-row"));
    expect(await screen.findByText(/This table is deprecated/)).toBeTruthy();
    expect(screen.getAllByText("Deprecated").length).toBeGreaterThan(0);
    expect(await screen.findByText("Stewardship")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Mark as reviewed/ }));
    await waitFor(() => expect(patches.length).toBe(2));
    expect(upd(1).after).toMatchObject({ id: "t1", lastReviewedBy: "Tester" });
    fireEvent.click(screen.getByRole("button", { name: /^Endorse/ }));
    await waitFor(() => expect(patches.length).toBe(3));
    expect(upd(2).after).toMatchObject({ certStatus: "endorsed", certifiedBy: "Tester" });
    expect(upd(2).after.successorId).toBeUndefined();
  });
});

describe("Backups & jobs view", () => {
  it("renders settings, backups with verification details and the job history; verify calls the API", async () => {
    const backup = { id: "b1", createdAt: now, kind: "auto", fileName: "cortex-backup-20260930-021500.json.gz", sqlFile: "cortex-backup-20260930-021500.sql.gz", size: 2048, sqlSize: 4096, catalogVersion: 42, counts: { tables: 12, attributes: 340 }, by: "system",
      verifiedAt: now, verify: { ok: true, checks: [{ name: "format", ok: true, detail: "dump v3" }, { name: "integrity", ok: true, detail: "fine" }], counts: { tables: 12 }, live: { tables: 12 }, drift: {} } };
    const calls = [];
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      calls.push([String(url), opts.method || "GET"]);
      if (String(url).endsWith("/verify")) return ok({ backup: { ...backup, verify: { ...backup.verify, ok: false, checks: [{ name: "file", ok: false, detail: "missing" }] } } });
      if (String(url).startsWith("/admin/backups")) return ok({ settings: { enabled: true, time: "02:15", keep: 14, sql: true }, backups: [backup], dir: "/opt/datahub-catalog/backups", mysqldump: true });
      return ok({ jobs: [{ id: "j1", kind: "csv", status: "interrupted", phase: "interrupted", fileName: "big.csv", startedTs: now - 60000, finishedTs: now, by: "a@x", error: "the service was restarted while this job was running" }, { id: "j2", kind: "dump", status: "done", phase: "done", fileName: "d.json", startedTs: now - 5000, finishedTs: now, by: "a@x", counts: { created: 3, total: 3 } }] });
    });
    const flash = vi.fn();
    render(<ToastStub flash={flash}><BackupsViewC onRestoreJob={() => {}} /></ToastStub>);
    expect(await screen.findByText(/cortex-backup-20260930-021500\.json\.gz/)).toBeTruthy();
    expect(screen.getByDisplayValue("02:15")).toBeTruthy();
    expect(screen.getByText(/12 tables, 340 attributes/)).toBeTruthy();
    expect(screen.getByText("interrupted")).toBeTruthy();
    expect(screen.getByText(/service was restarted/)).toBeTruthy();
    expect(screen.getByText("3 created")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /passed/ }));
    expect(screen.getByText("dump v3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Verify/ }));
    await waitFor(() => expect(calls.some(([u, m]) => u === "/admin/backups/b1/verify" && m === "POST")).toBe(true));
    await waitFor(() => expect(flash).toHaveBeenCalledWith(expect.stringMatching(/Restore drill FAILED/)));
  });
});
