/* Native (Node) source connectors — v1.60 "Option B": the pure-HTTPS connectors of the Python inspector live here,
   so OData/SuccessFactors, Kafka Schema Registry, Power BI and Informatica work without the inspector process.
   The inspector stays optional for DuckDB, lake files, SQLAlchemy and JDBC (needs native drivers / a JVM). */
import { ConnectorError } from "./http.js";
import { inspectOdata, inspectSuccessFactors } from "./odata.js";
import { inspectSchemaRegistry } from "./schema-registry.js";
import { inspectPowerBi } from "./powerbi.js";
import { inspectInformatica } from "./informatica.js";

export { ConnectorError };
export const NATIVE_MODES = ["odata", "successfactors", "kafka", "powerbi", "informatica"];
export const INSPECTOR_MODES = ["duckdb", "lakefiles", "sqlalchemy", "jdbc"];

const str = (v) => String(v ?? "").trim();
const bad = (msg) => { throw new ConnectorError(msg, 400); };

/* Validates the request body like the inspector's /inspect route did and runs the connector.
   Returns { schemas } or, for Power BI, { databases, lineage }. Throws ConnectorError (status 400/404/502) only:
   any other failure (network, TLS, parser) becomes a 502 "<name>: <message>" (v1.72 — the route used to translate it). */
export async function inspectNative(body = {}, deps = {}) {
  try { return await inspectNativeRaw(body, deps); }
  catch (e) { if (e instanceof ConnectorError) throw e; throw Object.assign(new ConnectorError(`${e?.name || "Error"}: ${e?.message}`, 502), { cause: e }); }
}
async function inspectNativeRaw(body, deps) {
  const b = body; const tlsVerify = b.tlsVerify !== false;
  let schemas;
  switch (b.mode) {
    case "odata": {
      if (!str(b.url)) bad("The OData service URL is required (e.g. https://host/sap/opu/odata/sap/API_BUSINESS_PARTNER)");
      schemas = await inspectOdata({ url: str(b.url), user: b.user, password: b.password, token: str(b.token) || undefined, entityFilter: b.entityFilter, tlsVerify, sapClient: str(b.sapClient) || undefined }, deps);
      break;
    }
    case "successfactors": {
      if (!str(b.apiHost)) bad("The SuccessFactors API host is required (e.g. https://api4.successfactors.com)");
      if (!b.token && !(b.user && b.password)) bad("SuccessFactors needs user@companyId and password, or a bearer token");
      schemas = await inspectSuccessFactors({ apiHost: str(b.apiHost), companyId: str(b.companyId), user: b.user, password: b.password, token: str(b.token) || undefined, entityFilter: b.entityFilter, tlsVerify }, deps);
      break;
    }
    case "kafka": {
      if (!str(b.url)) bad("The schema registry URL is required (e.g. https://schema-registry.example.com:8081)");
      schemas = await inspectSchemaRegistry({ url: str(b.url), user: b.user, password: b.password, subjectFilter: b.subjectFilter, tlsVerify, schema: str(b.schema) || "topics" }, deps);
      break;
    }
    case "informatica": {
      if (!/^https?:\/\//i.test(str(b.url))) bad("The Informatica catalog base URL is required (e.g. https://edc.example.com:9085)");
      schemas = await inspectInformatica({ url: str(b.url), user: b.user, password: b.password, resource: str(b.resource) || undefined, schema: b.schema || undefined, tlsVerify }, deps);
      break;
    }
    case "powerbi": {
      if (!b.token && !(b.tenantId && b.clientId && b.clientSecret)) bad("Power BI needs tenant ID, client ID and client secret of a service principal — or an access token");
      return inspectPowerBi({ tenantId: b.tenantId, clientId: b.clientId, clientSecret: b.clientSecret, token: str(b.token) || undefined, workspaces: b.workspaces, includeReports: b.includeReports !== false, tlsVerify }, deps);
    }
    default: bad(`mode must be one of ${NATIVE_MODES.join(", ")}`);
  }
  if (!schemas.reduce((n, s) => n + s.tables.length, 0)) throw new ConnectorError("No tables found — check database/schema name and the user's read permissions", 404);
  return { schemas };
}
