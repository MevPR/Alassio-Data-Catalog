/* v1.60 — the HTTPS connectors (OData / SuccessFactors, Kafka Schema Registry, Power BI, Informatica), ported from
   the Python inspector with its offline fixtures. Since v1.73 this is the only implementation (the Python copies and
   the SOURCE_IMPORT_VIA_INSPECTOR escape hatch were removed). */
import { describe, it, expect } from "vitest";
import { parseXml } from "../../server/connectors/xml.js";
import { fakeTransport } from "../../server/connectors/http.js";
import { parseEdmx, inspectOdata, inspectSuccessFactors } from "../../server/connectors/odata.js";
import { inspectSchemaRegistry, protoFields, avroType } from "../../server/connectors/schema-registry.js";
import { inspectPowerBi } from "../../server/connectors/powerbi.js";
import { inspectInformatica } from "../../server/connectors/informatica.js";
import { inspectNative, NATIVE_MODES } from "../../server/connectors/index.js";

const V4 = `<?xml version="1.0"?><edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0"><edmx:DataServices>
<Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="API_BUSINESS_PARTNER">
<EntityType Name="A_BusinessPartner"><Key><PropertyRef Name="BusinessPartner"/></Key>
<Property Name="BusinessPartner" Type="Edm.String" Nullable="false" MaxLength="10"><Annotation Term="Common.Label" String="Business Partner"/></Property>
<Property Name="BusinessPartnerName" Type="Edm.String"/><NavigationProperty Name="to_BusinessPartnerAddress" Type="Collection(API_BUSINESS_PARTNER.A_BusinessPartnerAddress)"/>
<Annotation Term="Core.Description" String="Business partner master"/></EntityType>
<EntityType Name="A_BusinessPartnerAddress"><Key><PropertyRef Name="BusinessPartner"/><PropertyRef Name="AddressID"/></Key>
<Property Name="BusinessPartner" Type="Edm.String" Nullable="false"/><Property Name="AddressID" Type="Edm.String" Nullable="false"/><Property Name="CityName" Type="Edm.String"/></EntityType>
</Schema></edmx:DataServices></edmx:Edmx>`;
const V2 = `<?xml version="1.0"?><edmx:Edmx xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" Version="1.0">
<!-- a comment --><edmx:DataServices><Schema xmlns="http://schemas.microsoft.com/ado/2008/09/edm" xmlns:sap="http://www.successfactors.com/edm/sap" Namespace="SFOData">
<EntityType Name="PerPerson" sap:label="Person"><Key><PropertyRef Name="personIdExternal"/></Key>
<Property Name="personIdExternal" Type="Edm.String" Nullable="false" sap:label="Person ID"/><Property Name="dateOfBirth" Type="Edm.DateTime" sap:label="Date of birth"/></EntityType>
<EntityType Name="EmpJob" sap:label="Job information &amp; more"><Key><PropertyRef Name="userId"/><PropertyRef Name="seqNumber"/></Key>
<Property Name="userId" Type="Edm.String" Nullable="false"/><Property Name="seqNumber" Type="Edm.Int64" Nullable="false"/><Property Name="jobTitle" Type="Edm.String"/></EntityType>
</Schema></edmx:DataServices></edmx:Edmx>`;

describe("xml parser", () => {
  it("handles namespaces, prefixed attributes, entities, comments and self-closing tags", () => {
    const root = parseXml(V2);
    const edmx = root.children[0];
    expect(edmx.tag).toBe("Edmx"); expect(edmx.ns).toBe("http://schemas.microsoft.com/ado/2007/06/edmx");
    const schema = edmx.children[0].children[0];
    expect(schema.tag).toBe("Schema"); expect(schema.ns).toBe("http://schemas.microsoft.com/ado/2008/09/edm");
    const job = schema.children[1];
    expect(job.attrs["{http://www.successfactors.com/edm/sap}label"]).toBe("Job information & more");
    expect(job.children.map((c) => c.tag)).toEqual(["Key", "Property", "Property", "Property"]);
  });
});

