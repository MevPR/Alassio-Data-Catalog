import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SourceModalC } from "../../src/components/source-import.jsx";
import { SOURCE_TYPES, visibleSourceTypes, INSPECTOR_KINDS } from "../../src/lib/source-types.js";
import { sourceLabel } from "../../src/lib/model.js";

afterEach(cleanup);
const inspectCall = (m) => m.mock.calls.find(([u]) => String(u).endsWith("/api/source-import/inspect"));
/* fetch stub: capabilities → inspector present; everything else → the given inspect response */
const stubFetch = (resp) => { const fn = vi.fn(async (u) => String(u).includes("/capabilities") ? { ok: true, status: 200, json: async () => ({ native: ["odata"], inspector: true, inspectorReachable: true }) } : resp()); vi.stubGlobal("fetch", fn); return fn; };

describe("Load source — DuckDB", () => {
  it("offers DuckDB as the first and preselected source system", () => {
    expect(Object.keys(SOURCE_TYPES)[0]).toBe("duckdb");
    render(<SourceModalC sources={[]} onClose={() => {}} onImport={() => {}} />);
    const sel = screen.getByDisplayValue(/DuckDB/);
    expect(sel.tagName).toBe("SELECT");
    expect(sel.querySelectorAll("option")[0].textContent).toMatch(/DuckDB/);
    expect(screen.getByText("DuckDB file path on the server")).toBeTruthy();
  });

  it("sends mode=duckdb with the file path and derives the catalog name from the file", async () => {
    const fetchMock = stubFetch(() => ({ ok: true, status: 200, json: async () => ({ schemas: [{ name: "main", tables: [{ name: "customer", columns: [] }] }] }) }));
    const onImport = vi.fn();
    render(<SourceModalC sources={[]} onClose={() => {}} onImport={onImport} />);
    fireEvent.change(screen.getByPlaceholderText("/opt/datahub-catalog/duckdb/warehouse.duckdb"), { target: { value: "/data/claims.duckdb" } });
    fireEvent.click(screen.getByRole("button", { name: /Load/ }));
    await waitFor(() => expect(onImport).toHaveBeenCalled());
    const body = JSON.parse(inspectCall(fetchMock)[1].body);
    expect(body).toMatchObject({ mode: "duckdb", path: "/data/claims.duckdb", readOnly: true });
    const [name, system, schemas, , ref] = onImport.mock.calls[0];
    expect(name).toBe("claims");
    expect(system).toBe("DuckDB");
    expect(schemas[0].name).toBe("main");
    expect(ref).toMatchObject({ kind: "duckdb", path: "/data/claims.duckdb", name: "claims" });
    expect(sourceLabel(ref)).toBe("DuckDB · /data/claims.duckdb");
    vi.unstubAllGlobals();
  });

  it("prefills the path from a previously used DuckDB source", () => {
    render(<SourceModalC sources={[{ kind: "duckdb", type: "duckdb", path: "/data/old.duckdb", name: "OLD" }]} onClose={() => {}} onImport={() => {}} />);
    fireEvent.change(screen.getByDisplayValue(/pick a source used before/), { target: { value: "0" } });
    expect(screen.getByDisplayValue("/data/old.duckdb")).toBeTruthy();
  });
});

