import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import App from "../../src/App.jsx";
import { okJson as ok } from "../helpers/fetch.js";

afterEach(cleanup);

/* One walk through every extracted view (src/views/*) with an admin account. */
const cat = {
  hubs: [{ id: "h", name: "Health", description: "Health hub", dataHubs: [{ name: "DE", description: "Germany", bpoId: "p1", leanixUrl: "https://leanix.example/x" }] }, { id: "src", name: "SOURCE" }],
  databases: [{ id: "d", name: "GOLD", hubId: "h", layer: "gold", country: "DE", domainId: "dm" }, { id: "b", name: "BRONZE", hubId: "h", layer: "bronze", country: "DE" }, { id: "sdb", name: "claims", hubId: "src", layer: "other", country: "GLOBAL", sourceRef: { kind: "duckdb", path: "/data/claims.duckdb" } }],
  schemas: [{ id: "s", databaseId: "d", name: "partners", description: "Service partner data product" }, { id: "raw", databaseId: "b", name: "raw" }, { id: "main", databaseId: "sdb", name: "main" }],
  tables: [{ id: "t1", schemaId: "s", name: "loss_ratio", description: "Loss ratio per partner", businessDefinition: "Ratio of losses", tags: "kpi", kvTags: [{ key: "Project", value: "GenAI" }] }, { id: "t0", schemaId: "raw", name: "claims_raw" }, { id: "ts", schemaId: "main", name: "customer" }],
  attributes: [{ id: "a1", tableId: "t1", name: "lr", dataType: "DECIMAL", isPK: true, nullable: false, sensitivity: "Internal" }, { id: "a2", tableId: "t1", name: "insured", dataType: "STRING", sensitivity: "PII" }, { id: "a0", tableId: "t0", name: "payload", dataType: "STRING" }],
  domains: [{ id: "dm", name: "Claims", description: "Claims domain", ownerId: "p1", stewardId: "p2" }],
  people: [{ id: "p1", name: "Anna Owner", email: "anna@x.io" }, { id: "p2", name: "Ben Steward", email: "" }],
  lineage: [{ id: "e1", from: "t0", to: "t1", mappings: [] }], glossary: [{ id: "g1", name: "Loss ratio", definition: "Losses over premium", refs: [{ type: "table", id: "t1" }] }],
};
const h1 = (text) => (_, el) => el.tagName === "H1" && el.textContent === text;
const me = { id: "u", name: "Tester", email: "t@x.io", role: "admin", roles: ["admin"] };
const mockFetch = () => vi.fn(async (url) => {
  const u = String(url);
  if (u.includes("/auth/bootstrap-needed")) return ok({ needed: false });
  if (u.includes("/auth/me")) return ok({ user: me });
  if (u.includes("/api/catalog")) return ok({ catalog: cat, version: 1, lazy: false });
  if (u.includes("/api/messages")) return ok({ messages: [], unread: 6 });
  return ok({ requests: [], messages: [], unread: 0, users: [], invites: [], entries: [], toAct: [], initiated: [], tasks: [], personIds: [], keys: [], enabled: false, files: [] });
});

