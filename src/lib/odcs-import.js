/* Open Data Contract Standard (ODCS) import — v3 (schema/properties) and v2 (dataset/columns) YAML or JSON.
   One contract → tables in <database>.<schema> from the first server (fallbacks: the contract id / name); columns →
   attributes with classification → sensitivity, businessName → business term, primaryKey / required flags. */
import YAML from "yaml";

const SENS = { public: "Public", internal: "Internal", confidential: "Confidential", restricted: "Confidential", pii: "PII", personal: "PII", sensitive: "Confidential" };
const sensitivityOf = (v) => SENS[String(v || "").trim().toLowerCase()] || null;
const classOf = (v) => /^C[1-4]$/i.test(String(v || "").trim()) ? String(v).trim().toUpperCase() : null;
const text = (v) => (v == null ? "" : typeof v === "string" ? v : typeof v === "object" ? [v.purpose, v.usage, v.limitations].filter(Boolean).join(" ") : String(v)).trim();

export const parseContractText = (src) => {
  const t = String(src || "").replace(/^\ufeff/, "");
  if (!t.trim()) throw new Error("empty file");
  if (/^\s*[{[]/.test(t)) return JSON.parse(t);
  const docs = YAML.parseAllDocuments(t);
  const bad = docs.find((d) => d.errors?.length);
  if (bad) throw new Error(`YAML: ${bad.errors[0].message.split("\n")[0]}`);
  const objs = docs.map((d) => d.toJS()).filter((d) => d && typeof d === "object");
  return objs.length === 1 ? objs[0] : objs;
};

const flatProps = (props, prefix = "") => {
  const out = [];
  for (const p of props || []) {
    const name = `${prefix}${p.name || p.column || "?"}`;
    if (Array.isArray(p.properties) && p.properties.length && String(p.logicalType || "").toLowerCase() === "object") { out.push(...flatProps(p.properties, `${name}.`)); continue; }
    if (Array.isArray(p.items?.properties) && p.items.properties.length) { out.push(...flatProps(p.items.properties, `${name}[].`)); continue; }
    out.push({ ...p, _name: name });
  }
  return out;
};
const nz = (v) => v !== undefined && v !== null;

/* one contract object (already parsed) → { database, schema, tables: [...] } */
export function contractToTables(c) {
  if (!c || typeof c !== "object") throw new Error("not a data contract");
  const isV3 = Array.isArray(c.schema);
  const isV2 = Array.isArray(c.dataset);
  if (!isV3 && !isV2) throw new Error("no schema (ODCS v3) or dataset (ODCS v2) section found");
  const server = (c.servers || [])[0] || {};
  const database = String(server.database || server.catalog || server.project || c.database || c.datasetName || c.quantumName || c.name || c.id || "CONTRACTS").trim();
  const schema = String(server.schema || server.dataset || c.datasetSchema || c.schemaName || "default").trim();
  const contractLabel = `${c.name || c.id || c.quantumName || c.datasetName || "contract"}${c.version ? ` v${c.version}` : ""}`;
  const meta = [`Data contract ${contractLabel}`, c.status ? `status ${c.status}` : "", c.domain ? `domain ${c.domain}` : "", c.dataProduct ? `data product ${c.dataProduct}` : "",
    (c.team || []).length ? `team: ${c.team.map((m) => `${m.username || m.name || ""}${m.role ? ` (${m.role})` : ""}`).filter(Boolean).join(", ")}` : ""].filter(Boolean).join(" · ");
  const tables = [];
  for (const obj of isV3 ? c.schema : c.dataset) {
    const name = String(obj.physicalName || obj.name || obj.table || "").trim();
    if (!name) continue;
    const cols = flatProps(isV3 ? obj.properties : (obj.columns || []).map((col) => ({ ...col, name: col.column || col.name })));
    const columns = cols.map((p, i) => {
      const pk = nz(p.primaryKey) ? !!p.primaryKey : nz(p.isPrimary) ? !!p.isPrimary : nz(p.isPrimaryKey) ? !!p.isPrimaryKey : false;
      const required = nz(p.required) ? !!p.required : nz(p.isNullable) ? !p.isNullable : nz(p.nullable) ? !p.nullable : false;
      const sens = sensitivityOf(p.classification) || (String(p.criticalDataElement) === "true" ? "Confidential" : null);
      return {
        name: p._name || p.name || `col_${i + 1}`,
        type_text: String(p.physicalType || p.logicalType || "STRING").toUpperCase(),
        nullable: !(required || pk), isPK: pk,
        comment: text(p.description),
        ...(p.businessName ? { businessTerm: String(p.businessName) } : {}),
        ...(sens ? { sensitivity: sens } : {}),
        ...(classOf(p.classification) ? { classification: classOf(p.classification) } : {}),
      };
    });
    const ptype = String(obj.physicalType || "").toLowerCase();
    tables.push({
      name, type: ptype.includes("view") ? "VIEW" : "TABLE",
      comment: text(obj.description) || text(c.description),
      businessDefinition: [obj.businessName ? `Business name: ${obj.businessName}.` : "", meta, (obj.tags || c.tags || []).length ? `Tags: ${(obj.tags || c.tags).join(", ")}.` : ""].filter(Boolean).join(" "),
      columns,
    });
  }
  if (!tables.length) throw new Error("the contract defines no tables");
  return { database, schema, tables, contract: contractLabel, dataProduct: c.dataProduct || "", domain: c.domain || "" };
}

/* several contracts (text or parsed) → bundle { databases, lineage: [] } — contracts sharing database/schema are merged */
export function parseContracts(inputs) {
  const dbs = {};
  const contracts = [];
  for (const input of inputs) {
    const parsed = typeof input === "string" ? parseContractText(input) : input;
    for (const c of Array.isArray(parsed) ? parsed : [parsed]) {
      const r = contractToTables(c);
      contracts.push(r.contract);
      const db = (dbs[r.database] ||= { name: r.database, comment: "", schemas: {} });
      const sc = (db.schemas[r.schema] ||= { name: r.schema, comment: "", tables: [] });
      for (const t of r.tables) if (!sc.tables.some((x) => x.name === t.name)) sc.tables.push(t);
    }
  }
  return { databases: Object.values(dbs).map((d) => ({ ...d, schemas: Object.values(d.schemas) })), lineage: [], contracts };
}
