/* Source-import registry (v1.70). One entry per selectable source system. The connector behaviour that used to be
   spread over five kind-dispatch chains in SourceModalC (request body, recorded reference, "Load" test, restore,
   JSX) now sits on the entry, so adding a connector means adding one entry here (plus the server side):
     kind              connector family ("sqlalchemy" dialects share one implementation)
     fields            the form keys this connector uses, with defaults — the modal's form is the union of all of them
     ui                declarative field spec rendered by SourceModalC's <SpecFields> (notices, rows, inputs, selects,
                       checks, textareas, files, `when` groups); every label / placeholder / text goes through t()
     toBody(form)      body for POST /api/source-import/inspect — for `upload` connectors the server payload instead,
                       still holding the File objects (the modal reads them to text before the call)
     toRef(form)       the source reference recorded on the import (never contains secrets); type + kind are stamped
     isValid(form)     the "Load" button test (the catalog name is checked separately, see effectiveName)
     fromRef(ref)      form patch that restores a previously recorded reference
     defaultName(form) catalog name proposed when none is typed (optional)
     system            source-system name shown on the imported database
     bundle / upload   bundle: several databases + lineage via onImportBundle; upload: files parsed on the server
   Pure module (no React) — see test/unit/source-types.test.js. */

const enc = encodeURIComponent;
/* translation marker: identity here — SourceModalC translates every label, placeholder and text at render time.
   The wrapper keeps the strings visible to the i18n coverage audit (test/unit/i18n-coverage.test.js). Strings that
   deliberately have no translation stay unwrapped. */
const t = (s) => s;
const trim = (s) => String(s ?? "").trim();
const opt = (s) => trim(s) || undefined;

/* ---- field spec builders ---------------------------------------------------------------------------------------- */
const input = (key, label, o = {}) => ({ input: key, label, ...o });        /* o: placeholder, password, aria */
const pw = (key, label, o = {}) => input(key, label, { password: true, ...o });
const row = (...items) => ({ row: items });
const notice = (text) => ({ notice: text });
const sub = (text) => ({ sub: text });
const check = (key, label, o = {}) => ({ check: key, label, ...o });        /* o: invert (checked = !value) */
const select = (key, label, options) => ({ select: key, label, options });
const textarea = (key, label, o = {}) => ({ textarea: key, label, ...o });  /* o: rows, placeholder */
const file = (key, label, o = {}) => ({ file: key, label, ...o });          /* o: aria, accept, multiple */
const when = (test, ...items) => ({ when: test, items });
const userPw = (userLabel = t("User")) => row(input("user", userLabel), pw("password", t("Password")));
const tlsCheck = check("tlsVerify", t("Skip TLS certificate verification"), { invert: true });

