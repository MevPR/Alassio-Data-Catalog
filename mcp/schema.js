/* Tool input schemas: the small schema builders and the argument validator (v1.69 — moved out of mcp.js). */
export const S = (props, required = []) => ({ type: "object", properties: props, required, additionalProperties: false });

/* v1.67 (pentest L9): tool arguments are checked against the tool's inputSchema before the tool runs — types, required
   keys, enum values, no unknown keys where the schema closes the object, and size caps (strings 20 000 characters,
   arrays 1 000 items, nesting depth 8). The subset covers what the schemas above use; the first problem is returned
   as a JSON-RPC "invalid params" error instead of letting a wrong shape reach the catalog logic. */
export const MAX_STRING = 20000, MAX_ITEMS = 1000, MAX_DEPTH = 8;
export const validateArgs = (schema, value, path = "arguments", depth = 0) => {
  if (!schema || typeof schema !== "object") return null;
  if (depth > MAX_DEPTH) return `${path}: nesting too deep`;
  const t = schema.type;
  if (t === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return `${path} must be an object`;
    const props = schema.properties || {};
    for (const k of schema.required || []) if (value[k] === undefined || value[k] === null) return `${path}.${k} is required`;
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined || v === null) continue;   /* an optional key sent as null counts as absent */
      if (Object.hasOwn(props, k)) { const e = validateArgs(props[k], v, `${path}.${k}`, depth + 1); if (e) return e; }
      else if (schema.additionalProperties === false) return `${path}.${k} is not a known parameter`;
      else if (depth + 1 > MAX_DEPTH || (typeof v === "string" && v.length > MAX_STRING)) return `${path}.${k} is too large`;
    }
    return null;
  }
  if (t === "string") {
    if (typeof value !== "string") return `${path} must be a string`;
    if (value.length > (schema.maxLength ?? MAX_STRING)) return `${path} is longer than ${schema.maxLength ?? MAX_STRING} characters`;
    if (schema.enum && !schema.enum.includes(value)) return `${path} must be one of ${schema.enum.join(", ")}`;
    return null;
  }
  if (t === "number" || t === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return `${path} must be a number`;
    if (t === "integer" && !Number.isInteger(value)) return `${path} must be an integer`;
    if (schema.minimum !== undefined && value < schema.minimum) return `${path} must be at least ${schema.minimum}`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${path} must be at most ${schema.maximum}`;
    return null;
  }
  if (t === "boolean") return typeof value === "boolean" ? null : `${path} must be true or false`;
  if (t === "array") {
    if (!Array.isArray(value)) return `${path} must be an array`;
    if (value.length > (schema.maxItems ?? MAX_ITEMS)) return `${path} has more than ${schema.maxItems ?? MAX_ITEMS} items`;
    if (schema.items) for (let i = 0; i < value.length; i++) { const e = validateArgs(schema.items, value[i], `${path}[${i}]`, depth + 1); if (e) return e; }
    return null;
  }
  return null;
};
/* v1.74 (F-M1 of the third review): the validator treats an optional key sent as null as absent — so does the tool.
   JSON clients send null for "not set"; passing it on made update_table { description: null } store null. Keys whose
   value is null are dropped from objects at every level the validator walked (array items keep their positions). */
export const withoutNulls = (value) => {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (value === null || typeof value !== "object") return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) if (v !== null && v !== undefined) out[k] = withoutNulls(v);
  return out;
};
export const str = (description) => ({ type: "string", description });
export const boolT = (description) => ({ type: "boolean", description });
/* v1.71 (F-M2): bounds and enums live in the schema so validateArgs rejects them before a tool runs (a negative limit used
   to reach SQL as LIMIT -5, a bad layer was silently guessed by create_database but rejected by update_database) */
const bounds = ({ min, max } = {}) => ({ ...(min !== undefined ? { minimum: min } : {}), ...(max !== undefined ? { maximum: max } : {}) });
export const num = (description, range) => ({ type: "number", description, ...bounds(range) });
export const int = (description, range) => ({ type: "integer", description, ...bounds(range) });
export const enumT = (values, description) => ({ type: "string", enum: [...values], description });
