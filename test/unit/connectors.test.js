import { describe, it, expect } from "vitest";
import { parseDbt } from "../../src/lib/dbt-import.js";
import { parseContracts, contractToTables } from "../../src/lib/odcs-import.js";
import { importBundle } from "../../src/lib/catalog-ops.js";
import { sourceLabel } from "../../src/lib/model.js";
import YAML from "yaml";

const manifest = {
  metadata: { project_name: "claims_dwh", dbt_version: "1.8.2" },
  sources: {
    "source.claims_dwh.raw.claims": { resource_type: "source", source_name: "raw", name: "claims", database: "LAKE", schema: "bronze", identifier: "claims_raw", description: "raw claim events", columns: { claim_id: { name: "claim_id", description: "id", data_type: "varchar" } } },
  },
  nodes: {
    "model.claims_dwh.stg_claims": { resource_type: "model", name: "stg_claims", database: "LAKE", schema: "silver", alias: "stg_claims", description: "cleansed claims", config: { materialized: "view" }, tags: ["pii"], package_name: "claims_dwh",
      columns: { claim_id: { name: "claim_id", description: "claim id", meta: { business_term: "Claim number" } }, amount: { name: "amount", description: "", meta: { sensitivity: "Confidential" } } },
      depends_on: { nodes: ["source.claims_dwh.raw.claims"] } },
    "model.claims_dwh.fct_claims": { resource_type: "model", name: "fct_claims", database: "LAKE", schema: "gold", description: "", config: { materialized: "table" }, columns: { claim_id: { name: "claim_id" } }, depends_on: { nodes: ["model.claims_dwh.stg_claims", "model.claims_dwh.tmp"] } },
    "model.claims_dwh.tmp": { resource_type: "model", name: "tmp", database: "LAKE", schema: "gold", config: { materialized: "ephemeral" }, columns: {}, depends_on: { nodes: [] } },
    "seed.claims_dwh.countries": { resource_type: "seed", name: "countries", database: "LAKE", schema: "gold", columns: {}, depends_on: { nodes: [] } },
    "test.claims_dwh.not_null_stg_claims_claim_id": { resource_type: "test", column_name: "claim_id", test_metadata: { name: "not_null" }, depends_on: { nodes: ["model.claims_dwh.stg_claims"] } },
    "test.claims_dwh.unique_stg_claims_claim_id": { resource_type: "test", column_name: "claim_id", test_metadata: { name: "unique" }, depends_on: { nodes: ["model.claims_dwh.stg_claims"] } },
  },
};
const catalogJson = { nodes: { "model.claims_dwh.stg_claims": { metadata: { type: "VIEW" }, columns: { AMOUNT: { name: "AMOUNT", type: "NUMBER(12,2)", index: 2 }, CLAIM_ID: { name: "CLAIM_ID", type: "VARCHAR", index: 1 } } } } };

describe("dbt import", () => {
  it("maps models, seeds and sources to databases/schemas/tables with lineage from depends_on", () => {
    const r = parseDbt(manifest, catalogJson);
    expect(r.project).toBe("claims_dwh");
    expect(r.databases.map((d) => d.name)).toEqual(["LAKE"]);
    const sc = Object.fromEntries(r.databases[0].schemas.map((s) => [s.name, s]));
    expect(Object.keys(sc)).toEqual(["bronze", "gold", "silver"]);
    expect(sc.gold.tables.map((t) => t.name)).toEqual(["countries", "fct_claims"]);            /* ephemeral model skipped */
    const stg = sc.silver.tables[0];
    expect(stg.type).toBe("VIEW");
    expect(stg.columns.map((c) => c.name)).toEqual(["CLAIM_ID", "AMOUNT"]);                      /* order + names from catalog.json */
    expect(stg.columns[0]).toMatchObject({ type_text: "VARCHAR", isPK: true, nullable: false, comment: "claim id", businessTerm: "Claim number" });
    expect(stg.columns[1]).toMatchObject({ type_text: "NUMBER(12,2)", sensitivity: "Confidential" });
    expect(stg.businessDefinition).toMatch(/dbt model stg_claims \(claims_dwh\)\. Tags: pii\./);
    expect(sc.bronze.tables[0]).toMatchObject({ name: "claims_raw", comment: "raw claim events" });
    expect(r.lineage).toEqual([["LAKE.bronze.claims_raw", "LAKE.silver.stg_claims"], ["LAKE.silver.stg_claims", "LAKE.gold.fct_claims"]]);
  });
  it("rejects files that are not a manifest", () => {
    expect(() => parseDbt({ foo: 1 })).toThrow(/manifest/);
    expect(() => parseDbt({ nodes: {} })).toThrow(/no models/);
  });
});

