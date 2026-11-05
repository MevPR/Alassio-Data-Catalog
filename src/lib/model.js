/* Alassio Data Catalog — model constants & pure helpers */
export const uid = () => Math.random().toString(36).slice(2, 10);

export const APP_VERSION = "1.79.7";
export const PRODUCT = "Alassio Data Catalog";

/* Connection profile remembered per database (never contains passwords or tokens). */
export const sourceLabel = (ref) => {
  if (!ref) return "";
  if (ref.kind === "unity") return `Unity Catalog · ${ref.host}${ref.catalog ? ` / ${ref.catalog}` : ""}`;
  if (ref.kind === "duckdb") return `DuckDB · ${ref.path}${ref.schema ? ` / ${ref.schema}` : ""}`;
  if (ref.kind === "jdbc") return `JDBC · ${ref.url}`;
  if (ref.kind === "informatica") return `Informatica · ${ref.url}${ref.resource ? ` / ${ref.resource}` : ""}`;
  if (ref.kind === "successfactors") return `SuccessFactors · ${ref.url}${ref.companyId ? ` / ${ref.companyId}` : ""}`;
  if (ref.kind === "lakefiles") return `Lake files · ${(ref.paths || [])[0] || ""}${(ref.paths || []).length > 1 ? ` (+${ref.paths.length - 1})` : ""}`;
  if (ref.kind === "odata") return `OData · ${ref.url}`;
  if (ref.kind === "kafka") return `Schema Registry · ${ref.url}${ref.subjectFilter ? ` / ${ref.subjectFilter}` : ""}`;
  if (ref.kind === "powerbi") return `Power BI · ${ref.tenantId || "tenant"}${ref.workspaces ? ` / ${ref.workspaces}` : ""}`;
  if (ref.kind === "dbt") return `dbt · ${ref.project || ref.file || "manifest.json"}`;
  if (ref.kind === "odcs") return `Data contract · ${ref.file || ref.contract || "ODCS"}`;
  if (ref.kind === "sqlalchemy") return `${ref.typeLabel || ref.type || "SQLAlchemy"} · ${ref.url ? ref.url.replace(/\/\/[^@]*@/, "//") : `${ref.host}${ref.port ? `:${ref.port}` : ""}${ref.database ? `/${ref.database}` : ""}`}`;
  return ref.kind || "";
};
export const sourceKey = (ref) => sourceLabel(ref).toLowerCase();

export const SENSITIVITY = ["Public", "Internal", "Confidential", "PII"];
export const CLASSIFICATION = ["C1", "C2", "C3", "C4"];
export const TABLE_TYPES = ["TABLE", "VIEW", "MATERIALIZED VIEW", "EXTERNAL", "FILE", "TOPIC", "REPORT"];

/* Data hub (the level between Data Hub Type and Database) — free text, e.g. SALES_DE.
   The field is still called `country` in the data model for compatibility (values like DE / GLOBAL keep working). */
export const normCountry = (c) => {
  const v = String(c || "").trim().replace(/\s+/g, " ").slice(0, 64);
  return v || "GLOBAL";
};
export const normDataHub = normCountry;
export const UC_LINEAGE_NOTE = "This table was imported from Unity Catalog — its lineage is managed in Databricks and refreshed on import; it cannot be edited here.";

export const csvHeader = (h) => String(h || "").replace(/^\ufeff/, "").trim().toLowerCase().replace(/[\s-]+/g, "_");

export const LAYERS = ["bronze", "silver", "gold", "other"];
export const LAYER_COLOR = {
  source: "#0F766E", bronze: "#9C5B21", silver: "#5F6B73", gold: "#A8790A", other: "#6B6B68" };
export const guessLayer = (schemaName = "", tableName = "", tags = "") => {
  const s = `${schemaName} ${tableName} ${tags}`.toLowerCase();
  if (/bronze|raw|landing|ingest/.test(s)) return "bronze";
  if (/silver|cleansed|refined|stg|staging/.test(s)) return "silver";
  if (/gold|mart|reporting|consum|bi[_-]/.test(s)) return "gold";
  return "other";
};

