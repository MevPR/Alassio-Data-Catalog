/* MCP tools: table lineage links and their attribute mappings. */
import { uid } from "../../src/lib/model.js";
import { findTable, load, isUnityDb, sameName } from "../lookups.js";
import { S, str } from "../schema.js";

export default ({ mutate }) => [
  /* ── write: lineage ── */
  { name: "add_lineage", mutating: true, description: "Add a lineage link: data flows FROM the upstream table INTO the downstream table. Tables imported from Unity Catalog are locked (lineage managed in Databricks).",
    inputSchema: S({ from_table: str("Upstream 'database.schema.table'"), to_table: str("Downstream 'database.schema.table'") }, ["from_table", "to_table"]),
    run: async (a) => mutate((c) => {
      const A = findTable(c, a.from_table).tb, B = findTable(c, a.to_table).tb;
      if (A.id === B.id) throw new Error("from_table and to_table must differ");
      if (isUnityDb(c, A) || isUnityDb(c, B)) throw new Error("Lineage of Unity-Catalog-imported tables is managed in Databricks and cannot be edited here");
      if (c.lineage.some((e) => e.from === A.id && e.to === B.id)) throw new Error("This lineage link already exists");
      c.lineage.push({ id: uid(), from: A.id, to: B.id });
      return `Lineage link added: ${a.from_table} → ${a.to_table}.`; }) },
  { name: "remove_lineage", mutating: true, description: "Remove a lineage link between two tables (not for Unity-Catalog-imported tables).",
    inputSchema: S({ from_table: str("Upstream 'database.schema.table'"), to_table: str("Downstream 'database.schema.table'") }, ["from_table", "to_table"]),
    run: async (a) => mutate((c) => {
      const A = findTable(c, a.from_table).tb, B = findTable(c, a.to_table).tb;
      if (isUnityDb(c, A) || isUnityDb(c, B)) throw new Error("Lineage of Unity-Catalog-imported tables is managed in Databricks and cannot be edited here");
      const before = c.lineage.length;
      c.lineage = c.lineage.filter((e) => !(e.from === A.id && e.to === B.id));
      if (c.lineage.length === before) throw new Error("No such lineage link");
      return `Lineage link removed: ${a.from_table} → ${a.to_table}.`; }) },
  { name: "map_lineage_attributes", mutating: true, description: "On an existing lineage link, map an attribute of the upstream table onto an attribute of the downstream table (optional column-level lineage). Also allowed on Unity-Catalog links — the mapping is catalog enrichment, the link itself is not changed.",
    inputSchema: S({ from_table: str("Upstream 'database.schema.table'"), to_table: str("Downstream 'database.schema.table'"),
      from_attribute: str("Attribute name on the upstream table"), to_attribute: str("Attribute name on the downstream table") },
      ["from_table", "to_table", "from_attribute", "to_attribute"]),
    run: async (a) => mutate(async (c) => {
      const A = findTable(c, a.from_table).tb, B = findTable(c, a.to_table).tb;
      await load(c, [A.id, B.id]);
      const e = c.lineage.find((x) => x.from === A.id && x.to === B.id);
      if (!e) throw new Error(`No lineage link ${a.from_table} → ${a.to_table} — create it first with add_lineage`);
      const fa = c.attributes.find((x) => x.tableId === A.id && sameName(x.name, a.from_attribute));
      if (!fa) throw new Error(`Attribute "${a.from_attribute}" not found on ${a.from_table}`);
      const ta = c.attributes.find((x) => x.tableId === B.id && sameName(x.name, a.to_attribute));
      if (!ta) throw new Error(`Attribute "${a.to_attribute}" not found on ${a.to_table}`);
      e.mappings = e.mappings || [];
      if (e.mappings.some((m) => m.from === fa.id && m.to === ta.id)) throw new Error("This attribute pair is already mapped");
      e.mappings.push({ id: uid(), from: fa.id, to: ta.id });
      return `Mapped ${a.from_table}.${fa.name} → ${a.to_table}.${ta.name}.`; }) },
  { name: "unmap_lineage_attributes", mutating: true, description: "Remove an attribute mapping from a lineage link.",
    inputSchema: S({ from_table: str("Upstream 'database.schema.table'"), to_table: str("Downstream 'database.schema.table'"),
      from_attribute: str("Attribute name on the upstream table"), to_attribute: str("Attribute name on the downstream table") },
      ["from_table", "to_table", "from_attribute", "to_attribute"]),
    run: async (a) => mutate(async (c) => {
      const A = findTable(c, a.from_table).tb, B = findTable(c, a.to_table).tb;
      await load(c, [A.id, B.id]);
      const e = c.lineage.find((x) => x.from === A.id && x.to === B.id);
      if (!e) throw new Error(`No lineage link ${a.from_table} → ${a.to_table}`);
      const fa = c.attributes.find((x) => x.tableId === A.id && sameName(x.name, a.from_attribute));
      const ta = c.attributes.find((x) => x.tableId === B.id && sameName(x.name, a.to_attribute));
      const before = (e.mappings || []).length;
      e.mappings = (e.mappings || []).filter((m) => !(fa && ta && m.from === fa.id && m.to === ta.id));
      if (e.mappings.length === before) throw new Error("No such attribute mapping");
      return `Mapping removed: ${a.from_table}.${a.from_attribute} → ${a.to_table}.${a.to_attribute}.`; }) },
];