describe("App views", () => {
  it("navigates hub → data hub → database → schema → table and renders every tab", async () => {
    globalThis.fetch = mockFetch(); localStorage.clear();
    render(<App />);
    await screen.findByText("Health hub");                                   // catalog loaded (hub card on the dashboard)
    const tree = screen.getByRole("navigation", { name: /Catalog tree|Katalogbaum/ });
    expect(screen.getByText(/Catalog coverage and governance/)).toBeTruthy();
    /* hub type */
    fireEvent.click(within(tree).getByText("Health"));
    expect(await screen.findByText(h1("Health · Data Hub Type"))).toBeTruthy();
    expect(screen.getByText("Germany")).toBeTruthy();                       // data hub card
    /* data hub */
    fireEvent.click(screen.getByText("Germany").closest(".card"));
    expect(await screen.findByText(/BPO · Anna Owner/)).toBeTruthy();
    expect(screen.getAllByText("LeanIX").length).toBeGreaterThan(0);
    /* database */
    fireEvent.click(screen.getAllByText("GOLD").find((e) => e.closest(".card")).closest(".card"));
    expect(await screen.findByText("Service partner data product")).toBeTruthy();
    expect(screen.getByText(/Data product/)).toBeTruthy();
    /* schema */
    fireEvent.click(screen.getByText("Service partner data product").closest(".card"));
    expect(await screen.findByText("Loss ratio per partner")).toBeTruthy();
    /* table */
    fireEvent.click(screen.getByText("Loss ratio per partner").closest(".card"));
    expect(await screen.findByText("lr")).toBeTruthy();
    expect(screen.getByText("PRIMARY KEY · NOT NULL")).toBeTruthy();
    expect(screen.getByText("GenAI")).toBeTruthy();                          // project tag chip
    fireEvent.click(screen.getByRole("tab", { name: "Business" }));
    expect(await screen.findByText("Ratio of losses")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Lineage" }));
    expect(await screen.findByText("claims_raw")).toBeTruthy();              // upstream edge row
    fireEvent.click(screen.getByRole("tab", { name: "Governance" }));
    expect((await screen.findAllByText("Anna Owner")).length).toBeGreaterThan(0);   // domain owner / BPO
    expect(screen.getByText("insured")).toBeTruthy();                        // PII attribute chip
    /* breadcrumb back to the hub */
    fireEvent.click(screen.getAllByText("Health").find((e) => e.closest(".crumb")));
    expect(await screen.findByText(h1("Health · Data Hub Type"))).toBeTruthy();
  });

  it("renders lineage, governance overview, glossary, marketplace and search", async () => {
    globalThis.fetch = mockFetch(); localStorage.clear();
    render(<App />);
    await screen.findByText("Health hub");
    /* unread counter: small red badge overlapping the My Dashboard button */
    const badge = await screen.findByText("6");
    expect(badge.className).toBe("badge");
    expect(badge.closest("button").className).toContain("btn-badged");
    expect(badge.closest("button").textContent).toContain("My Dashboard");
    /* full lineage from the dashboard */
    fireEvent.click(screen.getByRole("button", { name: /Full lineage/ }));
    expect(await screen.findByText("Data lineage")).toBeTruthy();
    expect(screen.getAllByText("loss_ratio").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/BRONZE/).length).toBeGreaterThan(0);
    /* governance overview via the admin menu */
    fireEvent.click(screen.getByText("Admin"));
    fireEvent.click(screen.getByText("Governance Overview"));
    expect(await screen.findByText(/Who is responsible for what/)).toBeTruthy();
    expect(screen.getByLabelText("BPO of DE").value).toBe("p1");
    expect(screen.getByText("Claims domain")).toBeTruthy();
    /* glossary */
    fireEvent.click(screen.getByRole("button", { name: /Glossary/ }));
    expect(await screen.findByText("Losses over premium")).toBeTruthy();
    /* marketplace lists the gold schema as product */
    fireEvent.click(screen.getByRole("button", { name: /Marketplace/ }));
    expect(await screen.findByText(/Marketplace/i, { selector: "h1" })).toBeTruthy();
    /* search with facet filter */
    fireEvent.change(screen.getByLabelText(/Search catalog|Katalog durchsuchen/), { target: { value: "loss" } });
    expect(await screen.findByText("Search results")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Filter by object type"), { target: { value: "attribute" } });
    expect(screen.queryByText("lr")).toBeNull();                              // attribute "lr" does not contain "loss"
    fireEvent.click(screen.getByText("Clear filters"));
    expect(screen.getAllByText("loss_ratio").length).toBeGreaterThan(0);
  });
});

/* v1.64.1: the SOURCE hub is listed last in the tree, below a separator — whatever its position in the document */
describe("Catalog tree — SOURCE hub last", () => {
  it("renders SOURCE below the other data hub types with a separator line", async () => {
    const reordered = { ...cat, hubs: [{ id: "src", name: "SOURCE" }, { id: "pc", name: "P&C" }, ...cat.hubs.filter((h) => h.id === "h")] };
    globalThis.fetch = vi.fn(async (url) => { const u = String(url); const r = await mockFetch()(url); return u.includes("/api/catalog") ? { ...r, json: async () => ({ catalog: reordered, version: 1, lazy: false }) } : r; });
    localStorage.clear();
    render(<App />);
    await screen.findByText("Health hub");
    const tree = screen.getByRole("navigation", { name: /Catalog tree|Katalogbaum/ });
    const names = within(tree).getAllByText(/^(SOURCE|P&C|Health)$/).map((el) => el.textContent);
    expect(names).toEqual(["P&C", "Health", "SOURCE"]);
    const sep = within(tree).getByTestId("tree-sep");
    expect(sep.nextElementSibling.textContent).toContain("SOURCE");
  });
});