describe("OData / SuccessFactors", () => {
  it("parses v4 metadata: keys, labels, annotations, navigation, entity filter", async () => {
    const t = fakeTransport([["API_BUSINESS_PARTNER/$metadata", { text: V4 }]]);
    const sch = await inspectOdata({ url: "https://s4.example.com/sap/opu/odata/sap/API_BUSINESS_PARTNER", user: "u", password: "p", sapClient: "100" }, { transport: t });
    expect(sch[0].name).toBe("API_BUSINESS_PARTNER"); expect(sch[0].tables.map((x) => x.name)).toEqual(["A_BusinessPartner", "A_BusinessPartnerAddress"]);
    const bp = sch[0].tables[0];
    expect(bp.columns[0]).toEqual({ name: "BusinessPartner", type_text: "STRING", nullable: false, isPK: true, comment: "Business Partner" });
    expect(bp.columns[1]).toEqual({ name: "BusinessPartnerName", type_text: "STRING", nullable: true, isPK: false, comment: "" });
    expect(bp.comment).toBe("Business partner master Navigation: to_BusinessPartnerAddress");
    expect(t.calls[0].opts.params).toEqual({ "sap-client": "100" }); expect(t.calls[0].opts.auth).toEqual({ user: "u", password: "p" }); expect(t.calls[0].opts.headers.Accept).toBe("application/xml");
    const one = await inspectOdata({ url: "https://s4.example.com/sap/opu/odata/sap/API_BUSINESS_PARTNER/$metadata", entityFilter: "A_BusinessPartnerAddr" }, { transport: t });
    expect(one[0].tables).toHaveLength(1); expect(t.calls[1].url).toBe("https://s4.example.com/sap/opu/odata/sap/API_BUSINESS_PARTNER/$metadata");
  });
  it("parses v2 metadata through the generic parser and reports credential/empty errors", async () => {
    const t = fakeTransport([["v2svc/$metadata", { text: V2 }], ["denied/$metadata", { status: 401, text: "" }]]);
    const sch2 = await inspectOdata({ url: "https://x/v2svc", token: "t" }, { transport: t });
    expect(sch2[0].name).toBe("SFOData"); expect(sch2[0].tables[1].comment).toBe("Person"); expect(sch2[0].tables[0].comment).toBe("Job information & more");
    expect(t.calls[0].opts.bearer).toBe("t");
    await expect(inspectOdata({ url: "x/denied", user: "u" }, { transport: t })).rejects.toThrow("refused the credentials (HTTP 401)");
    await expect(inspectOdata({ url: "https://x/v2svc", entityFilter: "Nope" }, { transport: t })).rejects.toThrow("No entity types found in the OData metadata matching 'Nope'");
    expect(() => parseEdmx("<x/>")).toThrow("No entity types");
  });
  it("logs in to SuccessFactors as user@companyId and keeps sap:label descriptions", async () => {
    const t = fakeTransport([["/odata/v2/$metadata", { text: V2 }]]);
    const sch = await inspectSuccessFactors({ apiHost: "api4.successfactors.com", companyId: "ACME", user: "svc", password: "pw" }, { transport: t });
    expect(t.calls[0].url).toBe("https://api4.successfactors.com/odata/v2/$metadata"); expect(t.calls[0].opts.auth).toEqual({ user: "svc@ACME", password: "pw" });
    expect(sch[0].name).toBe("SFOData"); expect(sch[0].tables.map((x) => x.name)).toEqual(["EmpJob", "PerPerson"]);
    expect(sch[0].tables[1].columns[0]).toEqual({ name: "personIdExternal", type_text: "STRING", nullable: false, isPK: true, comment: "Person ID" });
    const f = await inspectSuccessFactors({ apiHost: "https://api4.successfactors.com/", user: "svc@ACME", password: "pw", entityFilter: "emp" }, { transport: t });
    expect(f[0].tables.map((x) => x.name)).toEqual(["EmpJob"]); expect(t.calls[1].opts.auth.user).toBe("svc@ACME");
  });
});

const AVRO = { type: "record", name: "Claim", doc: "Claim events", fields: [
  { name: "claimId", type: "string" }, { name: "amount", type: { type: "bytes", logicalType: "decimal", precision: 12, scale: 2 } },
  { name: "closedAt", type: ["null", { type: "long", logicalType: "timestamp-millis" }], default: null, doc: "when closed" },
  { name: "policy", type: { type: "record", name: "Policy", fields: [{ name: "policyNo", type: "string" }, { name: "tags", type: { type: "array", items: "string" } }] } }] };
const JSONS = { $schema: "x", title: "Payment", type: "object", required: ["id"], properties: { id: { type: "integer" }, note: { type: ["string", "null"], description: "free text" },
  payee: { type: "object", properties: { iban: { type: "string" } } }, lines: { type: "array", items: { type: "number" } } } };
const PROTO = 'syntax = "proto3"; package x; message Address { string city = 1; } message Sales { string id = 1; optional string name = 2; repeated string emails = 3; Address address = 4; }';

