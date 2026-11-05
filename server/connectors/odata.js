/* OData v2/v4 ($metadata EDMX) and SAP SuccessFactors — ported from inspector/app.py (v1.60, Option B).
   Output shape is identical to the Python inspector: [{ name: <EDM namespace>, comment, tables: [{ name, type: "TABLE",
   comment, columns: [{ name, type_text, nullable, isPK, comment }] }] }]. */
import { parseXml, iterElements, childElements, attr } from "./xml.js";
import { request as httpRequest, ConnectorError } from "./http.js";

const SAP_NS = ["{http://www.successfactors.com/edm/sap}", "{http://www.sap.com/Protocols/SAPData}"];
const lower = (s) => String(s || "").toLowerCase();

/* EDMX → schemas payload: EntityTypes → tables (one schema per EDM namespace), Properties → attributes,
   keys → isPK, sap:label / sap:quickinfo / Core.Description annotations → descriptions. */
export function parseEdmx(content, entityFilter = null, labelNs = SAP_NS) {
  const root = parseXml(content);
  const filt = lower(entityFilter).trim();
  const filters = filt ? filt.split(",").map((x) => x.trim()).filter(Boolean) : [];
  const label = (el) => {
    for (const ns of labelNs) { const v = attr(el, ns + "label") || attr(el, ns + "quickinfo") || attr(el, ns + "heading"); if (v) return v; }
    for (const ann of childElements(el, "Annotation")) {
      const term = attr(ann, "Term", "");
      if (term.endsWith("Core.Description") || term.endsWith("Core.LongDescription") || term.endsWith("Common.Label")) return attr(ann, "String", "");
    }
    return "";
  };
  const bySchema = new Map();
  for (const sch of iterElements(root)) {
    if (sch.tag !== "Schema") continue;
    const nsName = attr(sch, "Namespace") || "default";
    for (const et of childElements(sch, "EntityType")) {
      const name = attr(et, "Name", "");
      if (filters.length && !filters.some((f) => lower(name).startsWith(f))) continue;
      const keys = new Set([...iterElements(et)].filter((k) => k.tag === "PropertyRef").map((k) => attr(k, "Name")));
      const cols = childElements(et, "Property").map((pr) => ({
        name: attr(pr, "Name"),
        type_text: (attr(pr, "Type", "").replace("Edm.", "") || "STRING").toUpperCase(),
        nullable: lower(attr(pr, "Nullable", "true")) !== "false" && !keys.has(attr(pr, "Name")),
        isPK: keys.has(attr(pr, "Name")),
        comment: label(pr),
      }));
      const navs = childElements(et, "NavigationProperty").map((nv) => attr(nv, "Name"));
      let comment = label(et);
      if (navs.length) comment = (comment ? comment + " " : "") + `Navigation: ${navs.slice(0, 12).join(", ")}${navs.length > 12 ? " …" : ""}`;
      if (!bySchema.has(nsName)) bySchema.set(nsName, []);
      bySchema.get(nsName).push({ name, type: "TABLE", comment, columns: cols });
    }
  }
  const out = [...bySchema.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).filter(([, t]) => t.length)
    .map(([sc, tbs]) => ({ name: sc, comment: "", tables: tbs.sort((a, b) => (lower(a.name) < lower(b.name) ? -1 : lower(a.name) > lower(b.name) ? 1 : 0)) }));
  if (!out.length) throw new ConnectorError("No entity types found in the OData metadata" + (filt ? ` matching '${entityFilter}'` : ""));
  return out;
}

const withScheme = (u) => (/^https?:\/\//i.test(u) ? u : "https://" + u);

/* Any OData v2/v4 service: GET <service>/$metadata. Auth: Basic or bearer token. SAP Gateway: optional sap-client. */
export async function inspectOdata({ url, user, password, token, entityFilter, tlsVerify = true, sapClient, headers } = {}, { transport = httpRequest } = {}) {
  const base = withScheme(String(url || "").trim().replace(/\/+$/, ""));
  const target = lower(base).endsWith("$metadata") ? base : base + "/$metadata";
  const r = await transport(target, {
    headers: { Accept: "application/xml", ...(headers || {}) }, bearer: token || undefined, auth: !token && user ? { user, password } : undefined,
    params: sapClient ? { "sap-client": sapClient } : undefined, tlsVerify, timeoutMs: 120000,
  });
  if (r.status === 401 || r.status === 403) throw new ConnectorError(`The OData service refused the credentials (HTTP ${r.status})`);
  if (!r.ok) throw new ConnectorError(`OData $metadata failed: HTTP ${r.status}`);
  return parseEdmx(r.text, entityFilter);
}

/* SAP SuccessFactors: OData v2 $metadata of the API host; Basic (user@companyId : password) or bearer token. Read-only. */
export async function inspectSuccessFactors({ apiHost, companyId, user, password, token, entityFilter, tlsVerify = true } = {}, { transport = httpRequest } = {}) {
  const base = withScheme(String(apiHost || "").trim().replace(/\/+$/, ""));
  const login = !companyId || String(user || "").includes("@") ? user : `${user}@${companyId}`;
  const r = await transport(`${base}/odata/v2/$metadata`, {
    headers: { Accept: "application/xml" }, bearer: token || undefined, auth: !token ? { user: login, password } : undefined, tlsVerify, timeoutMs: 120000,
  });
  if (r.status === 401 || r.status === 403) throw new ConnectorError(`SuccessFactors refused the credentials (HTTP ${r.status}) — check user@companyId / password or the token`);
  if (!r.ok) throw new ConnectorError(`SuccessFactors $metadata failed: HTTP ${r.status}`);
  const root = parseXml(r.text);
  const sap = "{http://www.successfactors.com/edm/sap}";
  const entityTypes = [...iterElements(root)].filter((e) => e.tag === "EntityType");
  const filt = lower(entityFilter).trim();
  const tables = [];
  for (const et of entityTypes) {
    const name = attr(et, "Name", "");
    if (filt && !lower(name).startsWith(filt)) continue;
    const keys = new Set([...iterElements(et)].filter((k) => k.tag === "PropertyRef").map((k) => attr(k, "Name")));
    const cols = childElements(et, "Property").map((pr) => ({
      name: attr(pr, "Name"),
      type_text: (attr(pr, "Type", "").replace("Edm.", "") || "STRING").toUpperCase(),
      nullable: lower(attr(pr, "Nullable", "true")) !== "false",
      isPK: keys.has(attr(pr, "Name")),
      comment: attr(pr, sap + "label", ""),
    }));
    tables.push({ name, type: "TABLE", comment: attr(et, sap + "label", ""), columns: cols });
  }
  tables.sort((a, b) => (lower(a.name) < lower(b.name) ? -1 : lower(a.name) > lower(b.name) ? 1 : 0));
  if (!tables.length) throw new ConnectorError("No entity types found in the SuccessFactors metadata" + (filt ? ` matching '${entityFilter}'` : ""));
  return [{ name: "SFOData", tables }];
}