const ODCS_V3 = `
apiVersion: v3.0.0
kind: DataContract
id: claims-payments
name: Claim payments
version: 2.1.0
status: active
domain: Claims
dataProduct: claims_payments
description:
  purpose: Payments per claim for finance reporting
tags: [finance]
team:
  - username: jdoe
    role: owner
servers:
  - server: prod
    type: databricks
    catalog: gold_claims
    schema: payments
schema:
  - name: payment
    physicalName: PAYMENT
    physicalType: table
    description: One row per payment
    businessName: Claim payment
    properties:
      - name: payment_id
        logicalType: string
        physicalType: varchar(36)
        primaryKey: true
        description: Payment identifier
      - name: iban
        logicalType: string
        classification: PII
        businessName: Bank account
        required: true
      - name: amount
        logicalType: number
        physicalType: decimal(12,2)
        classification: confidential
      - name: address
        logicalType: object
        properties:
          - name: city
            logicalType: string
          - name: zip
            logicalType: string
            required: true
  - name: payment_status
    physicalType: view
    properties:
      - name: status
        logicalType: string
`;
const ODCS_V2 = { kind: "DataContract", datasetName: "CUSTOMER_DB", quantumName: "customers", version: "1.0.0", database: "CRM", datasetSchema: "core",
  dataset: [{ table: "CUSTOMER", description: "customers", columns: [{ column: "cust_id", logicalType: "int", isPrimary: true, isNullable: false }, { column: "email", logicalType: "string", classification: "restricted", isNullable: true, businessName: "E-mail" }] }] };

describe("ODCS data contracts", () => {
  it("parses a v3 YAML contract into tables with sensitivity, business terms and keys", () => {
    const r = contractToTables(YAML.parse(ODCS_V3));
    expect(r.database).toBe("gold_claims"); expect(r.schema).toBe("payments"); expect(r.contract).toBe("Claim payments v2.1.0");
    expect(r.tables.map((t) => [t.name, t.type])).toEqual([["PAYMENT", "TABLE"], ["payment_status", "VIEW"]]);
    const p = r.tables[0];
    expect(p.comment).toBe("One row per payment");
    expect(p.businessDefinition).toMatch(/Business name: Claim payment\. Data contract Claim payments v2\.1\.0 · status active · domain Claims · data product claims_payments · team: jdoe \(owner\) Tags: finance\./);
    expect(p.columns.map((c) => c.name)).toEqual(["payment_id", "iban", "amount", "address.city", "address.zip"]);
    expect(p.columns[0]).toMatchObject({ isPK: true, nullable: false, type_text: "VARCHAR(36)", comment: "Payment identifier" });
    expect(p.columns[1]).toMatchObject({ sensitivity: "PII", businessTerm: "Bank account", nullable: false });
    expect(p.columns[2]).toMatchObject({ sensitivity: "Confidential", type_text: "DECIMAL(12,2)" });
    expect(p.columns[4]).toMatchObject({ nullable: false, type_text: "STRING" });
    expect(r.tables[1].comment).toBe("Payments per claim for finance reporting");   /* falls back to the contract purpose */
  });
  it("parses v2 JSON contracts and merges several contracts per database/schema", () => {
    const r = parseContracts([JSON.stringify(ODCS_V2), ODCS_V3]);
    expect(r.databases.map((d) => d.name).sort()).toEqual(["CRM", "gold_claims"]);
    const crm = r.databases.find((d) => d.name === "CRM");
    expect(crm.schemas[0].name).toBe("core");
    expect(crm.schemas[0].tables[0].columns[1]).toMatchObject({ name: "email", sensitivity: "Confidential", businessTerm: "E-mail", nullable: true });
    expect(crm.schemas[0].tables[0].columns[0]).toMatchObject({ isPK: true, nullable: false });
    expect(r.contracts).toEqual(["customers v1.0.0", "Claim payments v2.1.0"]);
    expect(r.lineage).toEqual([]);
  });
  it("reports unusable files", () => {
    expect(() => parseContracts(["just: text"])).toThrow(/no schema/);
    expect(() => parseContracts(["a: [b"])).toThrow(/YAML/);
    expect(() => parseContracts([""])).toThrow(/empty/);
  });
});