/* ---- pure helpers ------------------------------------------------------------------------------------------------ */
export const duckdbBaseName = (path) => trim(path).split(/[\\/]/).pop().replace(/\.(duckdb|db|ddb)$/i, "");
export const splitPaths = (text) => String(text ?? "").split("\n").map((p) => p.trim()).filter(Boolean);
export const lakeBaseName = (text) => (splitPaths(text)[0] || "").replace(/^[a-z0-9]+:\/\//i, "").split(/[\\/]/).filter((p) => p && !/[*?[]/.test(p))[0] || "";
const lakeCredentials = (f) => f.lakeAuth === "azure-cs" ? { azureConnectionString: f.azureConnectionString }
  : f.lakeAuth === "azure-acc" ? { azureAccount: f.azureAccount, azureSas: f.azureSas, azureKey: f.azureKey }
  : f.lakeAuth === "s3" ? { s3Key: f.s3Key, s3Secret: f.s3Secret, s3Region: f.s3Region, s3Endpoint: f.s3Endpoint } : {};
const CREDS = { host: "", port: "", user: "", password: "", database: "", schema: "" };
const tls = (ref) => ({ tlsVerify: ref.tlsVerify !== false });

/* ---- connector families: (entry) => the per-kind part of the registry entry ------------------------------------- */
const CONNECTORS = {
  duckdb: () => ({
    fields: { duckPath: "", duckRO: true, schema: "" },
    ui: [
      notice(t("Reads a DuckDB database file that is stored on the catalog server (the inspector host): tables, views, columns, primary keys and COMMENT ON texts. The file is opened read-only — nothing is written back.")),
      input("duckPath", t("DuckDB file path on the server"), { placeholder: "/opt/datahub-catalog/duckdb/warehouse.duckdb" }),
      row(input("schema", t("Schema (optional — restrict to one)"), { placeholder: "main" })),
      check("duckRO", t("Open read-only (recommended; required while another process writes the file)")),
      sub(t("The inspector service must be able to read the file (user datahub-catalog). Copy or symlink exports into a directory such as /opt/datahub-catalog/duckdb/. Requires the Python package duckdb in the inspector's virtualenv.")),
    ],
    toBody: (f) => ({ mode: "duckdb", path: trim(f.duckPath), schema: opt(f.schema), readOnly: f.duckRO }),
    toRef: (f) => ({ kind: "duckdb", path: trim(f.duckPath), schema: opt(f.schema), readOnly: f.duckRO }),
    isValid: (f) => !!trim(f.duckPath),
    fromRef: (r) => ({ duckPath: r.path || "", duckRO: r.readOnly !== false }),
    defaultName: (f) => duckdbBaseName(f.duckPath),
  }),
  lakefiles: () => ({
    fields: { lakePaths: "", lakeFormat: "auto", lakeAuth: "none", azureConnectionString: "", azureAccount: "", azureSas: "", azureKey: "", s3Key: "", s3Secret: "", s3Region: "", s3Endpoint: "", schema: "" },
    ui: [
      notice(t("Reads the schema of files with DuckDB — every path or glob becomes a table (type FILE) with its columns and types. Works for local paths on the inspector host, s3:// (S3, MinIO) and az:// / abfss:// (Azure Data Lake). Nothing is written.")),
      textarea("lakePaths", t("Paths, globs or URLs — one per line"), { rows: 4, placeholder: "s3://lake/bronze/claims/*.parquet\nabfss://bronze@storageacct.dfs.core.windows.net/policies/\n/opt/datahub-catalog/lake/events.jsonl" }),
      row(
        select("lakeFormat", t("Format"), [["auto", "Auto (from extension; Delta for .delta / _delta_log)"], ["parquet", "Parquet"], ["csv", "CSV"], ["json", "JSON / JSON Lines"], ["delta", "Delta Lake (directory)"], ["iceberg", "Iceberg (directory or metadata.json)"]]),
        input("schema", t("Schema name in the catalog"), { placeholder: "files" }),
        select("lakeAuth", t("Credentials"), [["none", "None / public / local files"], ["azure-cs", "Azure connection string"], ["azure-acc", "Azure account + SAS or key"], ["s3", "S3 / MinIO key + secret"]]),
      ),
      when((f) => f.lakeAuth === "azure-cs", pw("azureConnectionString", t("Azure storage connection string"), { placeholder: "DefaultEndpointsProtocol=https;AccountName=…;AccountKey=…" })),
      when((f) => f.lakeAuth === "azure-acc", row(
        input("azureAccount", t("Storage account"), { placeholder: "storageacct" }),
        pw("azureSas", t("SAS token (or leave empty and use the key)")),
        pw("azureKey", t("Account key (optional)")),
      )),
      when((f) => f.lakeAuth === "s3", row(
        input("s3Key", t("Access key ID")),
        pw("s3Secret", t("Secret access key")),
        input("s3Region", t("Region"), { placeholder: "eu-central-1" }),
        input("s3Endpoint", t("Endpoint (MinIO / S3-compatible, optional)"), { placeholder: "https://minio.example.com:9000" }),
      )),
      sub(t("DuckDB loads its httpfs / azure / delta / iceberg extensions on first use — the inspector host needs internet access once. Hive-partitioned directories (year=2024/…) are read with a glob such as path/**/*.parquet. Credentials are used for this request only and never stored.")),
    ],
    toBody: (f) => ({ mode: "lakefiles", paths: splitPaths(f.lakePaths), format: f.lakeFormat, schema: trim(f.schema) || "files", credentials: lakeCredentials(f) }),
    toRef: (f) => ({ kind: "lakefiles", paths: splitPaths(f.lakePaths), format: f.lakeFormat, schema: trim(f.schema) || "files", auth: f.lakeAuth, azureAccount: f.azureAccount || undefined, s3Region: f.s3Region || undefined, s3Endpoint: f.s3Endpoint || undefined }),
    isValid: (f) => splitPaths(f.lakePaths).length > 0,
    fromRef: (r) => ({ lakePaths: (r.paths || []).join("\n"), lakeFormat: r.format || "auto", lakeAuth: r.auth || "none", azureAccount: r.azureAccount || "", s3Region: r.s3Region || "", s3Endpoint: r.s3Endpoint || "" }),
    defaultName: (f) => lakeBaseName(f.lakePaths),
  }),
  /* SQL dialects over SQLAlchemy — the entry supplies tpl(), port and the optional label / field variations */
  sqlalchemy: (T) => {
    const extraKeys = (T.extras || []).map(([k]) => k);
    const extrasOf = (f) => Object.fromEntries(extraKeys.filter((k) => f[k]).map((k) => [k, f[k]]));
    return {
      fields: { ...CREDS, ...Object.fromEntries(extraKeys.map((k) => [k, ""])) },
      ui: [
        row(
          input("host", T.hostLabel || t("Host"), { placeholder: T.hostLabel ? "xy12345.eu-central-1" : t("db.example.com") }),
          ...(T.noPort ? [] : [input("port", t("Port"), { placeholder: T.port })]),
          input("user", t("User")),
          pw("password", t("Password")),
        ),
        row(
          ...(T.noDb ? [] : [input("database", T.dbLabel || t("Database"))]),
          input("schema", t("Schema (optional — restrict to one)")),
          ...(T.extras || []).map(([k, l]) => input(k, l)),
        ),
        ...(T.note ? [sub(T.note)] : []),
      ],
      toBody: (f) => ({ mode: "sqlalchemy", url: T.tpl(f, extrasOf(f)), schema: opt(f.schema) }),
      toRef: (f) => { const x = extrasOf(f); return { kind: "sqlalchemy", typeLabel: T.label, host: f.host, port: f.port || T.port, user: f.user, database: f.database, schema: opt(f.schema), ...(Object.keys(x).length ? { extras: x } : {}) }; },
      isValid: (f) => !!(f.host && f.user && (T.noDb || f.database)),
      fromRef: (r) => ({ ...(r.extras || {}) }),
    };
  },
  url: (T) => ({
    fields: { sqlUrl: "", schema: "" },
    ui: [
      input("sqlUrl", t("SQLAlchemy connection URL"), { placeholder: t("dialect+driver://user:password@host:port/database") }),
      row(input("schema", t("Schema (optional)"))),
      sub(t("Any dialect installed in the inspector service works — e.g. mysql+pymysql, postgresql+psycopg2, mssql+pymssql, oracle+oracledb, snowflake, db2+ibm_db, hana+hdbcli, bigquery, trino.")),
    ],
    toBody: (f) => ({ mode: "sqlalchemy", url: trim(f.sqlUrl), schema: opt(f.schema) }),
    /* the password is cut out of the recorded URL */
    toRef: (f) => ({ kind: "sqlalchemy", typeLabel: T.label, url: trim(f.sqlUrl).replace(/\/\/([^:@\/]*):[^@]*@/, "//$1@"), schema: opt(f.schema) }),
    isValid: (f) => f.sqlUrl.includes("://"),
    fromRef: (r) => (r.url ? { sqlUrl: r.url } : {}),
  }),
  jdbc: () => ({
    fields: { jdbcUrl: "", driverClass: "", jar: "", user: "", password: "", schema: "" },
    ui: [
      input("jdbcUrl", t("JDBC URL"), { placeholder: t("jdbc:db2://host:50000/CLAIMS") }),
      row(input("driverClass", t("Driver class"), { placeholder: t("com.ibm.db2.jcc.DB2Driver") }), input("jar", t("Driver .jar (file name on the server)"), { placeholder: t("db2jcc4.jar") })),
      row(input("user", t("User")), pw("password", t("Password")), input("schema", t("Schema (optional)"))),
      sub(t("The driver .jar must be copied to the server first: /opt/datahub-catalog/jdbc-drivers/ (see README). Introspection uses the standard JDBC DatabaseMetaData API and works with any compliant driver.")),
    ],
    toBody: (f) => ({ mode: "jdbc", url: trim(f.jdbcUrl), driverClass: trim(f.driverClass), jar: trim(f.jar), user: f.user, password: f.password, schema: opt(f.schema) }),
    toRef: (f) => ({ kind: "jdbc", url: trim(f.jdbcUrl), driverClass: trim(f.driverClass), jar: trim(f.jar), user: f.user, schema: opt(f.schema) }),
    isValid: (f) => !!(f.jdbcUrl.startsWith("jdbc:") && trim(f.driverClass) && trim(f.jar)),
    fromRef: (r) => ({ jdbcUrl: r.url || "", driverClass: r.driverClass || "", jar: r.jar || "" }),
  }),
  informatica: () => ({
    fields: { infaUrl: "", resource: "", user: "", password: "", schema: "", tlsVerify: true },
    ui: [
      input("infaUrl", t("Catalog base URL"), { placeholder: "https://edc.example.com:9085" }),
      row(input("user", t("User (LDAP: domain/user)"), { placeholder: t("Native/admin") }), pw("password", t("Password"))),
      row(input("resource", t("Resource (optional — one source system)"), { placeholder: t("e.g. ORACLE_CLAIMS") }), input("schema", t("Schema (optional)"))),
      check("tlsVerify", "Skip TLS certificate verification (self-signed certificates)", { invert: true }),   /* untranslated, as before */
      sub(t("Uses the Catalog Search API (/access/2/catalog/data/search) with pagination: relational tables, views and their columns — data types, nullability, primary keys and descriptions included. Without a resource filter, all relational resources of the catalog are loaded.")),
    ],
    toBody: (f) => ({ mode: "informatica", url: trim(f.infaUrl), user: f.user, password: f.password, resource: opt(f.resource), schema: opt(f.schema), tlsVerify: f.tlsVerify }),
    toRef: (f) => ({ kind: "informatica", url: trim(f.infaUrl), user: f.user, resource: opt(f.resource), schema: opt(f.schema), tlsVerify: f.tlsVerify }),
    isValid: (f) => !!(f.infaUrl.startsWith("http") && f.user),
    fromRef: (r) => ({ infaUrl: r.url || "", resource: r.resource || "", ...tls(r) }),
  }),
  successfactors: () => ({
    fields: { sfHost: "https://api4.successfactors.com", sfCompany: "", sfToken: "", sfFilter: "", user: "", password: "", tlsVerify: true },
    ui: [
      notice(t("Loads the OData entity model (every entity becomes a table, properties become attributes with SAP labels as descriptions). Read-only: the catalog never writes back to SuccessFactors.")),
      row(input("sfHost", t("API host"), { placeholder: "https://api4.successfactors.com" }), input("sfCompany", t("Company ID"), { placeholder: t("e.g. ACME01") })),
      row(input("user", t("API user"), { placeholder: "apiuser (company ID is appended)" }), pw("password", t("Password"))),
      row(pw("sfToken", t("… or bearer token (OAuth, obtained outside the catalog)")), input("sfFilter", t("Entity filter (optional prefix, e.g. Per, Emp, FO)"))),
      tlsCheck,
    ],
    toBody: (f) => ({ mode: "successfactors", apiHost: trim(f.sfHost), companyId: trim(f.sfCompany), user: f.user, password: f.password, token: opt(f.sfToken), entityFilter: opt(f.sfFilter), tlsVerify: f.tlsVerify }),
    toRef: (f) => ({ kind: "successfactors", url: trim(f.sfHost), companyId: opt(f.sfCompany), user: f.user, entityFilter: opt(f.sfFilter), tlsVerify: f.tlsVerify }),
    isValid: (f) => !!(trim(f.sfHost) && (trim(f.sfToken) || (f.user && f.password))),
    fromRef: (r) => ({ sfHost: r.url || "", sfCompany: r.companyId || "", sfFilter: r.entityFilter || "", ...tls(r) }),
  }),
  odata: () => ({
    fields: { odUrl: "", odToken: "", sapClient: "", odEntityFilter: "", user: "", password: "", tlsVerify: true },
    ui: [
      notice(t("Reads the $metadata document of any OData v2 or v4 service: entity types become tables (one schema per EDM namespace), properties become attributes, keys become primary keys, SAP labels / Core.Description annotations become descriptions. Read-only.")),
      input("odUrl", t("Service URL (service root or …/$metadata)"), { placeholder: "https://s4.example.com/sap/opu/odata/sap/API_BUSINESS_PARTNER" }),
      userPw(),
      row(pw("odToken", t("… or bearer token")), input("sapClient", t("sap-client (SAP Gateway, optional)"), { placeholder: "100" }), input("odEntityFilter", t("Entity filter (optional prefixes, comma-separated)"), { placeholder: "A_BusinessPartner, A_Customer" })),
      tlsCheck,
    ],
    toBody: (f) => ({ mode: "odata", url: trim(f.odUrl), user: f.user, password: f.password, token: opt(f.odToken), sapClient: opt(f.sapClient), entityFilter: opt(f.odEntityFilter), tlsVerify: f.tlsVerify }),
    toRef: (f) => ({ kind: "odata", url: trim(f.odUrl), user: f.user, sapClient: f.sapClient || undefined, entityFilter: f.odEntityFilter || undefined, tlsVerify: f.tlsVerify }),
    isValid: (f) => !!trim(f.odUrl),
    fromRef: (r) => ({ odUrl: r.url || "", sapClient: r.sapClient || "", odEntityFilter: r.entityFilter || "", ...tls(r) }),
    /* the service segment — also when the …/$metadata URL was pasted */
    defaultName: (f) => trim(f.odUrl).replace(/\/?\$metadata\/?$/i, "").split("/").filter(Boolean).pop() || "",
  }),
  kafka: () => ({
    fields: { kfUrl: "", subjectFilter: "", user: "", password: "", schema: "", tlsVerify: true },
    ui: [
      notice(t("Reads the latest schema of every subject in a Confluent-compatible Schema Registry: topics become tables (type TOPIC), Avro / JSON Schema / Protobuf fields become attributes (nested records as dotted names, key schema as key.* primary keys). Read-only.")),
      input("kfUrl", t("Schema Registry URL"), { placeholder: "https://schema-registry.example.com:8081" }),
      userPw("API key / user (optional)"),   /* untranslated, as before */
      row(input("subjectFilter", t("Subject filter (optional prefix or substring)"), { placeholder: "claims." }), input("schema", t("Schema name in the catalog"), { placeholder: "topics" })),
      tlsCheck,
    ],
    toBody: (f) => ({ mode: "kafka", url: trim(f.kfUrl), user: f.user, password: f.password, subjectFilter: opt(f.subjectFilter), schema: trim(f.schema) || "topics", tlsVerify: f.tlsVerify }),
    toRef: (f) => ({ kind: "kafka", url: trim(f.kfUrl), user: f.user, subjectFilter: f.subjectFilter || undefined, schema: trim(f.schema) || "topics", tlsVerify: f.tlsVerify }),
    isValid: (f) => !!trim(f.kfUrl),
    fromRef: (r) => ({ kfUrl: r.url || "", subjectFilter: r.subjectFilter || "", ...tls(r) }),
    defaultName: () => "KAFKA",
  }),
  /* bundle: the Node server scans the tenant (native since v1.60) and returns databases + lineage */
  powerbi: () => ({
    fields: { tenantId: "", clientId: "", clientSecret: "", pbiToken: "", workspaces: "", includeReports: true, tlsVerify: true },
    ui: [
      notice(t("Scans workspaces with the Power BI admin Scanner API: every workspace becomes a database, every dataset a schema, dataset tables become tables (columns and measures as attributes) and reports become objects of type REPORT in the schema \"Reports\" with lineage dataset table → report. Read-only.")),
      row(input("tenantId", t("Tenant ID"), { placeholder: "00000000-0000-0000-0000-000000000000" }), input("clientId", t("Client ID (service principal)")), pw("clientSecret", t("Client secret"))),
      row(pw("pbiToken", t("… or access token (Get-PowerBIAccessToken / az account get-access-token)"), { aria: t("Power BI access token") }), input("workspaces", t("Workspaces (names or IDs, comma-separated; empty = all; Sales* = prefix)"), { placeholder: "Claims Analytics, Finance*" })),
      check("includeReports", "Include reports (schema \"Reports\" per workspace, lineage from the dataset tables)"),   /* untranslated, as before */
      sub(t("Prerequisites in the Power BI admin portal: the service principal (or its security group) is allowed under \"Allow service principals to use read-only admin APIs\" and \"Enhance admin APIs responses with detailed metadata\"; the app registration needs no delegated Power BI permissions. A scan of many workspaces can take a minute.")),
    ],
    toBody: (f) => ({ mode: "powerbi", tenantId: trim(f.tenantId), clientId: trim(f.clientId), clientSecret: f.clientSecret, token: opt(f.pbiToken), workspaces: opt(f.workspaces), includeReports: f.includeReports, tlsVerify: f.tlsVerify }),
    toRef: (f) => ({ kind: "powerbi", tenantId: opt(f.tenantId), clientId: opt(f.clientId), workspaces: opt(f.workspaces), includeReports: f.includeReports }),
    isValid: (f) => !!(trim(f.pbiToken) || (trim(f.tenantId) && trim(f.clientId) && f.clientSecret)),
    fromRef: (r) => ({ tenantId: r.tenantId || "", clientId: r.clientId || "", workspaces: r.workspaces || "", includeReports: r.includeReports !== false }),
  }),
  /* upload bundles (v1.66): the files are handed to the server as text — toBody keeps the File objects, SourceModalC
     reads them before the call */
  dbt: () => ({
    fields: { manifest: null, catalog: null },
    ui: [
      notice(t("Reads the artefacts of dbt docs generate / dbt build: models, seeds, snapshots and sources become tables (one database per warehouse database, schema = dbt schema), documented columns become attributes (types from catalog.json, not_null / unique tests → nullability and keys) and depends_on becomes lineage. Existing tables (e.g. imported from Unity Catalog) are enriched, not duplicated.")),
      row(file("manifest", t("manifest.json (target/)"), { aria: "dbt manifest.json", accept: ".json,application/json" }), file("catalog", t("catalog.json (optional — column types)"), { aria: "dbt catalog.json", accept: ".json,application/json" })),
    ],
    toBody: (f) => ({ kind: "dbt", manifest: f.manifest, catalog: f.catalog || null, fileName: f.manifest?.name }),
    toRef: () => ({ kind: "dbt" }),
    isValid: (f) => !!f.manifest,
    fromRef: () => ({}),
  }),
  odcs: () => ({
    fields: { contracts: [] },
    ui: [
      notice(t("Reads Open Data Contract Standard files (v3 schema/properties or v2 dataset/columns, YAML or JSON): database and schema come from the first server entry, each schema object becomes a table, properties become attributes — classification → sensitivity, businessName → business term, primaryKey / required → key and nullability. Contract, status, domain, data product and team are kept in the business definition.")),
      file("contracts", t("Contract files (several allowed)"), { aria: t("Contract files"), accept: ".yaml,.yml,.json,text/yaml,application/json", multiple: true }),
    ],
    toBody: (f) => ({ kind: "odcs", contracts: f.contracts, fileName: f.contracts[0]?.name || "" }),
    toRef: () => ({ kind: "odcs" }),
    isValid: (f) => f.contracts.length > 0,
    fromRef: () => ({}),
  }),
};

/* ---- the registry --------------------------------------------------------------------------------------------- */
const url = (prefix, port) => (f) => `${prefix}://${enc(f.user)}:${enc(f.password)}@${f.host}:${f.port || port}`;
const ENTRIES = {
  duckdb: { label: "DuckDB (database file, read-only)", kind: "duckdb" },
  lakefiles: { label: "Data lake files — Parquet / CSV / JSON / Delta / Iceberg (local, S3, Azure)", kind: "lakefiles", system: "Data lake files" },
  mysql:  { label: "MySQL / MariaDB", kind: "sqlalchemy", port: "3306", tpl: (f) => `${url("mysql+pymysql", "3306")(f)}/${f.database}` },
  postgres: { label: "PostgreSQL", kind: "sqlalchemy", port: "5432", tpl: (f) => `${url("postgresql+psycopg2", "5432")(f)}/${f.database}` },
  mssql:  { label: "Microsoft SQL Server / Azure SQL", kind: "sqlalchemy", port: "1433", tpl: (f) => `${url("mssql+pymssql", "1433")(f)}/${f.database}`, note: "Requires the optional package pymssql in the inspector service (no ODBC driver needed). Schemas such as dbo are listed automatically; optionally restrict to one." },
  oracle: { label: "Oracle", kind: "sqlalchemy", port: "1521", dbLabel: "Service name", tpl: (f) => `${url("oracle+oracledb", "1521")(f)}/?service_name=${enc(f.database)}`, note: "Requires the optional package oracledb (thin mode — no Oracle client). Schema = owning user, e.g. CLAIMS; without it every non-system schema the user can see is loaded." },
  snowflake: { label: "Snowflake", kind: "sqlalchemy", noPort: true, hostLabel: "Account identifier", extras: [["warehouse", "Warehouse (optional)"], ["role", "Role (optional)"]],
    tpl: (f, x = {}) => { const q = [x.warehouse && `warehouse=${enc(x.warehouse)}`, x.role && `role=${enc(x.role)}`].filter(Boolean); return `snowflake://${enc(f.user)}:${enc(f.password)}@${f.host}/${enc(f.database)}${q.length ? `?${q.join("&")}` : ""}`; },
    note: "Requires the optional package snowflake-sqlalchemy. Account identifier like xy12345.eu-central-1 or myorg-myaccount (no https://). Table and column COMMENTs are imported as descriptions." },
  db2:    { label: "IBM DB2", kind: "sqlalchemy", port: "50000", tpl: (f) => `${url("db2+ibm_db", "50000")(f)}/${f.database}`, note: "Requires the optional dialect ibm-db-sa in the inspector service." },
  hana:   { label: "SAP HANA", kind: "sqlalchemy", port: "39015", tpl: url("hana+hdbcli", "39015"), noDb: true, note: "Requires the optional dialects sqlalchemy-hana + hdbcli in the inspector service. Optionally restrict to one schema below." },
  sqlurl: { label: "SQLAlchemy URL (any dialect)", kind: "url" },
  jdbc:   { label: "JDBC (generic)", kind: "jdbc" },
  informatica: { label: "Informatica Data Catalog (API)", kind: "informatica", system: "Informatica" },
  successfactors: { label: "SAP SuccessFactors (OData API, read-only)", kind: "successfactors", system: "SuccessFactors" },
  odata: { label: "OData service — SAP S/4HANA, Gateway, any OData v2/v4 (read-only)", kind: "odata", system: "OData" },
  kafka: { label: "Kafka Schema Registry (Avro / JSON Schema / Protobuf)", kind: "kafka", system: "Kafka Schema Registry" },
  powerbi: { label: "Power BI — workspaces, datasets, reports (admin Scanner API)", kind: "powerbi", bundle: true },
  dbt: { label: "dbt project — manifest.json (+ catalog.json)", kind: "dbt", bundle: true, upload: true },
  odcs: { label: "Data contracts — ODCS YAML / JSON", kind: "odcs", bundle: true, upload: true },
};
/* the system name defaults to the label without its qualifier ("Oracle", "Power BI", "DuckDB", …) */
const systemOf = (label) => label.replace(/ \(.*\)$/, "").replace(/ — .*$/, "");
export const SOURCE_TYPES = Object.fromEntries(Object.entries(ENTRIES).map(([type, e]) => {
  const c = CONNECTORS[e.kind](e);
  return [type, {
    ...e, type, system: e.system || systemOf(e.label), defaultName: () => "", ...c,
    /* type + kind are stamped on every recorded reference so it can be restored later */
    toRef: (f) => { const r = c.toRef(f); return { kind: r.kind, type, ...r }; },
  }];
}));

/* v1.60: source kinds that need the Python inspector (native drivers / JVM). Everything else runs in the Node server
   or in the browser, so these entries disappear when the installation has no inspector (INSPECTOR_URL off). */
export const INSPECTOR_KINDS = ["duckdb", "lakefiles", "sqlalchemy", "url", "jdbc"];
export const visibleSourceTypes = (caps) => Object.fromEntries(Object.entries(SOURCE_TYPES).filter(([, v]) => !caps || caps.inspector !== false || !INSPECTOR_KINDS.includes(v.kind)));

/* the modal's form: the union of every connector's fields plus the catalog name — switching the source system keeps
   what was typed, exactly as the separate useState hooks did before v1.70 */
export const initialForm = () => Object.assign({ dbName: "" }, ...Object.values(SOURCE_TYPES).map((T) => T.fields));
/* catalog name used for the import: typed name, else the database field, else the connector's proposal */
export const effectiveName = (T, f) => trim(f.dbName) || trim(f.database) || T.defaultName(f);
/* registry key for a recorded reference. References before v1.55 carry only the kind: for the connectors whose
   registry key equals their kind that is the key; a bare "sqlalchemy" (dialect unknown) restores as the URL form. */
export const typeForRef = (ref) => ref.type || (SOURCE_TYPES[ref.kind]?.kind === ref.kind ? ref.kind : "sqlurl");
/* form patch that restores a recorded reference: the shared credential fields are reset for every kind (the password
   is never stored), the connector adds its own */
export const formFromRef = (ref) => {
  const T = SOURCE_TYPES[typeForRef(ref)] || SOURCE_TYPES.sqlurl;
  const shared = Object.fromEntries(Object.keys(CREDS).map((k) => [k, k === "password" ? "" : ref[k] || ""]));
  return { ...shared, ...(ref.name ? { dbName: ref.name } : {}), ...T.fromRef(ref) };
};
