/* v1.70 — the source-import registry (src/lib/source-types.js) replaces the five kind-dispatch chains that SourceModalC
   carried before. Every entry is driven through the same contract: form → inspect body, form → recorded reference
   (no secrets), the "Load" test, and reference → restored form. */
import { describe, it, expect } from "vitest";
import { SOURCE_TYPES, INSPECTOR_KINDS, visibleSourceTypes, initialForm, effectiveName, typeForRef, formFromRef, duckdbBaseName, lakeBaseName, splitPaths } from "../../src/lib/source-types.js";

const SECRETS = ["p@w", "sec", "tok", "S3SECRET", "AZKEY", "hidden"];
const sql = { host: "h", port: "", user: "u", password: "p@w", database: "DB", schema: " s " };
const sqlRestored = { host: "h", user: "u", password: "", database: "DB", schema: "s" };   /* port: the dialect default is recorded */
const dialect = (url) => ({ fill: sql, body: { mode: "sqlalchemy", url, schema: "s" }, ref: { kind: "sqlalchemy", host: "h", user: "u", database: "DB", schema: "s" }, restored: sqlRestored });

/* per type: the filled-in form, what the body / reference must contain, and what a restore from that reference yields */
const CASES = {
  duckdb: { fill: { duckPath: " /data/claims.duckdb ", schema: "main", duckRO: false }, body: { mode: "duckdb", path: "/data/claims.duckdb", schema: "main", readOnly: false },
    ref: { kind: "duckdb", path: "/data/claims.duckdb", schema: "main", readOnly: false }, restored: { duckPath: "/data/claims.duckdb", duckRO: false, schema: "main" }, name: "claims" },
  lakefiles: { fill: { lakePaths: "s3://lake/bronze/claims/*.parquet\n\n /x/y.csv ", lakeFormat: "parquet", lakeAuth: "s3", s3Key: "K", s3Secret: "S3SECRET", s3Region: "eu-west-1", s3Endpoint: "https://minio" },
    body: { mode: "lakefiles", paths: ["s3://lake/bronze/claims/*.parquet", "/x/y.csv"], format: "parquet", schema: "files", credentials: { s3Key: "K", s3Secret: "S3SECRET", s3Region: "eu-west-1", s3Endpoint: "https://minio" } },
    ref: { kind: "lakefiles", paths: ["s3://lake/bronze/claims/*.parquet", "/x/y.csv"], format: "parquet", schema: "files", auth: "s3", s3Region: "eu-west-1", s3Endpoint: "https://minio" },
    restored: { lakePaths: "s3://lake/bronze/claims/*.parquet\n/x/y.csv", lakeFormat: "parquet", lakeAuth: "s3", s3Region: "eu-west-1", s3Endpoint: "https://minio", schema: "files" }, name: "lake" },
  mysql: dialect("mysql+pymysql://u:p%40w@h:3306/DB"),
  postgres: dialect("postgresql+psycopg2://u:p%40w@h:5432/DB"),
  mssql: dialect("mssql+pymssql://u:p%40w@h:1433/DB"),
  oracle: dialect("oracle+oracledb://u:p%40w@h:1521/?service_name=DB"),
  db2: dialect("db2+ibm_db://u:p%40w@h:50000/DB"),
  hana: dialect("hana+hdbcli://u:p%40w@h:39015"),
  snowflake: { fill: { ...sql, warehouse: "WH", role: "" }, body: { mode: "sqlalchemy", url: "snowflake://u:p%40w@h/DB?warehouse=WH", schema: "s" },
    ref: { kind: "sqlalchemy", host: "h", user: "u", database: "DB", extras: { warehouse: "WH" } }, restored: { ...sqlRestored, warehouse: "WH" } },
  sqlurl: { fill: { sqlUrl: " postgresql://u:hidden@h/db ", schema: "" }, body: { mode: "sqlalchemy", url: "postgresql://u:hidden@h/db", schema: undefined },
    ref: { kind: "sqlalchemy", typeLabel: "SQLAlchemy URL (any dialect)", url: "postgresql://u@h/db" }, restored: { sqlUrl: "postgresql://u@h/db" } },
  jdbc: { fill: { jdbcUrl: "jdbc:db2://h:50000/C", driverClass: " com.ibm.db2.jcc.DB2Driver ", jar: " db2jcc4.jar ", user: "u", password: "p@w" },
    body: { mode: "jdbc", url: "jdbc:db2://h:50000/C", driverClass: "com.ibm.db2.jcc.DB2Driver", jar: "db2jcc4.jar", user: "u", password: "p@w" },
    ref: { kind: "jdbc", url: "jdbc:db2://h:50000/C", driverClass: "com.ibm.db2.jcc.DB2Driver", jar: "db2jcc4.jar", user: "u" },
    restored: { jdbcUrl: "jdbc:db2://h:50000/C", driverClass: "com.ibm.db2.jcc.DB2Driver", jar: "db2jcc4.jar", user: "u", password: "" } },
  informatica: { fill: { infaUrl: "https://edc:9085", resource: " R ", user: "u", password: "p@w", tlsVerify: false },
    body: { mode: "informatica", url: "https://edc:9085", user: "u", password: "p@w", resource: "R", tlsVerify: false },
    ref: { kind: "informatica", url: "https://edc:9085", user: "u", resource: "R", tlsVerify: false }, restored: { infaUrl: "https://edc:9085", resource: "R", user: "u", tlsVerify: false } },
  successfactors: { fill: { sfHost: "https://api4.sf.com", sfCompany: "ACME01", sfToken: "", sfFilter: "Per", user: "u", password: "p@w" },
    body: { mode: "successfactors", apiHost: "https://api4.sf.com", companyId: "ACME01", user: "u", password: "p@w", token: undefined, entityFilter: "Per", tlsVerify: true },
    ref: { kind: "successfactors", url: "https://api4.sf.com", companyId: "ACME01", user: "u", entityFilter: "Per", tlsVerify: true }, restored: { sfHost: "https://api4.sf.com", sfCompany: "ACME01", sfFilter: "Per", tlsVerify: true } },
  odata: { fill: { odUrl: "https://s4/sap/opu/odata/sap/API_BP/$metadata", odToken: "tok", sapClient: "100", odEntityFilter: "A_" },
    body: { mode: "odata", url: "https://s4/sap/opu/odata/sap/API_BP/$metadata", token: "tok", sapClient: "100", entityFilter: "A_", tlsVerify: true },
    ref: { kind: "odata", url: "https://s4/sap/opu/odata/sap/API_BP/$metadata", sapClient: "100", entityFilter: "A_" }, restored: { odUrl: "https://s4/sap/opu/odata/sap/API_BP/$metadata", sapClient: "100", odEntityFilter: "A_" }, name: "API_BP" },
  kafka: { fill: { kfUrl: "https://sr:8081", subjectFilter: "claims." }, body: { mode: "kafka", url: "https://sr:8081", subjectFilter: "claims.", schema: "topics" },
    ref: { kind: "kafka", url: "https://sr:8081", subjectFilter: "claims.", schema: "topics" }, restored: { kfUrl: "https://sr:8081", subjectFilter: "claims.", schema: "topics" }, name: "KAFKA" },
  powerbi: { fill: { tenantId: " t ", clientId: "c", clientSecret: "sec", workspaces: "W*", includeReports: false },
    body: { mode: "powerbi", tenantId: "t", clientId: "c", clientSecret: "sec", token: undefined, workspaces: "W*", includeReports: false, tlsVerify: true },
    ref: { kind: "powerbi", tenantId: "t", clientId: "c", workspaces: "W*", includeReports: false }, restored: { tenantId: "t", clientId: "c", workspaces: "W*", includeReports: false } },
  dbt: { fill: { manifest: { name: "manifest.json" } }, body: { kind: "dbt", manifest: { name: "manifest.json" }, catalog: null, fileName: "manifest.json" }, ref: { kind: "dbt" }, restored: {} },
  odcs: { fill: { contracts: [{ name: "c.yaml" }] }, body: { kind: "odcs", contracts: [{ name: "c.yaml" }], fileName: "c.yaml" }, ref: { kind: "odcs" }, restored: {} },
};
const SYSTEM = { duckdb: "DuckDB", lakefiles: "Data lake files", mysql: "MySQL / MariaDB", postgres: "PostgreSQL", mssql: "Microsoft SQL Server / Azure SQL", oracle: "Oracle", snowflake: "Snowflake", db2: "IBM DB2", hana: "SAP HANA",
  sqlurl: "SQLAlchemy URL", jdbc: "JDBC", informatica: "Informatica", successfactors: "SuccessFactors", odata: "OData", kafka: "Kafka Schema Registry", powerbi: "Power BI", dbt: "dbt project", odcs: "Data contracts" };