/* v1.78: neutral example data hub types for a new deployment (rename them to the company's own segments); existing
   catalogs keep their hub types — these are only used to seed an empty catalog. Finance, HR and Sales exist in every
   company (owner's choice, 2026-10-28). */
export const DEFAULT_HUBS = [
  { id: "finance", name: "Finance", description: "Finance, accounting and controlling data.", ownerId: null, stewardId: null },
  { id: "hr", name: "HR", description: "Human resources: employees, organisation, payroll and recruiting data.", ownerId: null, stewardId: null },
  { id: "sales", name: "Sales", description: "Customers, sales, marketing and service data.", ownerId: null, stewardId: null },
];

/* the SOURCE hub type is recognised by its name (it may have been created before v1.64.1 with another id) */
export const isSourceHubName = (name) => String(name || "").trim().toUpperCase() === "SOURCE";
export const isSourceHub = (h) => isSourceHubName(h?.name);
export const SOURCE_HUB = { id: "source", name: "SOURCE", description: "Source systems loaded from generic data sources (DB2, MySQL, SAP, Informatica, …).", ownerId: null, stewardId: null };

export const seed = () => {
  const p1 = { id: "p1", name: "Amira Osei", email: "amira.osei@company.example" };
  const p2 = { id: "p2", name: "Jonas Weber", email: "jonas.weber@company.example" };
  const p3 = { id: "p3", name: "Priya Nair", email: "priya.nair@company.example" };
  const hubs = structuredClone(DEFAULT_HUBS);
  const hs = hubs.find((h) => h.id === "sales"); hs.ownerId = "p1"; hs.stewardId = "p2";   /* the hub type of the sample database */
  /* v1.64.1: a new deployment starts with the SOURCE hub (generic source systems) — listed last in the catalog tree */
  hubs.push(structuredClone(SOURCE_HUB));
  const dom = { id: "d1", name: "Motor", description: "Motor insurance policies, claims and tariffs.", ownerId: "p1", stewardId: "p2" };
  const db = { id: "db1", name: "motor_prod", hubId: "sales", country: "DE", layer: "bronze", domainId: "d1", description: "Production motor insurance warehouse on PostgreSQL 16.", source: "manual" };
  const sc = { id: "sc1", databaseId: "db1", name: "policy", description: "Policy administration data." };
  const tb = {
    id: "tb1", schemaId: "sc1", name: "policies", type: "TABLE",
    description: "One row per motor insurance policy version.",
    businessDefinition: "A policy is a contract between the company and a policyholder covering one or more vehicles.",
    stewardId: "p2", tags: "core, golden-record", layer: "bronze"
  };
  const attrs = [
    { id: "a1", tableId: "tb1", name: "policy_id", dataType: "BIGINT", nullable: false, isPK: true, description: "Surrogate key.", businessTerm: "Policy number", sensitivity: "Internal" },
    { id: "a2", tableId: "tb1", name: "holder_email", dataType: "VARCHAR(320)", nullable: true, isPK: false, description: "Policyholder contact address.", businessTerm: "Policyholder e-mail", sensitivity: "PII" },
    { id: "a3", tableId: "tb1", name: "inception_date", dataType: "DATE", nullable: false, isPK: false, description: "Start of cover.", businessTerm: "Inception date", sensitivity: "Internal" },
  ];
  return { hubs, people: [p1, p2, p3], domains: [dom], databases: [db], schemas: [sc], tables: [tb], attributes: attrs, lineage: [], sourceHubInit: true };
};

