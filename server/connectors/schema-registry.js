/* Kafka Schema Registry (Confluent-compatible REST API) — ported from inspector/app.py (v1.60, Option B).
   Avro (nested records → dotted names, unions, logical types), JSON Schema and a small Protobuf parser.
   Key subjects (…-key) become `key.<name>` columns flagged isPK and are listed first. */
import { request as httpRequest, ConnectorError } from "./http.js";

const lower = (s) => String(s || "").toLowerCase();
const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);

export function avroType(t) {
  if (typeof t === "string") return t;
  if (Array.isArray(t)) return "UNION<" + t.filter((x) => x !== "null").map(avroType).join(",") + ">";
  if (isObj(t)) {
    const lt = t.logicalType; const base = t.type;
    if (lt) return lt !== "decimal" ? lt : `DECIMAL(${t.precision !== undefined ? t.precision : "?"},${t.scale !== undefined ? t.scale : 0})`;
    if (base === "array") return `ARRAY<${avroType(t.items)}>`;
    if (base === "map") return `MAP<STRING,${avroType(t.values)}>`;
    if (base === "enum") return `ENUM(${(t.symbols || []).slice(0, 8).join(",")})`;
    if (base === "fixed") return `FIXED(${t.size})`;
    if (base === "union") return "UNION<" + (t.types || []).map(avroType).join(",") + ">";
    if (base === "record") return t.name || "RECORD";
    return String(base || "STRING");
  }
  return "STRING";
}

/* Flattens an Avro record schema into columns (nested records → dotted names). */
export function avroFields(schema, prefix = "", named = new Map(), out = []) {
  if (typeof schema === "string") return out;
  if (isObj(schema) && schema.type === "record") {
    named.set(schema.name, schema);
    for (const f of schema.fields || []) {
      let t = f.type; let nullable = false;
      if (Array.isArray(t)) { nullable = t.includes("null"); const nn = t.filter((x) => x !== "null"); t = nn.length === 1 ? nn[0] : { type: "union", types: nn }; }
      if (typeof t === "string" && named.has(t)) t = named.get(t);
      if (isObj(t) && t.type === "record") { avroFields(t, prefix + f.name + ".", named, out); continue; }
      out.push({ name: prefix + f.name, type_text: avroType(t).toUpperCase(), nullable: nullable || ("default" in f && f.default === null), comment: f.doc || "", isPK: false });
    }
  }
  return out;
}

export function jsonSchemaFields(schema, prefix = "", out = [], defs = null) {
  defs = defs || { ...(schema.definitions || {}), ...(schema.$defs || {}) };
  const req = new Set(schema.required || []);
  for (const [name, prop] of Object.entries(schema.properties || {})) {
    let p = prop;
    if (p && p.$ref) p = defs[String(p.$ref).split("/").pop()] || {};
    let t = p.type; let nullable;
    if (Array.isArray(t)) { nullable = t.includes("null"); t = t.find((x) => x !== "null") || "string"; }
    else nullable = !req.has(name);
    if (t === "object" && p.properties) { jsonSchemaFields(p, prefix + name + ".", out, defs); continue; }
    if (t === "array" && isObj(p.items)) { let it = p.items; if (it.$ref) it = defs[String(it.$ref).split("/").pop()] || {}; t = `ARRAY<${it.type || "object"}>`; }
    out.push({ name: prefix + name, type_text: String(p.format || t || "string").toUpperCase(), nullable, comment: p.description || p.title || "", isPK: false });
  }
  return out;
}