describe("importBundle", () => {
  const base = () => ({ hubs: [{ id: "central", name: "Central" }], databases: [], schemas: [], tables: [], attributes: [], lineage: [], people: [], domains: [] });
  const bundle = { databases: [
    { name: "LAKE", schemas: [{ name: "silver", tables: [{ name: "stg_claims", type: "VIEW", comment: "cleansed", columns: [{ name: "claim_id", type_text: "VARCHAR", isPK: true, nullable: false, businessTerm: "Claim number" }] }] },
      { name: "gold", tables: [{ name: "fct_claims", columns: [{ name: "claim_id", type_text: "VARCHAR" }] }] }] },
    { name: "Claims Analytics", schemas: [{ name: "Reports", tables: [{ name: "Claims Overview", type: "REPORT", columns: [] }] }] },
  ], lineage: [["LAKE.silver.stg_claims", "LAKE.gold.fct_claims"], ["LAKE.gold.fct_claims", "Claims Analytics.Reports.Claims Overview"], ["nope.x.y", "LAKE.gold.fct_claims"]] };

  it("creates databases in the chosen hub with guessed layers and resolves lineage inside the bundle", () => {
    const s = base();
    const r = importBundle(s, { hubId: "central", country: "DE", layer: "", sourceType: "dbt", databases: bundle.databases, lineage: bundle.lineage, sourceRef: { kind: "dbt", project: "claims_dwh" } });
    expect(r.databases.map((d) => [d.name, d.hubId, d.layer])).toEqual([["LAKE", "central", "other"], ["Claims Analytics", "central", "other"]]);
    expect(r.edges).toBe(2);
    expect(s.tables.find((t) => t.name === "stg_claims").tags).toBe("dbt");
    expect(s.attributes.find((a) => a.name === "claim_id" && a.isPK).businessTerm).toBe("Claim number");
    expect(sourceLabel(s.databases[0].sourceRef)).toBe("dbt · claims_dwh");
  });
  it("enriches existing tables instead of duplicating them and links lineage to existing catalog tables", () => {
    const s = base();
    s.databases.push({ id: "d1", name: "LAKE", hubId: "central", layer: "gold", source: "unity" });
    s.schemas.push({ id: "s1", databaseId: "d1", name: "gold" });
    s.tables.push({ id: "t1", schemaId: "s1", name: "fct_claims", description: "", businessDefinition: "" });
    s.attributes.push({ id: "a1", tableId: "t1", name: "claim_id", description: "", businessTerm: "", sensitivity: "Internal", isPK: false });
    const r = importBundle(s, { hubId: "central", sourceType: "Data contract", databases: [{ name: "LAKE", schemas: [{ name: "gold", tables: [{ name: "fct_claims", comment: "from contract", columns: [{ name: "claim_id", comment: "the id", sensitivity: "Confidential", isPK: true }, { name: "new_col", type_text: "INT" }] }] }] },
      { name: "Claims Analytics", schemas: [{ name: "Reports", tables: [{ name: "Claims Overview", type: "REPORT", columns: [] }] }] }],
      lineage: [["LAKE.gold.fct_claims", "Claims Analytics.Reports.Claims Overview"]] });
    expect(s.databases.filter((d) => d.name === "LAKE")).toHaveLength(1);
    expect(s.tables.filter((t) => t.name === "fct_claims")).toHaveLength(1);
    expect(s.tables.find((t) => t.id === "t1").description).toBe("from contract");
    expect(s.attributes.find((a) => a.id === "a1")).toMatchObject({ description: "the id", sensitivity: "Confidential", isPK: true });
    expect(s.attributes.some((a) => a.tableId === "t1" && a.name === "new_col")).toBe(true);
    expect(r.edges).toBe(1); expect(s.lineage[0].from).toBe("t1");
  });
  it("puts bundles into the SOURCE hub with layer other when no hub is chosen", () => {
    const s = base();
    importBundle(s, { sourceType: "Power BI", databases: [{ name: "WS", schemas: [] }] });
    const hub = s.hubs.find((h) => h.name === "SOURCE");
    expect(hub).toBeTruthy(); expect(s.databases[0]).toMatchObject({ hubId: hub.id, layer: "other", sourceType: "Power BI" });
  });
});