/* keeps older saved catalogs working after the Data Hub level was added */
export const migrate = (s) => {
  if (!s.hubs || !s.hubs.length) s.hubs = structuredClone(DEFAULT_HUBS);
  for (const d of s.databases || []) { if (!d.hubId) d.hubId = "central"; if (!d.country) d.country = "GLOBAL"; }
  /* v1.4: SOURCE hub for generic source systems — created once */
  if (!s.sourceHubInit) {
    if (!s.hubs.some(isSourceHub)) {
      s.hubs.push(structuredClone(SOURCE_HUB));
    }
    s.sourceHubInit = true;
  }
  if (!s.lineage) s.lineage = [];
  if (!s.glossary) s.glossary = [];
  /* v1.3.1: medallion layer lives on the database. Missing → guess from name, else majority of legacy table layers */
  for (const d of s.databases || []) if (!d.layer) {
    let l = guessLayer(d.name);
    if (l === "other") {
      const cnt = {};
      for (const sc of (s.schemas || []).filter((x) => x.databaseId === d.id))
        for (const t of (s.tables || []).filter((x) => x.schemaId === sc.id)) if (t.layer && t.layer !== "other") cnt[t.layer] = (cnt[t.layer] || 0) + 1;
      l = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0] || "other";
    }
    d.layer = l;
  }
  /* v1.38: every data hub type keeps the list of its data hubs (free-text groups of databases) */
  for (const h of s.hubs || []) {
    h.dataHubs = Array.isArray(h.dataHubs) ? h.dataHubs : [];
    for (const name of new Set((s.databases || []).filter((d) => d.hubId === h.id).map((d) => normCountry(d.country)))) {
      if (!h.dataHubs.some((x) => x.name === name)) h.dataHubs.push({ name, description: "" });
    }
  }
  /* v1.39: data hub types have no owner — a former type owner becomes the BPO of the type's data hubs that have none yet */
  for (const h of s.hubs || []) {
    for (const dh of h.dataHubs || []) if (!dh.bpoId && h.ownerId) dh.bpoId = h.ownerId;
    if (h.ownerId) h.ownerId = null;
  }
  /* v1.20: hubs have owners only — steward responsibilities live on domains, databases, schemas and tables */
  for (const h of s.hubs || []) if (h.stewardId) h.stewardId = null;
  /* v1.18: databases in the SOURCE hub are always layer "other" */
  const srcHub = (s.hubs || []).find(isSourceHub);
  if (srcHub) for (const d of s.databases || []) if (d.hubId === srcHub.id && d.layer !== "other") d.layer = "other";
  return s;
};

export const UNITY_SAMPLE = {
  catalog: "main",
  schemas: [
    {
      name: "bronze",
      tables: [
        {
          name: "raw_claims", type: "TABLE", comment: "Raw claim events landed from Kafka.",
          columns: [
            { name: "payload", type_text: "STRING", nullable: true },
            { name: "ingested_at", type_text: "TIMESTAMP", nullable: false },
          ],
        },
        {
          name: "raw_payments", type: "TABLE", comment: "Raw payment records from the core system.",
          columns: [
            { name: "payload", type_text: "STRING", nullable: true },
            { name: "ingested_at", type_text: "TIMESTAMP", nullable: false },
          ],
        },
      ],
    },
    {
      name: "silver",
      tables: [
        {
          name: "claims", type: "TABLE", comment: "Cleansed claim events.",
          columns: [
            { name: "claim_id", type_text: "BIGINT", nullable: false },
            { name: "policy_id", type_text: "BIGINT", nullable: false },
            { name: "loss_date", type_text: "DATE", nullable: false },
            { name: "reserve_eur", type_text: "DECIMAL(12,2)", nullable: true },
          ],
        },
        {
          name: "payments", type: "TABLE", comment: "Settled claim payments.",
          columns: [
            { name: "payment_id", type_text: "BIGINT", nullable: false },
            { name: "claim_id", type_text: "BIGINT", nullable: false },
            { name: "paid_at", type_text: "TIMESTAMP", nullable: true },
          ],
        },
      ],
    },
    {
      name: "gold",
      tables: [
        {
          name: "loss_ratio_monthly", type: "VIEW", comment: "Monthly loss ratio per line of business.",
          columns: [
            { name: "month", type_text: "DATE", nullable: false },
            { name: "line_of_business", type_text: "STRING", nullable: false },
            { name: "loss_ratio", type_text: "DECIMAL(6,4)", nullable: false },
          ],
        },
      ],
    },
  ],
  lineage: [
    ["main.bronze.raw_claims", "main.silver.claims"],
    ["main.bronze.raw_payments", "main.silver.payments"],
    ["main.silver.claims", "main.gold.loss_ratio_monthly"],
    ["main.silver.payments", "main.gold.loss_ratio_monthly"],
  ],
};

/* ───────────────────────── naming helpers ───────────────────────── */
export const slugName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 40) || "product";
export const initials = (n) => n.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