describe("Load source — v1.55 connectors", () => {
  const pick = (label) => fireEvent.change(screen.getByDisplayValue(/DuckDB \(database file/), { target: { value: label } });

  it("lists the new source systems in the intended order", () => {
    const keys = Object.keys(SOURCE_TYPES);
    expect(keys.slice(0, 2)).toEqual(["duckdb", "lakefiles"]);
    for (const k of ["mssql", "oracle", "snowflake", "odata", "kafka", "powerbi", "dbt", "odcs"]) expect(keys).toContain(k);
    expect(SOURCE_TYPES.snowflake.tpl({ user: "u", password: "p@w", host: "xy1.eu-central-1", database: "DWH" }, { warehouse: "WH", role: "R" })).toBe("snowflake://u:p%40w@xy1.eu-central-1/DWH?warehouse=WH&role=R");
    expect(SOURCE_TYPES.oracle.tpl({ user: "u", password: "p", host: "h", port: "", database: "ORCLPDB" })).toBe("oracle+oracledb://u:p@h:1521/?service_name=ORCLPDB");
    expect(SOURCE_TYPES.mssql.tpl({ user: "u", password: "p", host: "h", port: "", database: "claims" })).toBe("mssql+pymssql://u:p@h:1433/claims");
  });

  it("sends the lake file paths and credentials to the inspector and names the database after the first path", async () => {
    const fetchMock = stubFetch(() => ({ ok: true, status: 200, json: async () => ({ schemas: [{ name: "bronze", tables: [{ name: "claims", columns: [] }] }], skipped: ["x: no files"] }) }));
    const onImport = vi.fn();
    render(<SourceModalC sources={[]} onClose={() => {}} onImport={onImport} />);
    pick("lakefiles");
    fireEvent.change(screen.getByPlaceholderText(/s3:\/\/lake\/bronze/), { target: { value: "s3://lake/bronze/claims/*.parquet\ns3://lake/bronze/policies/" } });
    fireEvent.change(screen.getByDisplayValue("None / public / local files"), { target: { value: "s3" } });
    fireEvent.change(screen.getByPlaceholderText("eu-central-1"), { target: { value: "eu-west-1" } });
    fireEvent.click(screen.getByRole("button", { name: /Load into SOURCE hub/ }));
    await waitFor(() => expect(onImport).toHaveBeenCalled());
    expect(JSON.parse(inspectCall(fetchMock)[1].body)).toMatchObject({ mode: "lakefiles", paths: ["s3://lake/bronze/claims/*.parquet", "s3://lake/bronze/policies/"], format: "auto", schema: "files", credentials: { s3Region: "eu-west-1" } });
    const [name, system, , , ref] = onImport.mock.calls[0];
    expect(name).toBe("lake"); expect(system).toBe("Data lake files");
    expect(ref).toMatchObject({ kind: "lakefiles", auth: "s3", s3Region: "eu-west-1" }); expect(ref.s3Secret).toBeUndefined();
    expect(sourceLabel(ref)).toBe("Lake files · s3://lake/bronze/claims/*.parquet (+1)");
    vi.unstubAllGlobals();
  });

  it("imports a Power BI scan as a bundle into the chosen hub", async () => {
    const bundle = { databases: [{ name: "Claims Analytics", schemas: [{ name: "Reports", tables: [{ name: "Overview", type: "REPORT", columns: [] }] }] }], lineage: [["a.b.c", "Claims Analytics.Reports.Overview"]] };
    const fetchMock = stubFetch(() => ({ ok: true, status: 200, json: async () => bundle }));
    const onBundle = vi.fn();
    render(<SourceModalC hubs={[{ id: "central", name: "Central" }]} sources={[]} onClose={() => {}} onImport={() => {}} onImportBundle={onBundle} />);
    pick("powerbi");
    const btn = screen.getByRole("button", { name: /Load into SOURCE hub/ });
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("00000000-0000-0000-0000-000000000000"), { target: { value: "tenant" } });
    fireEvent.change(screen.getByDisplayValue("SOURCE (layer Other)"), { target: { value: "central" } });
    expect(screen.getByRole("button", { name: /Load into Central hub/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Power BI access token"), { target: { value: "tok" } });
    fireEvent.change(screen.getByPlaceholderText("Claims Analytics, Finance*"), { target: { value: "Claims Analytics" } });
    fireEvent.click(screen.getByRole("button", { name: /Load into Central hub/ }));
    await waitFor(() => expect(onBundle).toHaveBeenCalled());
    expect(JSON.parse(inspectCall(fetchMock)[1].body)).toMatchObject({ mode: "powerbi", tenantId: "tenant", token: "tok", workspaces: "Claims Analytics", includeReports: true });
    expect(onBundle.mock.calls[0][0]).toMatchObject({ hubId: "central", sourceType: "Power BI", databases: bundle.databases, lineage: bundle.lineage, sourceRef: { kind: "powerbi", tenantId: "tenant", workspaces: "Claims Analytics" } });
    expect(onBundle.mock.calls[0][0].sourceRef.token).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("hands a dbt manifest and data contracts to the server as text (v1.66) and shows server errors inline", async () => {
    const onBundle = vi.fn(async () => {});
    render(<SourceModalC hubs={[]} sources={[]} onClose={() => {}} onImport={() => {}} onImportBundle={onBundle} />);
    pick("dbt");
    const manifest = { metadata: { project_name: "p" }, nodes: { "model.p.m": { resource_type: "model", name: "m", database: "D", schema: "S", columns: { id: { name: "id" } }, depends_on: { nodes: [] } } } };
    const file = new File([JSON.stringify(manifest)], "manifest.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("dbt manifest.json"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /Load into SOURCE hub/ }));
    await waitFor(() => expect(onBundle).toHaveBeenCalled());
    const arg = onBundle.mock.calls[0][0];
    expect(arg).toMatchObject({ hubId: "source", server: { kind: "dbt", fileName: "manifest.json", catalog: null } });
    expect(JSON.parse(arg.server.manifest).metadata.project_name).toBe("p");
    cleanup();
    const failing = vi.fn(async () => { throw new Error("no schema found in c.yaml"); });
    render(<SourceModalC hubs={[]} sources={[]} onClose={() => {}} onImport={() => {}} onImportBundle={failing} />);
    pick("odcs");
    fireEvent.change(screen.getByLabelText("Contract files"), { target: { files: [new File(["nothing: here"], "c.yaml")] } });
    fireEvent.click(screen.getByRole("button", { name: /Load into SOURCE hub/ }));
    await waitFor(() => expect(screen.getByText(/Could not load: no schema/)).toBeTruthy());
    expect(failing.mock.calls[0][0].server).toMatchObject({ kind: "odcs", contracts: ["nothing: here"], fileName: "c.yaml" });
  });
});

describe("Load source — without the inspector (v1.60)", () => {
  it("hides the inspector-only source systems and explains the Unity Catalog path", async () => {
    const caps = { native: ["odata", "successfactors", "kafka", "powerbi", "informatica"], inspectorModes: ["duckdb", "lakefiles", "sqlalchemy", "jdbc"], inspector: false, inspectorReachable: false };
    const visible = Object.keys(visibleSourceTypes(caps));
    expect(visible).toEqual(["informatica", "successfactors", "odata", "kafka", "powerbi", "dbt", "odcs"]);
    expect(Object.keys(visibleSourceTypes(null))).toEqual(Object.keys(SOURCE_TYPES)); expect(Object.keys(visibleSourceTypes({ inspector: true }))).toEqual(Object.keys(SOURCE_TYPES));
    expect(INSPECTOR_KINDS).toContain("sqlalchemy");
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => caps }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SourceModalC sources={[]} onClose={() => {}} onImport={() => {}} />);
    await waitFor(() => expect(screen.getByText(/runs without the source inspector service/)).toBeTruthy());
    const sel = screen.getByDisplayValue(/Informatica Data Catalog/);
    expect([...sel.querySelectorAll("option")].map((o) => o.value)).toEqual(visible);
    expect(screen.queryByText("DuckDB file path on the server")).toBeNull();
    expect(screen.getByText("Catalog base URL")).toBeTruthy();
    vi.unstubAllGlobals();
  });
  it("warns when the inspector is configured but down, and keeps everything when capabilities cannot be read", async () => {
    render(<SourceModalC sources={[]} onClose={() => {}} onImport={() => {}} capabilities={{ inspector: true, inspectorReachable: false }} />);
    expect(screen.getByText(/configured but currently not reachable/)).toBeTruthy();
    expect(screen.getByDisplayValue(/DuckDB/)).toBeTruthy();
    cleanup();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    render(<SourceModalC sources={[]} onClose={() => {}} onImport={() => {}} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());   /* the failed capabilities request has been made … */
    await act(async () => {});                                           /* … and its rejection handled */
    expect(screen.getByDisplayValue(/DuckDB/).querySelectorAll("option")).toHaveLength(Object.keys(SOURCE_TYPES).length);
    expect(screen.queryByText(/runs without the source inspector/)).toBeNull();
    vi.unstubAllGlobals();
  });
});
