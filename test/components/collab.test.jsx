import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import App from "../../src/App.jsx";
import { ConnectedAppsC } from "../../src/components/connected-apps.jsx";
import { I18nProvider } from "../../src/i18n.jsx";
import { ToastStub } from "../helpers/toast.jsx";
import { _resetUsageForTests } from "../../src/lib/usage.js";
import { okJson as ok } from "../helpers/fetch.js";

afterEach(cleanup);

const now = Date.now();
const cat = {
  hubs: [{ id: "h", name: "Health", dataHubs: [{ name: "DE", bpoId: "p1" }] }],
  databases: [{ id: "d", name: "GOLD", hubId: "h", layer: "gold", country: "DE", domainId: "dm", ownerId: "p1" }],
  schemas: [{ id: "s", databaseId: "d", name: "partners" }],
  tables: [{ id: "t1", schemaId: "s", name: "loss_ratio", description: "Loss ratio", stewardId: "p2" }],
  attributes: [], domains: [{ id: "dm", name: "Claims", ownerId: "p1" }], people: [{ id: "p1", name: "Tester", email: "t@x.io" }, { id: "p2", name: "Ben", email: "" }], lineage: [], glossary: [],
};
const me = { id: "u", name: "Tester", email: "t@x.io", role: "admin", roles: ["admin"] };
const state = { comments: [], rating: { avg: null, count: 0, mine: null }, usage: { views30: 3, views90: 5, viewers90: 2, exports: 1, lastViewedAt: now } };
const calls = [];
const mockFetch = () => vi.fn(async (url, opts = {}) => {
  const u = String(url);
  calls.push([u, opts.method || "GET", opts.body ? JSON.parse(opts.body) : null]);
  if (u.includes("/auth/bootstrap-needed")) return ok({ needed: false });
  if (u.includes("/auth/me")) return ok({ user: me });
  if (u.includes("/api/catalog")) return ok({ catalog: cat, version: 1, lazy: false });
  if (u.includes("/api/usage/top")) return ok({ days: 30, tables: [{ tableId: "t1", path: "GOLD.partners.loss_ratio", views: 7, users: 3, exists: true }], terms: [{ term: "loss", count: 4 }], topRated: [], totals: { views: 7, searches: 4, exports: 0, users: 3 } });
  if (u.includes("/api/usage")) return ok({ ok: true });
  if (u.includes("/api/collab/questions/open")) return ok({ toAnswer: [{ id: "q9", entityType: "table", entityId: "t1", path: "GOLD.partners.loss_ratio", body: "Is this net?", by: { name: "Al", email: "al@x.io" }, ts: now }], mine: [] });
  if (u.endsWith("/comments") && opts.method === "POST") {
    const b = JSON.parse(opts.body); const c = { id: `c${state.comments.length + 1}`, entityType: "table", entityId: "t1", parentId: b.parentId || null, kind: b.kind || "comment", body: b.body, by: { name: "Tester", email: "t@x.io" }, ts: now, replies: [] };
    if (c.parentId) state.comments.find((x) => x.id === c.parentId).replies.push(c); else state.comments.unshift(c);
    return ok({ comment: c, notified: b.kind === "question" ? 1 : 0 });
  }
  if (u.includes("/resolve")) { const q = state.comments.find((c) => u.includes(c.id)); q.resolvedTs = now; q.resolvedBy = "Tester"; return ok({ comment: q }); }
  if (u.endsWith("/rating") && opts.method === "PUT") { const b = JSON.parse(opts.body); state.rating = b.stars == null ? { avg: null, count: 0, mine: null } : { avg: b.stars, count: 1, mine: b.stars }; return ok({ rating: state.rating }); }
  if (u.includes("/api/collab/table/t1")) return ok(state);
  if (u.includes("/api/collab/schema/s")) return ok({ comments: [], rating: { avg: null, count: 0, mine: null }, usage: null });
  if (u.includes("/oauth/apps") && opts.method === "DELETE") return ok({ ok: true, revoked: 1 });
  if (u.includes("/oauth/apps")) return ok({ apps: [{ clientId: "cxc_1", clientName: "Claude Desktop", userId: "u", userName: "Tester", userEmail: "t@x.io", scope: "catalog:read catalog:write", active: 1, firstTs: now, lastUsedTs: null }], limits: { perMinute: 300, writesPerMinute: 60 } });
  if (u.includes("/api/stewardship/policy")) return ok({ policy: { attestDays: 180, remindEveryDays: 7, soonDays: 14 } });
  return ok({ requests: [], messages: [], unread: 0, users: [], invites: [], entries: [], toAct: [], initiated: [], tasks: [], personIds: ["p1"], keys: [], enabled: false, files: [] });
});

