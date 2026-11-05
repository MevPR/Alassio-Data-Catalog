/* MCP tools: read-only overview, listings, table details, lineage, search and audit trail. */
import { normCountry } from "../../src/lib/model.js";
import { findHub, findDb, findSchema, readTable, load, attrCount, dbLayer, tablePath, tablePathById } from "../lookups.js";
import { S, str, int } from "../schema.js";
import { dbSummary, tableDetail } from "../views.js";

export default ({ readCatalog, queryAudit, searchRows, collab, currentUser, isPrivileged }) => [
  /* ── read ── */
  { name: "get_overview", description: "Catalog overview: hubs, object counts, data products, governance KPI percentages.",
    inputSchema: S({}),
    run: async () => { const { catalog: c } = await readCatalog();
      const products = c.schemas.filter((s) => dbLayer(c.databases.find((d) => d.id === s.databaseId)) === "gold");
      return { hubs: c.hubs.map((h) => h.name), databases: c.databases.length, schemas: c.schemas.length,
        tables: c.tables.length, attributes: c.$stats ? c.$stats.attributes : c.attributes.length, data_products: products.length,
        lineage_links: c.lineage.length }; } },
  { name: "list_hubs", description: "List all data hubs with database counts.",
    inputSchema: S({}),
    run: async () => { const { catalog: c } = await readCatalog();
      return c.hubs.map((h) => ({ name: h.name, description: h.description || "",
        databases: c.databases.filter((d) => d.hubId === h.id).length })); } },
  { name: "list_databases", description: "List databases, optionally filtered by hub and/or country (ISO code or GLOBAL).",
    inputSchema: S({ hub: str("Hub name (optional)"), country: str("Country filter (optional)") }),
    run: async (a) => { const { catalog: c } = await readCatalog();
      let list = c.databases;
      if (a.hub) { const h = findHub(c, a.hub); list = list.filter((d) => d.hubId === h.id); }
      if (a.country) list = list.filter((d) => (d.country || "GLOBAL") === normCountry(a.country));
      return list.map((d) => dbSummary(c, d)); } },
  { name: "list_schemas", description: "List the schemas of a database (reference by name or hub/name).",
    inputSchema: S({ database: str("Database, e.g. 'sales_prod' or 'Sales/sales_prod'") }, ["database"]),
    run: async (a) => { const { catalog: c } = await readCatalog(); const d = findDb(c, a.database);
      return c.schemas.filter((s) => s.databaseId === d.id).map((s) => ({ path: `${d.name}.${s.name}`,
        description: s.description || "", is_data_product: dbLayer(d) === "gold",
        tables: c.tables.filter((t) => t.schemaId === s.id).length })); } },
  { name: "list_tables", description: "List tables of a schema ('db.schema') or of a whole database.",
    inputSchema: S({ schema: str("Schema path 'database.schema' (optional)"), database: str("Database name (optional)") }),
    run: async (a) => { const { catalog: c } = await readCatalog();
      let scs;
      if (a.schema) { const { sc } = findSchema(c, a.schema); scs = [sc]; }
      else if (a.database) { const d = findDb(c, a.database); scs = c.schemas.filter((s) => s.databaseId === d.id); }
      else throw new Error("Provide schema or database");
      return scs.flatMap((sc) => c.tables.filter((t) => t.schemaId === sc.id)
        .map((t) => ({ path: tablePath(c, t), type: t.type || "TABLE", description: t.description || "",
          attributes: attrCount(c, t.id) }))); } },
  { name: "get_table", description: "Full detail of one table incl. attributes and lineage ('database.schema.table').",
    inputSchema: S({ table: str("Table path 'database.schema.table'") }, ["table"]),
    run: async (a) => { const { c, d, sc, tb } = await readTable(readCatalog, a.table);
      await load(c, [tb.id]);
      const detail = tableDetail(c, d, sc, tb);
      if (collab) { const co = await collab.of("table", tb.id); detail.rating = co.rating; detail.openQuestions = co.openQuestions; detail.usage = co.usage; }
      return detail; } },
  { name: "list_data_products", description: "List all data products (schemas within gold-layer databases) with owner and steward.",
    inputSchema: S({}),
    run: async () => { const { catalog: c } = await readCatalog();
      return c.schemas.filter((s) => dbLayer(c.databases.find((d) => d.id === s.databaseId)) === "gold")
        .map((s) => { const d = c.databases.find((x) => x.id === s.databaseId);
          const dm = c.domains.find((x) => x.id === d.domainId); const h = c.hubs.find((x) => x.id === d.hubId);
          return { path: `${d.name}.${s.name}`, hub: h?.name, country: d.country || "GLOBAL",
            owner: c.people.find((p) => p.id === (dm?.ownerId || h?.ownerId))?.name || null,
            steward: c.people.find((p) => p.id === (dm?.stewardId || h?.stewardId))?.name || null,
            tables: c.tables.filter((t) => t.schemaId === s.id).length }; }); } },
  { name: "get_lineage", description: "Upstream and downstream lineage of a table, transitively (whole feeding chain).",
    inputSchema: S({ table: str("Table path 'database.schema.table'") }, ["table"]),
    run: async (a) => { const { c, tb } = await readTable(readCatalog, a.table);
      const walk = (startId, dir) => { const seen = new Set([startId]); const order = [];
        let frontier = [startId];
        while (frontier.length) { const next = [];
          for (const e of c.lineage) {
            const [fromK, toK] = dir === "up" ? ["to", "from"] : ["from", "to"];
            if (frontier.includes(e[fromK]) && !seen.has(e[toK])) { seen.add(e[toK]); next.push(e[toK]); order.push(e[toK]); } }
          frontier = next; }
        return order.map((id) => tablePathById(c, id)); };
      return { table: a.table, upstream_chain: walk(tb.id, "up"), downstream_chain: walk(tb.id, "down") }; } },
  /* v1.73 (F-M8): the fallback scan used to read c.attributes, which is empty on the server's lazy document (attributes
     load per table on demand) — unit fixtures saw attribute hits, production silently did not. Loading all attributes
     for a scan is not an option at 400k rows, so a lazy document scans hubs, databases, schemas and tables only, and the
     description says so; attributes are found through the server's full-text index (every term ≥ 3 characters). */
  { name: "search_catalog", description: "Full-text search across hubs, databases, schemas, tables and attributes (names, descriptions, business terms, tags). Attributes are matched through the server's full-text index, which needs every search term to have at least 3 characters; shorter terms (or a query the index does not match) fall back to a scan of hubs, databases, schemas and tables only.",
    inputSchema: S({ query: str("Search terms"), limit: int("Max results (default 20, max 100)", { min: 1, max: 100 }) }, ["query"]),
    run: async (a) => { const { catalog: c } = await readCatalog();
      const terms = String(a.query).toLowerCase().split(/\s+/).filter(Boolean);
      if (searchRows && terms.every((t) => t.length >= 3)) {
        const rows = await searchRows(a.query, a.limit || 20);
        if (rows.length) return rows.map((h) => {
          const r = h.record;
          const path = h.type === "table" ? tablePath(c, r) : h.type === "attribute" ? `${tablePathById(c, r.tableId)}.${r.name}`
            : h.type === "schema" ? `${c.databases.find((d) => d.id === r.databaseId)?.name}.${r.name}` : r.name;
          return { type: h.type, path };
        });
      }
      const docs = [];
      for (const h of c.hubs) docs.push({ type: "hub", path: h.name, text: `${h.name} ${h.description || ""}` });
      for (const d of c.databases) docs.push({ type: "database", path: d.name, text: `${d.name} ${d.description || ""} ${d.country || ""}` });
      for (const s of c.schemas) { const d = c.databases.find((x) => x.id === s.databaseId);
        docs.push({ type: "schema", path: `${d?.name}.${s.name}`, text: `${s.name} ${s.description || ""}` }); }
      for (const t of c.tables) docs.push({ type: "table", path: tablePath(c, t), text: `${t.name} ${t.description || ""} ${t.businessDefinition || ""} ${t.tags || ""}` });
      const allAttributes = typeof c.$load !== "function" || c.$loaded?.has("*");   /* full document, or a lazy one with everything loaded */
      for (const at of allAttributes ? c.attributes : []) { const t = c.tables.find((x) => x.id === at.tableId);
        docs.push({ type: "attribute", path: t ? `${tablePath(c, t)}.${at.name}` : at.name, text: `${at.name} ${at.description || ""} ${at.businessTerm || ""} ${at.dataType || ""}` }); }
      const hits = docs.map((doc) => ({ ...doc, score: terms.filter((t) => doc.text.toLowerCase().includes(t)).length }))
        .filter((x) => x.score === terms.length).slice(0, a.limit || 20)
        .map(({ type, path }) => ({ type, path }));
      return hits.length ? hits : "No matches."; } },
  { name: "get_audit", description: "Recent audit trail entries (catalog changes only; user-management entries are not exposed).",
    inputSchema: S({ limit: int("Max entries (default 25, max 100)", { min: 1, max: 100 }), query: str("Filter by name/context (optional)") }),
    run: async (a) => { if (!isPrivileged(currentUser())) throw new Error("get_audit needs the admin or steward role"); return queryAudit(a.limit || 25, a.query || null); } },
];