const RESERVED = new Set(["message", "enum", "oneof", "reserved", "option", "syntax", "package", "import", "map"]);
/* Very small Protobuf parser: fields of the root message (nested messages flattened one level by name). */
export function protoFields(text) {
  const msgs = new Map();
  for (const m of String(text).matchAll(/message\s+(\w+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/gs)) msgs.set(m[1], m[2]);
  if (!msgs.size) return [];
  // root message = one that no other message uses as a field type (the last such one; nested/helper types come first)
  const used = new Set();
  for (const body of msgs.values()) for (const m of msgs.keys()) if (new RegExp(`\\b${m}\\s+\\w+\\s*=`).test(body)) used.add(m);
  const roots = [...msgs.keys()].filter((m) => !used.has(m));
  const first = (roots.length ? roots : [...msgs.keys()]).at(-1);
  const out = [];
  const walk = (body, prefix, depth) => {
    const bodyWoNested = body.replace(/message\s+\w+\s*\{[^{}]*\}/g, "");
    for (const f of bodyWoNested.matchAll(/(optional|repeated|required)?\s*([\w.<>, ]+?)\s+(\w+)\s*=\s*\d+/g)) {
      const label = f[1]; const ftype = f[2].trim(); const fname = f[3];
      if (RESERVED.has(ftype)) continue;
      if (msgs.has(ftype) && depth < 2) { walk(msgs.get(ftype), prefix + fname + ".", depth + 1); continue; }
      out.push({ name: prefix + fname, type_text: ((label === "repeated" ? "REPEATED " : "") + ftype).toUpperCase(), nullable: label !== "required", comment: "", isPK: false });
    }
  };
  walk(msgs.get(first), "", 0);
  return out;
}

const withScheme = (u) => (/^https?:\/\//i.test(u) ? u : "https://" + u);

export async function inspectSchemaRegistry({ url, user, password, subjectFilter, tlsVerify = true, schema: schemaName = "topics" } = {}, { transport = httpRequest } = {}) {
  const base = withScheme(String(url || "").trim().replace(/\/+$/, ""));
  const common = { headers: { Accept: "application/vnd.schemaregistry.v1+json, application/json" }, auth: user ? { user, password } : undefined, tlsVerify, timeoutMs: 60000 };
  const r = await transport(`${base}/subjects`, common);
  if (r.status === 401 || r.status === 403) throw new ConnectorError(`The schema registry refused the credentials (HTTP ${r.status})`);
  if (!r.ok) throw new ConnectorError(`Schema registry: HTTP ${r.status}`);
  let subjects = [...r.json()].map(String).sort();
  const filt = lower(subjectFilter).trim();
  if (filt) subjects = subjects.filter((x) => lower(x).startsWith(filt) || lower(x).includes(filt));
  const topics = new Map();
  for (const subj of subjects) {
    const [topic, part] = subj.endsWith("-value") ? [subj.slice(0, -6), "value"] : subj.endsWith("-key") ? [subj.slice(0, -4), "key"] : [subj, "value"];
    const rv = await transport(`${base}/subjects/${encodeURIComponent(subj)}/versions/latest`, common);
    if (!rv.ok) continue;
    const info = rv.json();
    const stype = String(info.schemaType || "AVRO").toUpperCase();
    const raw = info.schema || "";
    let cols, doc;
    try {
      if (stype === "AVRO") {
        const sch = JSON.parse(raw);
        cols = isObj(sch) && sch.type === "record" ? avroFields(sch) : [{ name: part, type_text: avroType(sch).toUpperCase(), nullable: false, comment: "", isPK: false }];
        doc = isObj(sch) ? sch.doc || "" : "";
      } else if (stype === "JSON") {
        const sch = JSON.parse(raw); cols = jsonSchemaFields(sch); doc = sch.description || sch.title || "";
      } else { cols = protoFields(raw); doc = ""; }
    } catch (e) { cols = []; doc = `schema not parsed: ${e.message}`; }
    if (!topics.has(topic)) topics.set(topic, { name: topic, type: "TOPIC", comment: "", columns: [], _meta: [] });
    const t = topics.get(topic);
    if (part === "key") { t.columns = cols.map((c) => ({ ...c, name: `key.${c.name}`, isPK: true, nullable: false })).concat(t.columns); }
    else { t.columns = t.columns.concat(cols); if (doc) t.comment = doc; }
    t._meta.push(`${part}: ${stype} id ${info.id} v${info.version}`);
  }
  const tables = [];
  for (const t of topics.values()) { const meta = t._meta.join(" · "); delete t._meta; t.comment = (t.comment ? t.comment + " " : "") + `[${meta}]`; tables.push(t); }
  if (!tables.length) throw new ConnectorError("No subjects found in the schema registry" + (filt ? ` matching '${subjectFilter}'` : ""));
  tables.sort((a, b) => (lower(a.name) < lower(b.name) ? -1 : lower(a.name) > lower(b.name) ? 1 : 0));
  return [{ name: schemaName || "topics", comment: "", tables }];
}
