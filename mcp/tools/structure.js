/* MCP tools: create, update and delete hubs, databases, schemas and tables. */
import { LAYERS, uid, normCountry, guessLayer } from "../../src/lib/model.js";
import { findOrCreatePerson } from "../../src/lib/catalog-ops.js";
import { findHub, findDb, findSchema, withTable, personIdFor, assertUniqueName } from "../lookups.js";
import { S, str, boolT, enumT } from "../schema.js";
import { isSourceHub } from "../../src/lib/model.js";
import { removeEntity } from "../../src/lib/catalog-ops.js";

export default ({ mutate }) => [
  /* ── write: hubs ── */
  { name: "create_hub", mutating: true, description: "Create a new data hub type (Finance, HR, Sales, …). Types have no owner; data hubs inside a type carry the BPO.",
    inputSchema: S({ name: str("Data hub type name"), description: str("Description (optional)") }, ["name"]),
    run: async (a) => mutate((c) => {
      assertUniqueName(c.hubs, a.name, { label: "Hub" });
      c.hubs.push({ id: uid(), name: a.name, description: a.description || "", ownerId: null, stewardId: null, dataHubs: [] });
      return `Hub "${a.name}" created.`; }) },
  { name: "update_hub", mutating: true, description: "Rename a data hub type or change its description.",
    inputSchema: S({ hub: str("Current hub name"), new_name: str("New name (optional)"), description: str("New description (optional)") }, ["hub"]),
    run: async (a) => mutate((c) => { const h = findHub(c, a.hub);
      if (a.new_name) { assertUniqueName(c.hubs, a.new_name, { exceptId: h.id, label: "Hub" }); h.name = a.new_name; }
      if (a.description !== undefined) h.description = a.description;
      return `Hub updated: ${h.name}.`; }) },
  { name: "delete_hub", mutating: true, description: "Delete an EMPTY data hub (guards match the UI: must contain no databases; the last hub cannot be deleted).",
    inputSchema: S({ hub: str("Hub name") }, ["hub"]),
    run: async (a) => mutate((c) => { const h = findHub(c, a.hub);
      if (c.databases.some((d) => d.hubId === h.id)) throw new Error(`Hub "${h.name}" still contains databases — move or delete them first`);
      if (c.hubs.length <= 1) throw new Error("The last hub cannot be deleted");
      removeEntity(c, "hub", h.id);   /* v1.71 (F-M1): the cascade rules live in catalog-ops, shared with the UI */
      return `Hub "${h.name}" deleted.`; }) },
  /* ── write: databases ── */
  { name: "create_database", mutating: true, description: "Create a database in a hub (country ISO code or GLOBAL; medallion layer bronze/silver/gold/other).",
    inputSchema: S({ name: str("Database name"), hub: str("Hub name"), country: str("Country (default GLOBAL)"),
      layer: enumT(LAYERS, "Layer (default: guessed from name)"), description: str("Description (optional)") }, ["name", "hub"]),
    run: async (a) => mutate((c) => { const h = findHub(c, a.hub);
      assertUniqueName(c.databases.filter((d) => d.hubId === h.id), a.name, { label: "Database", where: `in hub ${h.name}` });
      const src = isSourceHub(h);
      c.databases.push({ id: uid(), name: a.name, description: a.description || "", hubId: h.id,
        country: normCountry(a.country), layer: src ? "other" : (a.layer || guessLayer(a.name)),
        domainId: null, source: "manual" });
      return `Database "${a.name}" created in hub ${h.name}.`; }) },
  { name: "update_database", mutating: true, description: "Update a database: rename, move to another hub, change country, layer or description.",
    inputSchema: S({ database: str("Database (name or hub/name)"), new_name: str("(optional)"), hub: str("Target hub (optional)"),
      country: str("(optional)"), layer: enumT(LAYERS, "(optional)"), description: str("(optional)") }, ["database"]),
    run: async (a) => mutate((c) => { const d = findDb(c, a.database);
      if (a.new_name || a.hub) {   /* a rename and a move can both collide — check the final name in the final hub */
        const h = a.hub ? findHub(c, a.hub) : c.hubs.find((x) => x.id === d.hubId);
        assertUniqueName(c.databases.filter((x) => x.hubId === h?.id), a.new_name || d.name, { exceptId: d.id, label: "Database", where: `in hub ${h?.name}` });
      }
      if (a.new_name) d.name = a.new_name;
      if (a.hub) d.hubId = findHub(c, a.hub).id;
      if (a.country) d.country = normCountry(a.country);
      if (a.layer) d.layer = a.layer;   /* the schema enum rejects an unknown layer (v1.71) */
      if (isSourceHub(c.hubs.find((h) => h.id === d.hubId))) d.layer = "other";
      if (a.description !== undefined) d.description = a.description;
      return `Database updated: ${d.name}.`; }) },
  { name: "delete_database", mutating: true, description: "Delete a database including all schemas, tables, attributes and their lineage links.",
    inputSchema: S({ database: str("Database (name or hub/name)") }, ["database"]),
    run: async (a) => mutate((c) => { const d = findDb(c, a.database);
      const scIds = c.schemas.filter((s) => s.databaseId === d.id).map((s) => s.id);
      const tbCount = c.tables.filter((t) => scIds.includes(t.schemaId)).length;
      removeEntity(c, "database", d.id);
      return `Database "${d.name}" deleted (${scIds.length} schemas, ${tbCount} tables).`; }) },
  /* ── write: schemas ── */
  { name: "create_schema", mutating: true, description: "Create a schema in a database.",
    inputSchema: S({ database: str("Database (name or hub/name)"), name: str("Schema name"), description: str("(optional)") }, ["database", "name"]),
    run: async (a) => mutate((c) => { const d = findDb(c, a.database);
      assertUniqueName(c.schemas.filter((s) => s.databaseId === d.id), a.name, { label: "Schema", where: `in ${d.name}` });
      c.schemas.push({ id: uid(), databaseId: d.id, name: a.name, description: a.description || "" });
      return `Schema "${d.name}.${a.name}" created.`; }) },
  { name: "update_schema", mutating: true, description: "Rename a schema or change its description.",
    inputSchema: S({ schema: str("Schema path 'database.schema'"), new_name: str("(optional)"), description: str("(optional)") }, ["schema"]),
    run: async (a) => mutate((c) => { const { d, sc } = findSchema(c, a.schema);
      if (a.new_name) { assertUniqueName(c.schemas.filter((s) => s.databaseId === d.id), a.new_name, { exceptId: sc.id, label: "Schema", where: `in ${d.name}` }); sc.name = a.new_name; }
      if (a.description !== undefined) sc.description = a.description;
      return `Schema updated: ${d.name}.${sc.name}.`; }) },
  { name: "delete_schema", mutating: true, description: "Delete a schema including its tables, attributes and lineage links.",
    inputSchema: S({ schema: str("Schema path 'database.schema'") }, ["schema"]),
    run: async (a) => mutate((c) => { const { d, sc } = findSchema(c, a.schema);
      const tbCount = c.tables.filter((t) => t.schemaId === sc.id).length;
      removeEntity(c, "schema", sc.id);
      return `Schema "${d.name}.${sc.name}" deleted (${tbCount} tables).`; }) },
  /* ── write: tables ── */
  { name: "create_table", mutating: true, description: "Create a table in a schema. The medallion layer is inherited from the database.",
    inputSchema: S({ schema: str("Schema path 'database.schema'"), name: str("Table name"), description: str("(optional)"),
      business_definition: str("(optional)"), steward: str("Steward person name (optional, find-or-create)"), owner: str("Data owner person name (optional, find-or-create)"), tags: str("(optional)") }, ["schema", "name"]),
    run: async (a) => mutate((c) => { const { d, sc } = findSchema(c, a.schema);
      assertUniqueName(c.tables.filter((t) => t.schemaId === sc.id), a.name, { label: "Table", where: `in ${d.name}.${sc.name}` });
      c.tables.push({ id: uid(), schemaId: sc.id, name: a.name, type: "TABLE", description: a.description || "",
        businessDefinition: a.business_definition || "", stewardId: findOrCreatePerson(c, a.steward), ownerId: findOrCreatePerson(c, a.owner), tags: a.tags || "" });
      return `Table "${d.name}.${sc.name}.${a.name}" created.`; }) },
  /* v1.73 (F-M6): steward/owner must name an existing person (case-insensitive) unless create_person is true; an unknown
     name is rejected with the closest existing names instead of silently creating a ghost person. "" still clears. */
  { name: "update_table", mutating: true, description: "Update a table: rename, description, business definition, steward, owner, tags. steward and owner must name an existing person (an unknown name is rejected with close matches) unless create_person is true; an empty string clears them.",
    inputSchema: S({ table: str("Table path 'database.schema.table'"), new_name: str("(optional)"), description: str("(optional)"),
      business_definition: str("(optional)"), steward: str("Steward person name (optional; existing person, \"\" clears)"), owner: str("Data owner person name (optional, overrides domain/hub; existing person, \"\" clears)"), tags: str("(optional)"),
      create_person: boolT("Create steward/owner as a new person when the name is unknown (default false)") }, ["table"]),
    run: async (a) => mutate(withTable(a.table, (c, { d, sc, tb }) => {
      const person = (name, role) => personIdFor(c, name, { create: a.create_person === true, role });
      const ownerId = a.owner !== undefined ? person(a.owner, "Owner") : undefined;   /* resolve both before changing anything */
      const stewardId = a.steward !== undefined ? person(a.steward, "Steward") : undefined;
      if (a.new_name) { assertUniqueName(c.tables.filter((t) => t.schemaId === tb.schemaId), a.new_name, { exceptId: tb.id, label: "Table", where: `in ${d.name}.${sc.name}` }); tb.name = a.new_name; }
      if (ownerId !== undefined) tb.ownerId = ownerId;
      if (a.description !== undefined) tb.description = a.description;
      if (a.business_definition !== undefined) tb.businessDefinition = a.business_definition;
      if (stewardId !== undefined) tb.stewardId = stewardId;
      if (a.tags !== undefined) tb.tags = a.tags;
      return `Table updated: ${d.name}.${sc.name}.${tb.name}.`; })) },
  { name: "delete_table", mutating: true, description: "Delete a table including its attributes and lineage links.",
    inputSchema: S({ table: str("Table path 'database.schema.table'") }, ["table"]),
    run: async (a) => mutate(withTable(a.table, (c, { d, sc, tb }) => {
      removeEntity(c, "table", tb.id);
      return `Table "${d.name}.${sc.name}.${tb.name}" deleted.`; })) },
];