describe("Kafka Schema Registry", () => {
  const routes = [
    ["/subjects/claims-value/versions/latest", { body: { id: 7, version: 3, schemaType: "AVRO", schema: JSON.stringify(AVRO) } }],
    ["/subjects/claims-key/versions/latest", { body: { id: 6, version: 1, schema: '"string"' } }],
    ["/subjects/payments-value/versions/latest", { body: { id: 9, version: 2, schemaType: "JSON", schema: JSON.stringify(JSONS) } }],
    ["/subjects/customers-value/versions/latest", { body: { id: 11, version: 1, schemaType: "PROTOBUF", schema: PROTO } }],
    ["/subjects", { body: ["payments-value", "claims-value", "claims-key", "customers-value"] }],
  ];
  it("flattens Avro, JSON Schema and Protobuf subjects into topics with key columns first", async () => {
    const t = fakeTransport(routes);
    const reg = (await inspectSchemaRegistry({ url: "schema-registry.example.com:8081", user: "key", password: "secret" }, { transport: t }))[0];
    expect(reg.name).toBe("topics"); expect(t.calls[0].url).toBe("https://schema-registry.example.com:8081/subjects"); expect(t.calls[0].opts.auth).toEqual({ user: "key", password: "secret" });
    const topics = Object.fromEntries(reg.tables.map((x) => [x.name, x]));
    expect(Object.keys(topics)).toEqual(["claims", "customers", "payments"]); expect(reg.tables.every((x) => x.type === "TOPIC")).toBe(true);
    const cl = topics.claims;
    expect(cl.columns.map((c) => c.name)).toEqual(["key.key", "claimId", "amount", "closedAt", "policy.policyNo", "policy.tags"]);
    expect(cl.columns[0]).toMatchObject({ isPK: true, nullable: false, type_text: "STRING" });
    expect(cl.columns[2].type_text).toBe("DECIMAL(12,2)"); expect(cl.columns[3]).toMatchObject({ nullable: true, comment: "when closed", type_text: "TIMESTAMP-MILLIS" });
    expect(cl.columns[5].type_text).toBe("ARRAY<STRING>");
    expect(cl.comment).toBe("Claim events [key: AVRO id 6 v1 · value: AVRO id 7 v3]");
    const pn = Object.fromEntries(topics.payments.columns.map((c) => [c.name, c]));
    expect(Object.keys(pn).sort()).toEqual(["id", "lines", "note", "payee.iban"]); expect(pn.id.nullable).toBe(false); expect(pn.note.nullable).toBe(true); expect(pn.lines.type_text).toBe("ARRAY<NUMBER>");
    expect(topics.payments.comment).toBe("Payment [value: JSON id 9 v2]");
    const cu = topics.customers;
    expect(cu.columns.map((c) => c.name)).toEqual(["id", "name", "emails", "address.city"]); expect(cu.columns[2].type_text).toBe("REPEATED STRING"); expect(cu.columns[1].nullable).toBe(true);
  });
  it("filters subjects and reports errors", async () => {
    const t = fakeTransport(routes);
    expect((await inspectSchemaRegistry({ url: "https://r", subjectFilter: "pay" }, { transport: t }))[0].tables.map((x) => x.name)).toEqual(["payments"]);
    await expect(inspectSchemaRegistry({ url: "https://r", subjectFilter: "zzz" }, { transport: t })).rejects.toThrow("No subjects found in the schema registry matching 'zzz'");
    await expect(inspectSchemaRegistry({ url: "https://r" }, { transport: fakeTransport([["/subjects", { status: 403, text: "" }]]) })).rejects.toThrow("refused the credentials (HTTP 403)");
    expect(avroType({ type: "map", values: "int" })).toBe("MAP<STRING,int>"); expect(avroType({ type: "enum", symbols: ["A", "B"] })).toBe("ENUM(A,B)"); expect(avroType({ type: "fixed", size: 16 })).toBe("FIXED(16)");
    expect(protoFields("nothing here")).toEqual([]);
  });
});

const SCAN = { workspaces: [{ id: "w1", name: "Claims Analytics", datasets: [
  { id: "d1", name: "Claims Model", description: "Certified model", tables: [
    { name: "FactClaims", columns: [{ name: "ClaimId", dataType: "Int64" }, { name: "Amount", dataType: "Decimal", description: "paid amount" }, { name: "Hidden", dataType: "String", isHidden: true }],
      measures: [{ name: "Total Paid", expression: "SUM(FactClaims[Amount])", description: "sum" }], source: [{ expression: 'let Source = Sql.Database("sql01", "claims") in Source' }] },
    { name: "DimPolicy", columns: [{ name: "PolicyNo", dataType: "String" }] }],
    upstreamDatasources: [{ datasourceType: "Sql", connectionDetails: { server: "sql01", database: "claims" } }] }],
  reports: [{ id: "r1", name: "Claims Overview", datasetId: "d1", description: "monthly" }, { id: "r2", name: "Orphan", datasetId: "zz", datasetWorkspaceId: "w9" }] }] };

