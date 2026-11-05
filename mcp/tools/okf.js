/* MCP tools: OKF bundle export. */
import { load, okfSelection } from "../lookups.js";
import { S, str, enumT } from "../schema.js";
import { buildOkfBundle } from "../../okf.js";
import JSZip from "jszip";

export default ({ readCatalog, appVersion }) => [
  /* ── OKF export ── */
  { name: "export_okf", description: "Export the catalog (or one hub / database / schema / table) as an Open Knowledge Format (OKF v0.2) bundle: Markdown files with YAML frontmatter, one concept per file, linked as a graph with index.md per level. format 'files' (default) returns { path: content }; 'zip_base64' returns a base64-encoded zip. For large catalogs prefer the MCP resources (okf://…) and read only what you need.",
    inputSchema: S({ hub: str("Restrict to one hub (optional)"), database: str("Restrict to one database (optional)"),
      schema: str("Restrict to one schema 'database.schema' (optional)"), table: str("Restrict to one table 'database.schema.table' (optional)"),
      format: enumT(["files", "zip_base64"], "'files' (default) or 'zip_base64'") }),
    run: async (a) => { const { catalog: c, version } = await readCatalog();
      if (!c) throw new Error("The catalog is empty");
      const sel = okfSelection(c, a);
      await load(c, sel.tableIds === null ? null : sel.tableIds);   /* a selection loads only its tables' attributes */
      const files = await buildOkfBundle(c, sel, { version: appVersion(), catalogVersion: version, title: "Alassio Data Catalog" });
      if (a.format === "zip_base64") {
        const zip = new JSZip(); const root = zip.folder("alassio-catalog-okf");
        for (const [p, content] of Object.entries(files)) root.file(p, content);
        return { filename: "alassio-catalog-okf.zip", files: Object.keys(files).length, zip_base64: await zip.generateAsync({ type: "base64" }) };
      }
      return { files_count: Object.keys(files).length, files }; } },
];