describe("source-import registry (v1.70)", () => {
  it("covers every registered type in this test", () => {
    expect(Object.keys(CASES).sort()).toEqual(Object.keys(SOURCE_TYPES).sort());
    expect(Object.keys(SYSTEM).sort()).toEqual(Object.keys(SOURCE_TYPES).sort());
  });

  describe.each(Object.keys(SOURCE_TYPES))("%s", (type) => {
    const T = SOURCE_TYPES[type];
    const C = CASES[type];
    const full = () => ({ ...initialForm(), ...C.fill });

    it("has the entry shape and a system name", () => {
      for (const fn of ["toBody", "toRef", "isValid", "fromRef", "defaultName"]) expect(typeof T[fn]).toBe("function");
      expect(T.type).toBe(type);
      expect(typeof T.kind).toBe("string"); expect(typeof T.label).toBe("string");
      expect(Array.isArray(T.ui)).toBe(true); expect(T.ui.length).toBeGreaterThan(0);
      expect(T.system).toBe(SYSTEM[type]);
      /* every field the connector uses exists in the shared form */
      const form = initialForm();
      for (const k of Object.keys(T.fields)) expect(k in form, `field ${k}`).toBe(true);
    });

    it("isValid: empty form fails, filled form passes", () => {
      expect(!!T.isValid(initialForm())).toBe(false);
      expect(!!T.isValid(full())).toBe(true);
    });

    it("toBody builds the server payload", () => {
      expect(T.toBody(full())).toMatchObject(C.body);
    });

    it("toRef records type + kind and never a secret; fromRef restores the form", () => {
      const ref = T.toRef(full());
      expect(ref.type).toBe(type);
      expect(ref).toMatchObject(C.ref);
      const json = JSON.stringify(ref);
      for (const s of SECRETS) expect(json.includes(s), `secret ${s} in ${json}`).toBe(false);
      expect(typeForRef(ref)).toBe(type);
      const restored = formFromRef(ref);
      expect(restored).toMatchObject(C.restored);
      expect(restored.password).toBe("");
      /* the patch never introduces keys the form does not have */
      const form = initialForm();
      for (const k of Object.keys(restored)) expect(k in form, `restored key ${k}`).toBe(true);
    });

    it("effectiveName: typed name, then database field, then the connector's proposal", () => {
      const f = full();
      expect(effectiveName(T, { ...f, dbName: " Typed " })).toBe("Typed");
      expect(effectiveName(T, { ...f, dbName: "", database: "FromDb" })).toBe("FromDb");
      expect(effectiveName(T, { ...f, dbName: "", database: "" })).toBe(C.name || "");
    });
  });

  it("restores references recorded before the type was stamped (kind only)", () => {
    for (const k of ["duckdb", "lakefiles", "jdbc", "informatica", "successfactors", "odata", "kafka", "powerbi", "dbt", "odcs"]) expect(typeForRef({ kind: k })).toBe(k);
    expect(typeForRef({ kind: "sqlalchemy", url: "postgresql://u@h/db" })).toBe("sqlurl");
    expect(typeForRef({ kind: "unknown" })).toBe("sqlurl");
    expect(formFromRef({ kind: "sqlalchemy", url: "postgresql://u@h/db", name: "N" })).toMatchObject({ sqlUrl: "postgresql://u@h/db", dbName: "N", password: "" });
    expect(formFromRef({ kind: "sqlalchemy", type: "mysql", host: "h", port: "3307", user: "u", database: "d", extras: { role: "R" } })).toMatchObject({ host: "h", port: "3307", user: "u", database: "d", role: "R" });
  });

  it("lake credentials follow the chosen auth; the password is cut from a recorded URL", () => {
    const f = initialForm();
    expect(SOURCE_TYPES.lakefiles.toBody({ ...f, lakePaths: "/a", lakeAuth: "azure-cs", azureConnectionString: "AZKEY" }).credentials).toEqual({ azureConnectionString: "AZKEY" });
    expect(SOURCE_TYPES.lakefiles.toBody({ ...f, lakePaths: "/a", lakeAuth: "azure-acc", azureAccount: "acc", azureSas: "sas", azureKey: "AZKEY" }).credentials).toEqual({ azureAccount: "acc", azureSas: "sas", azureKey: "AZKEY" });
    expect(SOURCE_TYPES.lakefiles.toBody({ ...f, lakePaths: "/a" }).credentials).toEqual({});
    expect(SOURCE_TYPES.lakefiles.toRef({ ...f, lakePaths: "/a", lakeAuth: "azure-cs", azureConnectionString: "AZKEY" })).not.toHaveProperty("azureConnectionString");
    expect(SOURCE_TYPES.sqlurl.toRef({ ...f, sqlUrl: "mysql+pymysql://root:se%40cr:et@db/x" }).url).toBe("mysql+pymysql://root@db/x");
    expect(SOURCE_TYPES.odata.defaultName({ ...f, odUrl: "https://s4/sap/opu/odata/sap/API_BP" })).toBe("API_BP");
    expect(SOURCE_TYPES.odata.defaultName({ ...f, odUrl: "https://s4/sap/opu/odata/sap/API_BP/$metadata" })).toBe("API_BP");
    expect(SOURCE_TYPES.sqlurl.isValid({ ...f, sqlUrl: "nourl" })).toBe(false);
  });

  it("alternative credentials: token instead of user/password (SuccessFactors, Power BI); HANA needs no database", () => {
    const f = initialForm();
    expect(SOURCE_TYPES.successfactors.isValid({ ...f, sfToken: "tok" })).toBe(true);
    expect(SOURCE_TYPES.successfactors.isValid({ ...f, sfHost: "", sfToken: "tok" })).toBe(false);
    expect(SOURCE_TYPES.successfactors.isValid({ ...f, user: "u" })).toBe(false);
    expect(SOURCE_TYPES.powerbi.isValid({ ...f, pbiToken: "tok" })).toBe(true);
    expect(SOURCE_TYPES.powerbi.isValid({ ...f, tenantId: "t", clientId: "c" })).toBe(false);
    expect(SOURCE_TYPES.hana.isValid({ ...f, host: "h", user: "u" })).toBe(true);
    expect(SOURCE_TYPES.mysql.isValid({ ...f, host: "h", user: "u" })).toBe(false);
    expect(SOURCE_TYPES.informatica.isValid({ ...f, infaUrl: "edc:9085", user: "u" })).toBe(false);
    expect(SOURCE_TYPES.jdbc.isValid({ ...f, jdbcUrl: "db2://h", driverClass: "c", jar: "j" })).toBe(false);
  });

  it("initialForm carries every connector's defaults and the catalog name", () => {
    const f = initialForm();
    expect(f).toMatchObject({ dbName: "", host: "", password: "", schema: "", duckRO: true, tlsVerify: true, includeReports: true, lakeFormat: "auto", lakeAuth: "none", sfHost: "https://api4.successfactors.com", manifest: null, catalog: null, contracts: [] });
    expect(initialForm()).not.toBe(f);   /* a fresh object per modal */
    const keys = new Set(Object.values(SOURCE_TYPES).flatMap((T) => Object.keys(T.fields)));
    expect(Object.keys(f).sort()).toEqual([...keys, "dbName"].sort());
  });

  it("visibleSourceTypes hides the inspector-only kinds when the installation has no inspector", () => {
    const all = Object.keys(SOURCE_TYPES);
    expect(Object.keys(visibleSourceTypes(null))).toEqual(all);
    expect(Object.keys(visibleSourceTypes(undefined))).toEqual(all);
    expect(Object.keys(visibleSourceTypes({ inspector: true }))).toEqual(all);
    const without = Object.keys(visibleSourceTypes({ inspector: false }));
    expect(without).toEqual(["informatica", "successfactors", "odata", "kafka", "powerbi", "dbt", "odcs"]);
    for (const k of without) expect(INSPECTOR_KINDS).not.toContain(SOURCE_TYPES[k].kind);
    for (const k of all.filter((x) => !without.includes(x))) expect(INSPECTOR_KINDS).toContain(SOURCE_TYPES[k].kind);
    expect(all.slice(0, 2)).toEqual(["duckdb", "lakefiles"]);   /* DuckDB stays the preselected entry */
  });

  it("name helpers", () => {
    expect(duckdbBaseName(" C:\\data\\Claims.DuckDB ")).toBe("Claims");
    expect(duckdbBaseName("/x/y.db")).toBe("y");
    expect(splitPaths(" a \n\n b\n")).toEqual(["a", "b"]);
    expect(lakeBaseName("abfss://bronze@acct.dfs.core.windows.net/policies/*.parquet")).toBe("bronze@acct.dfs.core.windows.net");
    expect(lakeBaseName("/opt/*/events.jsonl")).toBe("opt");
    expect(lakeBaseName("")).toBe("");
  });
});
