/* MCP tools: create, update and delete attributes (columns). */
import { uid, SENSITIVITY } from "../../src/lib/model.js";
import { withTable, findAttr, load, assertUniqueName } from "../lookups.js";
import { S, str, boolT, enumT } from "../schema.js";
import { CLASSES, removeEntity } from "../../src/lib/catalog-ops.js";

export default ({ mutate }) => [
  /* ── write: attributes ── */
  { name: "create_attribute", mutating: true, description: "Create an attribute (column) on a table.",
    inputSchema: S({ table: str("Table path 'database.schema.table'"), name: str("Attribute name"),
      data_type: str("Data type (default STRING)"), nullable: boolT("(default true)"), is_pk: boolT("(default false)"),
      sensitivity: enumT(SENSITIVITY, "Public, Internal, Confidential or PII (default Internal)"), classification: enumT(CLASSES, "C1, C2, C3 or C4 (optional)"), description: str("(optional)"),
      business_term: str("(optional)") }, ["table", "name"]),
    run: async (a) => mutate(withTable(a.table, async (c, { d, sc, tb }) => {
      await load(c, [tb.id]);
      assertUniqueName(c.attributes.filter((x) => x.tableId === tb.id), a.name, { label: "Attribute", where: `on ${a.table}` });
      c.attributes.push({ id: uid(), tableId: tb.id, name: a.name, dataType: a.data_type || "STRING",
        nullable: a.nullable !== false, isPK: !!a.is_pk, sensitivity: a.sensitivity || "Internal", classification: a.classification || "",
        description: a.description || "", businessTerm: a.business_term || "" });
      return `Attribute "${d.name}.${sc.name}.${tb.name}.${a.name}" created.`; })) },
  { name: "update_attribute", mutating: true, description: "Update an attribute: rename, data type, nullability, PK flag, sensitivity, description, business term.",
    inputSchema: S({ attribute: str("Path 'database.schema.table.attribute'"), new_name: str("(optional)"), data_type: str("(optional)"),
      nullable: boolT("(optional)"), is_pk: boolT("(optional)"), sensitivity: enumT(SENSITIVITY, "Public, Internal, Confidential or PII (optional)"), classification: enumT([...CLASSES, ""], "C1–C4 or empty (optional)"),
      description: str("(optional)"), business_term: str("(optional)") }, ["attribute"]),
    run: async (a) => mutate(async (c) => { const { d, sc, tb, at } = await findAttr(c, a.attribute);
      if (a.new_name) { assertUniqueName(c.attributes.filter((x) => x.tableId === tb.id), a.new_name, { exceptId: at.id, label: "Attribute", where: `on ${d.name}.${sc.name}.${tb.name}` }); at.name = a.new_name; }
      if (a.data_type !== undefined) at.dataType = a.data_type;
      if (a.nullable !== undefined) at.nullable = a.nullable;
      if (a.is_pk !== undefined) at.isPK = a.is_pk;
      if (a.sensitivity !== undefined) at.sensitivity = a.sensitivity;
      if (a.classification !== undefined) at.classification = a.classification;   /* "" clears; the schema enum rejects the rest (v1.71) */
      if (a.description !== undefined) at.description = a.description;
      if (a.business_term !== undefined) at.businessTerm = a.business_term;
      return `Attribute updated: ${at.name}.`; }) },
  { name: "delete_attribute", mutating: true, description: "Delete an attribute from a table.",
    inputSchema: S({ attribute: str("Path 'database.schema.table.attribute'") }, ["attribute"]),
    run: async (a) => mutate(async (c) => { const { tb, at } = await findAttr(c, a.attribute);
      removeEntity(c, "attribute", at.id);   /* v1.71 (F-M1) */
      return `Attribute "${at.name}" deleted from ${tb.name}.`; }) },
];