describe("Power BI scanner", () => {
  const routes = (statusSeq) => [
    ["login.microsoftonline.com", { body: { access_token: "tok" } }],
    ["admin/groups", { body: { value: [{ id: "w1", name: "Claims Analytics", type: "Workspace" }, { id: "p1", name: "My workspace", type: "PersonalGroup" }] } }],
    ["admin/workspaces/getInfo", { status: 202, body: { id: "scan1" } }],
    ["admin/workspaces/scanStatus/scan1", () => ({ body: statusSeq.shift() })],
    ["admin/workspaces/scanResult/scan1", { body: SCAN }],
  ];
  it("token → groups → getInfo → scanStatus → scanResult; datasets, measures, reports, lineage", async () => {
    const t = fakeTransport(routes([{ status: "Running" }, { status: "Succeeded" }]));
    const slept = [];
    const bundle = await inspectPowerBi({ tenantId: "tenant", clientId: "client", clientSecret: "secret" }, { transport: t, sleep: async (ms) => slept.push(ms) });
    expect(t.calls[0].opts.form).toMatchObject({ grant_type: "client_credentials", client_id: "client", scope: "https://analysis.windows.net/powerbi/api/.default" });
    expect(t.calls[1].opts.bearer).toBe("tok"); expect(t.calls.filter((c) => c.url.includes("scanStatus"))).toHaveLength(2); expect(slept).toEqual([2000]);
    expect(t.calls.find((c) => c.url.includes("getInfo")).opts.json).toEqual({ workspaces: ["w1"] });
    expect(bundle.databases.map((d) => d.name)).toEqual(["Claims Analytics"]);
    const ws = bundle.databases[0];
    expect(ws.layerHint).toBe("reports gold"); expect(ws.comment).toBe("Power BI workspace Claims Analytics");
    expect(ws.schemas.map((s) => s.name)).toEqual(["Claims Model", "Reports"]); expect(ws.schemas[0].comment).toBe("Certified model Data sources: Sql:sql01");
    const f = ws.schemas[0].tables[0];
    expect(f.columns.map((c) => c.name)).toEqual(["ClaimId", "Amount", "Total Paid"]); expect(f.columns[2]).toEqual({ name: "Total Paid", type_text: "MEASURE", nullable: true, isPK: false, comment: "sum [SUM(FactClaims[Amount])]" });
    expect(f.columns[0]).toEqual({ name: "ClaimId", type_text: "INT64", nullable: true, isPK: false, comment: "" });
    expect(f.comment).toBe('Source: let Source = Sql.Database("sql01", "claims") in Source');
    const reps = ws.schemas[1].tables;
    expect(reps.map((x) => x.name)).toEqual(["Claims Overview", "Orphan"]); expect(reps[0]).toMatchObject({ type: "REPORT", comment: "monthly Dataset: Claims Model" }); expect(reps[1].comment).toBe("Dataset in another workspace (zz)");
    expect([...bundle.lineage].sort()).toEqual([["Claims Analytics.Claims Model.DimPolicy", "Claims Analytics.Reports.Claims Overview"], ["Claims Analytics.Claims Model.FactClaims", "Claims Analytics.Reports.Claims Overview"]]);
  });
  it("filters workspaces (name, id, prefix*) and reports failures", async () => {
    await expect(inspectPowerBi({ token: "t", workspaces: "Nope" }, { transport: fakeTransport(routes([])), sleep: async () => {} })).rejects.toThrow("No workspaces found matching 'Nope'");
    const b = await inspectPowerBi({ token: "t", workspaces: "claims*", includeReports: false }, { transport: fakeTransport(routes([{ status: "Succeeded" }])), sleep: async () => {} });
    expect(b.databases[0].schemas.map((s) => s.name)).toEqual(["Claims Model"]); expect(b.lineage).toEqual([]);
    await expect(inspectPowerBi({ token: "t" }, { transport: fakeTransport(routes([{ status: "Failed", error: "x" }])), sleep: async () => {} })).rejects.toThrow("Scanner API scan failed");
    await expect(inspectPowerBi({ token: "t" }, { transport: fakeTransport([["admin/groups", { status: 403, text: "" }]]), sleep: async () => {} })).rejects.toThrow("Tenant.Read.All");
  });
});

