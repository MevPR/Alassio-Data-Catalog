/* MCP tools: list, read, create, update and delete glossary terms. */
import { uid } from "../../src/lib/model.js";
import { glossFind, resolveRefs, refPath, assertUniqueName } from "../lookups.js";
import { S, str, enumT } from "../schema.js";
import { deleteGlossaryTerm } from "../../src/lib/catalog-ops.js";

const REF_TYPES = ["hub", "database", "schema", "table", "attribute"];

export default ({ readCatalog, mutate }) => [
  /* ── glossary ── */
  { name: "list_glossary_terms", description: "List glossary terms (name, definition excerpt, number of linked entities and external links). Optional text filter.",
    inputSchema: S({ query: str("Filter by name/definition (optional)") }),
    run: async (a) => { const { catalog: c } = await readCatalog(); const s = String(a.query || "").toLowerCase();
      return (c.glossary || []).filter((g) => !s || g.name.toLowerCase().includes(s) || (g.definition || "").toLowerCase().includes(s))
        .map((g) => ({ name: g.name, definition: (g.definition || "").slice(0, 200), linked_entities: (g.refs || []).length, external_links: (g.urls || []).length })); } },
  { name: "get_glossary_term", description: "Full glossary term: definition, linked entities (as paths), external links. Attached files are stored in the catalog database and listed by name via the UI.",
    inputSchema: S({ term: str("Term name") }, ["term"]),
    run: async (a) => { const { catalog: c } = await readCatalog(); const g = glossFind(c, a.term);
      if (typeof c.$loadByIds === "function") await c.$loadByIds((g.refs || []).filter((r) => r.type === "attribute").map((r) => r.id));
      return { name: g.name, definition: g.definition || "", data_domain: c.domains.find((d) => d.id === g.domainId)?.name || null, owner: c.people.find((p) => p.id === g.ownerId)?.name || null, steward: c.people.find((p) => p.id === g.stewardId)?.name || null, linked_entities: (g.refs || []).map((r) => ({ type: r.type, path: refPath(c, r) })), external_links: g.urls || [] }; } },
  { name: "create_glossary_term", mutating: true, description: "Create a glossary term. references: [{type: hub|database|schema|table|attribute, path}] using the usual path syntax; external_links: [{name, url}].",
    inputSchema: S({ name: str("Term name"), definition: str("Free-text definition"),
      references: { type: "array", description: "Linked entities", items: { type: "object", properties: { type: enumT(REF_TYPES, "hub|database|schema|table|attribute"), path: str("Path, e.g. GOLD.partners.loss_ratio") }, required: ["type", "path"] } },
      external_links: { type: "array", description: "Named URLs", items: { type: "object", properties: { name: str("Label"), url: str("https://…") }, required: ["url"] } } }, ["name"]),
    run: async (a) => mutate(async (c) => {
      c.glossary = c.glossary || [];
      assertUniqueName(c.glossary, a.name, { label: "Glossary term" });
      c.glossary.push({ id: uid(), name: a.name, definition: a.definition || "", refs: await resolveRefs(c, a.references), urls: (a.external_links || []).map((u) => ({ name: u.name || u.url, url: u.url })) });
      return `Glossary term "${a.name}" created.`; }) },
  { name: "update_glossary_term", mutating: true, description: "Update a glossary term: rename, definition, replace linked entities and/or external links (arrays replace the existing lists).",
    inputSchema: S({ term: str("Current term name"), new_name: str("(optional)"), definition: str("(optional)"),
      references: { type: "array", description: "(optional) replaces linked entities", items: { type: "object", properties: { type: enumT(REF_TYPES, "hub|database|schema|table|attribute"), path: str("Path") }, required: ["type", "path"] } },
      external_links: { type: "array", description: "(optional) replaces external links", items: { type: "object", properties: { name: str("Label"), url: str("URL") }, required: ["url"] } } }, ["term"]),
    run: async (a) => mutate(async (c) => { const g = glossFind(c, a.term);
      if (a.new_name) { assertUniqueName(c.glossary, a.new_name, { exceptId: g.id, label: "Glossary term" }); g.name = a.new_name; }
      if (a.definition !== undefined) g.definition = a.definition;
      if (a.references) g.refs = await resolveRefs(c, a.references);
      if (a.external_links) g.urls = a.external_links.map((u) => ({ name: u.name || u.url, url: u.url }));
      return `Glossary term updated: ${g.name}.`; }) },
  { name: "delete_glossary_term", mutating: true, description: "Delete a glossary term (its attached files are removed from the database as well).",
    inputSchema: S({ term: str("Term name") }, ["term"]),
    run: async (a) => mutate((c) => { const g = glossFind(c, a.term); deleteGlossaryTerm(c, g.id); return `Glossary term "${g.name}" deleted.`; }) },
];