describe("collaboration UI", () => {
  it("records views, shows the rating in the table header and runs a comment → question → answer → resolve flow on the Discussion tab", async () => {
    globalThis.fetch = mockFetch(); localStorage.clear(); calls.length = 0; _resetUsageForTests();
    render(<App />);
    await screen.findAllByText("Health");
    /* home shows the usage panel */
    expect(await screen.findByText("Most viewed tables")).toBeTruthy();
    expect(screen.getByText("GOLD.partners.loss_ratio")).toBeTruthy();
    /* open the table */
    fireEvent.click(screen.getByText("GOLD.partners.loss_ratio"));
    expect(await screen.findByText("Loss ratio")).toBeTruthy();
    await waitFor(() => expect(calls.some(([u, m, b]) => u.includes("/api/usage") && m === "POST" && b?.kind === "view" && b.entityId === "t1")).toBe(true));
    /* rating widget in the header: click 4 stars */
    const rating = (await screen.findAllByTestId("rating"))[0];
    expect(within(rating).getByText("no ratings yet")).toBeTruthy();
    fireEvent.click(within(rating).getByRole("button", { name: "4 stars" }));
    await waitFor(() => expect(within(rating).getByText("4.0 (1)")).toBeTruthy());
    /* discussion tab */
    fireEvent.click(screen.getByRole("tab", { name: "Discussion" }));
    expect(await screen.findByText(/No comments or questions yet/)).toBeTruthy();
    expect(screen.getByText(/3 \/ 5 views/)).toBeTruthy();
    /* v1.73 (F-F13): header stars and Discussion tab share one record — one request, the same rating, no window event */
    expect(calls.filter(([u, m]) => u.endsWith("/api/collab/table/t1") && m === "GET")).toHaveLength(1);
    expect(screen.getAllByTestId("rating").map((r) => within(r).queryByText("4.0 (1)") !== null)).toEqual([true, true]);
    fireEvent.change(screen.getByLabelText("Your comment"), { target: { value: "Refreshed nightly." } });
    fireEvent.click(screen.getByRole("button", { name: /Post comment/ }));
    expect(await screen.findByText("Refreshed nightly.")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/^Question/));
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "Net or gross?" } });
    fireEvent.click(screen.getByRole("button", { name: /Ask question/ }));
    expect(await screen.findByText("Net or gross?")).toBeTruthy();
    expect(screen.getByText("Open question")).toBeTruthy();
    const thread = screen.getByText("Net or gross?").closest(".role-row");
    fireEvent.click(within(thread).getByRole("button", { name: "Reply" }));
    fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: "Net." } });
    fireEvent.click(screen.getByRole("button", { name: /Post answer/ }));
    expect(await screen.findByText("Net.")).toBeTruthy();
    expect(screen.getByText("Answer")).toBeTruthy();
    fireEvent.click(within(thread).getByRole("button", { name: /Resolve/ }));
    expect(await screen.findByText("Resolved")).toBeTruthy();
    expect(calls.some(([u, m]) => u.includes("/resolve") && m === "POST")).toBe(true);
    /* dashboard lists questions addressed to me and opens the Discussion tab */
    fireEvent.click(screen.getByRole("button", { name: /My Dashboard/ }));
    expect(await screen.findByText("Questions to answer")).toBeTruthy();
    fireEvent.click(screen.getByText("Is this net?").closest(".role-row"));
    expect(await screen.findByRole("tab", { name: "Discussion", selected: true })).toBeTruthy();
  });

  it("lists connected OAuth apps and revokes one", async () => {
    globalThis.fetch = mockFetch(); calls.length = 0;
    const flash = vi.fn();
    render(<I18nProvider><ToastStub flash={flash}><ConnectedAppsC all /></ToastStub></I18nProvider>);
    expect(await screen.findByText("Claude Desktop")).toBeTruthy();
    expect(screen.getByText("read + write")).toBeTruthy();
    expect(screen.getByText(/300 requests and 60 write calls/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Disconnect Claude Desktop/ }));
    await waitFor(() => expect(calls.some(([u, m]) => u.includes("/oauth/apps/cxc_1?userId=u") && m === "DELETE")).toBe(true));
    expect(flash).toHaveBeenCalledWith("Application disconnected");
  });
});