describe("Informatica EDC", () => {
  const item = (id, cls, facts) => ({ id, values: Object.entries(facts).map(([k, v]) => ({ attributeId: `${cls}.${k}`, value: v })) });
  const search = (q) => {
    const ct = /core\.classType:([\w.]+)/.exec(q)[1].split(".").pop();
    const data = {
      Table: [item("edc://CLAIMS/dbo/Claims", "core", { name: "Claims", description: "claim header" }), item("edc://CLAIMS/dbo/Alpha", "core", { name: "Alpha" })],
      View: [item("edc://CLAIMS/rep/vClaims", "core", { name: "vClaims" })],
      Column: [item("edc://CLAIMS/dbo/Claims/amount", "com.infa.ldm.relational", { name: "amount", datatype: "decimal", nullable: "NO", position: "2" }),
        item("edc://CLAIMS/dbo/Claims/id", "com.infa.ldm.relational", { name: "id", datatype: "int", PrimaryKeyColumn: "true", position: "1", description: "key" }),
        item("edc://CLAIMS/dbo/Claims/note", "com.infa.ldm.relational", { name: "note", position: "10" })],
      ViewColumn: [item("edc://CLAIMS/rep/vClaims/id", "com.infa.ldm.relational", { name: "id", datatype: "int" })],
    }[ct];
    return { body: { items: data, totalCount: data.length } };
  };
  it("builds schemas from hierarchical ids with ordered columns, views and schema filter", async () => {
    const t = fakeTransport([["/access/2/catalog/data/search", (u, o) => search(o.params.q)]]);
    const sch = await inspectInformatica({ url: "https://edc.example.com:9085/", user: "LDAP/jdoe", password: "pw", resource: "CLAIMS" }, { transport: t });
    expect(t.calls[0].opts.params.q).toBe('core.classType:com.infa.ldm.relational.Table AND core.resourceName:"CLAIMS"'); expect(t.calls[0].opts.auth.user).toBe("LDAP/jdoe");
    expect(sch.map((s) => s.name)).toEqual(["dbo", "rep"]);
    expect(sch[0].tables.map((x) => x.name)).toEqual(["Alpha", "Claims"]);
    const c = sch[0].tables[1];
    expect(c).toMatchObject({ type: "TABLE", comment: "claim header" });
    expect(c.columns).toEqual([
      { name: "id", type_text: "INT", nullable: true, comment: "key", isPK: true },
      { name: "amount", type_text: "DECIMAL", nullable: false, comment: "", isPK: false },
      { name: "note", type_text: "STRING", nullable: true, comment: "", isPK: false },
    ]);
    expect(sch[1].tables[0]).toMatchObject({ name: "vClaims", type: "VIEW" }); expect(sch[1].tables[0].columns[0].name).toBe("id");
    expect((await inspectInformatica({ url: "https://edc.example.com:9085", schema: "REP" }, { transport: t })).map((s) => s.name)).toEqual(["rep"]);
    await expect(inspectInformatica({ url: "https://edc" }, { transport: fakeTransport([["search", { status: 401, text: "" }]]) })).rejects.toThrow("authentication failed (401)");
  });
});

describe("inspectNative dispatcher", () => {
  it("validates bodies like the inspector route and wraps results", async () => {
    expect(NATIVE_MODES).toEqual(["odata", "successfactors", "kafka", "powerbi", "informatica"]);
    await expect(inspectNative({ mode: "odata" })).rejects.toMatchObject({ status: 400, message: /OData service URL is required/ });
    await expect(inspectNative({ mode: "successfactors", apiHost: "x", user: "u" })).rejects.toMatchObject({ status: 400, message: /user@companyId and password/ });
    await expect(inspectNative({ mode: "informatica", url: "edc:9085" })).rejects.toMatchObject({ status: 400 });
    await expect(inspectNative({ mode: "powerbi" })).rejects.toMatchObject({ status: 400 });
    await expect(inspectNative({ mode: "duckdb" })).rejects.toMatchObject({ status: 400, message: /mode must be one of/ });
    const t = fakeTransport([["$metadata", { text: V4 }]]);
    const out = await inspectNative({ mode: "odata", url: "https://s4/api", tlsVerify: false }, { transport: t });
    expect(out.schemas[0].tables).toHaveLength(2); expect(t.calls[0].opts.tlsVerify).toBe(false);
    const k = await inspectNative({ mode: "kafka", url: "r", schema: " events " }, { transport: fakeTransport([["/subjects/", { body: { id: 1, version: 1, schema: '"long"' } }], ["/subjects", { body: ["a-value"] }]]) });
    expect(k.schemas[0].name).toBe("events"); expect(k.schemas[0].tables[0].columns).toEqual([{ name: "value", type_text: "LONG", nullable: false, comment: "", isPK: false }]);
  });
});
