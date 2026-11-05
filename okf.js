/**
 * Alassio Data Catalog — Open Knowledge Format (OKF v0.2) export.
 *
 * Builds an OKF bundle: a directory of Markdown files with YAML frontmatter,
 * one concept per file, the file path being the concept's identity, concepts
 * linked with relative Markdown links, an index.md per directory and a log.md
 * at the root. The only field OKF requires is `type`; all other frontmatter
 * fields are producer-defined (this catalog's metadata + provenance).
 *
 * buildOkfBundle(catalog, selection, meta, emit?, attrsOf?) → Promise<{ "path/file.md": "content", ... }> (or the file count with emit)
 *   attrsOf(tableId) (sync or async) streams attributes per table instead of reading catalog.attributes (v1.59)
 */

import { effOwnerId, effStewardId, effDomainId, catalogIndex } from "./permissions.js";
import { isSourceHub } from "./src/lib/model.js";

const kvObj = (tags) => { const o = {}; for (const k of tags || []) o[k.key] = o[k.key] ? `${o[k.key]}, ${k.value}` : k.value; return o; };
const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
const y = (v) => {
  /* YAML scalar: quote strings, keep booleans/numbers, null → null */
  if (v === null || v === undefined || v === "") return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  return `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ")}"`;
};
const yList = (arr) => (arr && arr.length ? "\n" + arr.map((x) => `  - ${y(x)}`).join("\n") : " []");
const md = (s) => String(s || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const rel = (fromDir, toPath) => {
  /* relative Markdown link from directory `fromDir` to file `toPath` */
  const a = fromDir ? fromDir.split("/") : [], b = toPath.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill(".."), ...b.slice(i)].join("/") || toPath;
};

const groupBy = (list, key) => { const m = new Map(); for (const x of list || []) { const k = x[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };

/* Builds the bundle. Without `emit` the files are returned as { path: content }; with `emit(path, content)` every
   file is handed over as soon as it is rendered (the server streams them into a zip) and the file count is returned.
   All lookups use hash maps, so 400,000 attributes render in seconds. */
export async function buildOkfBundle(catalog, selection, meta, emit = null, attrsOf = null) {
  const c = catalog;
  const { tableIds = null, schemaIds = [], databaseIds = [] } = selection || {};
  const selTb = tableIds ? new Set(tableIds) : null;
  const selSc = new Set(schemaIds), selDb = new Set(databaseIds);
  const now = new Date().toISOString();
  const producer = `Alassio Data Catalog v${meta?.version || "?"}`;
  const files = emit ? null : {};
  let fileCount = 0;
  const put = (path, content) => { fileCount++; if (emit) emit(path, content); else files[path] = content; };

  const ix = catalogIndex(c);
  const hub = (id) => ix.hub.get(id);
  const db = (id) => ix.db.get(id);
  const schema = (id) => ix.sc.get(id);
  const table = (id) => ix.tb.get(id);
  const peopleById = new Map((c.people || []).map((p) => [p.id, p]));
  const person = (id) => peopleById.get(id);
  const domain = (id) => ix.dm.get(id);
  const dbLayer = (d) => d?.layer || "other";
  const isSource = (d) => isSourceHub(hub(d?.hubId));
  const dbsOfHub = groupBy(c.databases, "hubId"), scsOfDb = groupBy(c.schemas, "databaseId"), tbsOfSc = groupBy(c.tables, "schemaId"), atsOfTb = attrsOf ? null : groupBy(c.attributes, "tableId");
  const attrsFor = attrsOf || ((id) => atsOfTb.get(id) || []);
  const upsOf = groupBy(c.lineage, "to"), downsOf = groupBy(c.lineage, "from");

  /* selection semantics identical to the CSV export */
  const tbIn = (t) => selTb === null || selTb.has(t.id);
  const scIn = (sc) => selTb === null || selSc.has(sc.id) || (tbsOfSc.get(sc.id) || []).some(tbIn);
  const dbIn = (d) => selTb === null || selDb.has(d.id) || (scsOfDb.get(d.id) || []).some(scIn);

  /* stable, unique paths */
  const used = new Set();
  const uniq = (p) => { let q = p, n = 2; while (used.has(q)) q = p.replace(/(\.md|\/index\.md)$/, `-${n++}$1`); used.add(q); return q; };
  const hubDir = {}, dbDir = {}, scDir = {}, tbPath = {}, personPath = {}, domainPath = {};

  const usedPeople = new Set(), usedDomains = new Set();
  const front = (obj) => "---\n" + Object.entries(obj).map(([k, v]) => Array.isArray(v) ? `${k}:${yList(v)}` : typeof v === "object" && v !== null ? `${k}:\n${Object.entries(v).map(([k2, v2]) => `  ${k2}: ${y(v2)}`).join("\n")}` : `${k}: ${y(v)}`).join("\n") + "\n---\n";
  const prov = { producer, exported_at: now, catalog_version: meta?.catalogVersion ?? null };

  /* assign paths first (links need them) */
  for (const h of c.hubs) {
    if (!(dbsOfHub.get(h.id) || []).some(dbIn)) continue;
    hubDir[h.id] = `hubs/${slugify(h.name)}`;
    for (const d of (dbsOfHub.get(h.id) || []).filter(dbIn)) {
      dbDir[d.id] = `${hubDir[h.id]}/${slugify(d.name)}`;
      if (d.domainId) usedDomains.add(d.domainId);
      for (const sc of (scsOfDb.get(d.id) || []).filter(scIn)) {
        scDir[sc.id] = `${dbDir[d.id]}/${slugify(sc.name)}`;
        for (const t of (tbsOfSc.get(sc.id) || []).filter(tbIn)) {
          tbPath[t.id] = uniq(`${scDir[sc.id]}/${slugify(t.name)}.md`);
          if (t.stewardId) usedPeople.add(t.stewardId);
          if (t.ownerId) usedPeople.add(t.ownerId);
        }
      }
    }
    for (const dh of h.dataHubs || []) if (dh.bpoId) usedPeople.add(dh.bpoId);
    for (const d of dbsOfHub.get(h.id) || []) {
      for (const k of ["ownerId", "stewardId"]) if (d[k]) usedPeople.add(d[k]);
      for (const sc of scsOfDb.get(d.id) || []) for (const k of ["ownerId", "stewardId"]) if (sc[k]) usedPeople.add(sc[k]);
    }
  }
  for (const dmId of usedDomains) { const dm = domain(dmId); if (dm) for (const k of ["ownerId", "stewardId"]) if (dm[k]) usedPeople.add(dm[k]); }
  for (const pid of usedPeople) { const p = person(pid); if (p) personPath[pid] = uniq(`people/${slugify(p.name)}.md`); }
  for (const dmId of usedDomains) { const dm = domain(dmId); if (dm) domainPath[dmId] = uniq(`domains/${slugify(dm.name)}.md`); }

  const link = (fromDir, toPath, label) => `[${label}](${rel(fromDir, toPath)})`;
  const personLink = (fromDir, pid) => (pid && personPath[pid]) ? link(fromDir, personPath[pid], person(pid).name) : null;
  const dirOf = (p) => p.split("/").slice(0, -1).join("/");

  /* people & domains */
  for (const [pid, p] of Object.entries(personPath)) {
    const per = person(pid);
    put(p, front({ type: "person", title: per.name, id: per.id, ...(per.role ? { role: per.role } : {}), ...(per.email ? { email: per.email } : {}), provenance: prov })
      + `# ${per.name}\n\n${per.role ? `Role: ${per.role}\n\n` : ""}`);
  }
  for (const [dmId, p] of Object.entries(domainPath)) {
    const dm = domain(dmId); const dir = dirOf(p);
    const owner = personLink(dir, dm.ownerId), steward = personLink(dir, dm.stewardId);
    put(p, front({ type: "data_domain", title: dm.name, id: dm.id, provenance: prov })
      + `# ${dm.name}\n\n${dm.description || ""}\n\n## Governance\n\n- Data owner: ${owner || "—"}\n- Data steward: ${steward || "—"}\n`);
  }

  /* hubs → databases → schemas → tables */
  const rootChildren = [];
  for (const [hid, dir] of Object.entries(hubDir)) {
    const h = hub(hid);
    const dbs = (dbsOfHub.get(hid) || []).filter((x) => dbDir[x.id]);
    put(`${dir}/index.md`, front({ type: "data_hub", title: h.name, id: h.id, tags: ["data-hub"], provenance: prov })
      + `# ${h.name}\n\n${h.description || ""}\n\n## Governance\n\n- Data hubs and BPOs: ${(h.dataHubs || []).map((dh) => `${dh.name} (${personLink(dir, dh.bpoId) || "no BPO"}${dh.leanixUrl ? `, [LeanIX](${dh.leanixUrl})` : ""})`).join(", ") || "—"}\n\n## Databases\n\n`
      + dbs.map((d) => `- ${link(dir, `${dbDir[d.id]}/index.md`, d.name)} — ${d.country || "GLOBAL"} · ${dbLayer(d)}`).join("\n") + "\n");
    rootChildren.push(`- ${link("", `${dir}/index.md`, h.name)} (${dbs.length} databases)`);

    for (const d of dbs) {
      const ddir = dbDir[d.id];
      const scs = (scsOfDb.get(d.id) || []).filter((x) => scDir[x.id]);
      const dm = domain(effDomainId(c, "database", d.id, ix));
      put(`${ddir}/index.md`, front({
        type: "database", title: d.name, id: d.id, data_hub_type: h.name, data_hub: d.country || "GLOBAL",
        medallion_layer: isSource(d) ? "source" : dbLayer(d), source_system: d.source || "manual",
        ...(d.sourceType ? { source_type: d.sourceType } : {}), ...(d.sourceRef ? { source_ref: { kind: d.sourceRef.kind, ...(d.sourceRef.host ? { host: d.sourceRef.host } : {}), ...(d.sourceRef.url ? { url: d.sourceRef.url } : {}), ...(d.sourceRef.catalog ? { catalog: d.sourceRef.catalog } : {}) } } : {}), ...(dm ? { data_domain: dm.name } : {}),
        tags: ["database", dbLayer(d)], provenance: prov,
      }) + `# ${d.name}\n\n${d.description || ""}\n\n## Governance\n\n- Data domain: ${dm && domainPath[dm.id] ? link(ddir, domainPath[dm.id], dm.name) : "—"}\n- Data owner: ${personLink(ddir, effOwnerId(c, "database", d.id, ix)) || "—"}\n- Data steward: ${personLink(ddir, effStewardId(c, "database", d.id, ix)) || "—"}\n\n## Schemas\n\n`
        + scs.map((sc) => `- ${link(ddir, `${scDir[sc.id]}/index.md`, sc.name)}${dbLayer(d) === "gold" ? " — data product" : ""}`).join("\n") + "\n");

      for (const sc of scs) {
        const sdir = scDir[sc.id];
        const tbs = (tbsOfSc.get(sc.id) || []).filter((x) => tbPath[x.id]);
        put(`${sdir}/index.md`, front({ type: "schema", title: sc.name, id: sc.id, database: d.name, data_hub: h.name, data_product: dbLayer(d) === "gold", tags: dbLayer(d) === "gold" ? ["schema", "data-product"] : ["schema"], ...((sc.kvTags || []).length ? { schema_tags: kvObj(sc.kvTags) } : {}), provenance: prov })
          + `# ${d.name}.${sc.name}\n\n${sc.description || ""}\n\n## Tables\n\n` + tbs.map((t) => `- ${link(sdir, tbPath[t.id], t.name)} (${t.type || "TABLE"})`).join("\n") + "\n");

        for (const t of tbs) {
          const p = tbPath[t.id]; const tdir = dirOf(p);
          const attrs = (await attrsFor(t.id)) || [];
          const ups = upsOf.get(t.id) || [], downs = downsOf.get(t.id) || [];
          const tblLink = (id) => { const tt = table(id); if (!tt) return "(unknown)"; if (tbPath[id]) return link(tdir, tbPath[id], tt.name); const s2 = schema(tt.schemaId), d2 = db(s2?.databaseId); return `${d2?.name}.${s2?.name}.${tt.name} (not in export)`; };
          const attrName = (id) => ix.at.get(id)?.name || "?";
          const mapLines = (e) => (e.mappings || []).length ? " — attributes: " + e.mappings.map((m) => `${attrName(m.from)} → ${attrName(m.to)}`).join(", ") : "";
          put(p, front({
            type: "table", title: t.name, id: t.id, path: `${d.name}.${sc.name}.${t.name}`, object_type: t.type || "TABLE",
            data_hub_type: h.name, data_hub: d.country || "GLOBAL", medallion_layer: isSource(d) ? "source" : dbLayer(d),
            ...(t.stewardId && person(t.stewardId) ? { data_steward: person(t.stewardId).name } : {}),
            ...(domain(effDomainId(c, "table", t.id, ix)) ? { data_domain: domain(effDomainId(c, "table", t.id, ix)).name } : {}),
            ...(t.ownerId && person(t.ownerId) ? { data_owner: person(t.ownerId).name } : {}),
            ...(t.businessTerm ? { glossary_term: t.businessTerm } : {}),
            tags: [...(t.tags ? String(t.tags).split(/[,\s]+/).filter(Boolean) : []), "table"],
            ...((t.kvTags || []).length ? { table_tags: kvObj(t.kvTags) } : {}), provenance: prov,
          })
            + `# ${d.name}.${sc.name}.${t.name}\n\n${t.description || ""}\n\n`
            + (t.businessDefinition ? `## Business definition\n\n${t.businessDefinition}\n\n` : "")
            + `## Governance\n\n- Data owner: ${personLink(tdir, effOwnerId(c, "table", t.id, ix)) || "—"}\n- Data steward: ${personLink(tdir, effStewardId(c, "table", t.id, ix)) || "—"}\n- Schema: ${link(tdir, `${sdir}/index.md`, `${d.name}.${sc.name}`)}\n\n`
            + `## Attributes\n\n| Attribute | Data type | Nullable | PK | Sensitivity | Classification | Business term | Description |\n|---|---|---|---|---|---|---|---|\n`
            + attrs.map((a) => `| ${md(a.name)} | ${md(a.dataType)} | ${a.nullable !== false ? "yes" : "no"} | ${a.isPK ? "yes" : ""} | ${md(a.sensitivity || "Internal")} | ${md(a.classification)} | ${md(a.businessTerm)} | ${md(a.description)} |`).join("\n") + "\n\n"
            + `## Lineage\n\n### Upstream sources\n\n${ups.length ? ups.map((e) => `- ${tblLink(e.from)}${mapLines(e)}`).join("\n") : "- —"}\n\n### Downstream consumers\n\n${downs.length ? downs.map((e) => `- ${tblLink(e.to)}${mapLines(e)}`).join("\n") : "- —"}\n`);
        }
      }
    }
  }

  /* glossary terms */
  const glossPath = {}, glossById = new Map((c.glossary || []).map((g) => [g.id, g]));
  for (const g of c.glossary || []) glossPath[g.id] = uniq(`glossary/${slugify(g.name)}.md`);
  for (const g of c.glossary || []) {
    const p = glossPath[g.id]; const dir = dirOf(p);
    const refLine = (r) => {
      if (r.type === "hub" && hubDir[r.id]) return link(dir, `${hubDir[r.id]}/index.md`, hub(r.id)?.name);
      if (r.type === "database" && dbDir[r.id]) return link(dir, `${dbDir[r.id]}/index.md`, db(r.id)?.name);
      if (r.type === "schema" && scDir[r.id]) return link(dir, `${scDir[r.id]}/index.md`, schema(r.id)?.name);
      if (r.type === "table" && tbPath[r.id]) return link(dir, tbPath[r.id], table(r.id)?.name);
      if (r.type === "attribute") { const a = ix.at.get(r.id); const t = a && table(a.tableId); return t && tbPath[t.id] ? `${link(dir, tbPath[t.id], t.name)} › ${a.name}` : `${r.type} ${a?.name || r.id} (not in export)`; }
      return `${r.type} (not in export)`;
    };
    const gdm = g.domainId && domain(g.domainId);
    put(p, front({ type: "glossary_term", title: g.name, id: g.id, tags: ["glossary"], linked_entities: (g.refs || []).length,
      ...(gdm ? { data_domain: gdm.name } : {}), ...(g.ownerId && person(g.ownerId) ? { data_owner: person(g.ownerId).name } : {}), ...(g.stewardId && person(g.stewardId) ? { data_steward: person(g.stewardId).name } : {}), provenance: prov })
      + `# ${g.name}\n\n${g.definition || ""}\n\n## Linked entities\n\n${(g.refs || []).length ? g.refs.map((r) => `- ${refLine(r)}`).join("\n") : "- —"}\n\n## External resources\n\n${(g.urls || []).length ? g.urls.map((u) => `- [${u.name}](${u.url})`).join("\n") : "- —"}\n\n_Attached files (if any) are stored in the catalog database and are not part of this bundle._\n`);
  }

  const counts = { hubs: Object.keys(hubDir).length, databases: Object.keys(dbDir).length, schemas: Object.keys(scDir).length, tables: Object.keys(tbPath).length };
  put("index.md", front({ type: "catalog", title: meta?.title || "Alassio Data Catalog", okf_version: "0.2", tags: ["catalog"], provenance: prov, counts })
    + `# ${meta?.title || "Alassio Data Catalog"}\n\nOKF bundle exported from the Alassio Data Catalog. Concepts: data hubs → databases → schemas → tables (with attributes and lineage), plus people and data domains.\n\n## Data hubs\n\n${rootChildren.join("\n")}\n`
    + (Object.keys(domainPath).length ? `\n## Data domains\n\n${Object.entries(domainPath).map(([id, p]) => `- ${link("", p, domain(id).name)}`).join("\n")}\n` : "")
    + (Object.keys(personPath).length ? `\n## People\n\n${Object.entries(personPath).map(([id, p]) => `- ${link("", p, person(id).name)}`).join("\n")}\n` : "")
    + (Object.keys(glossPath).length ? `\n## Glossary\n\n${Object.entries(glossPath).map(([id, p]) => `- ${link("", p, glossById.get(id)?.name)}`).join("\n")}\n` : ""));
  put("log.md", `# Log\n\n- ${now} — bundle exported by ${producer} (${counts.hubs} hubs, ${counts.databases} databases, ${counts.schemas} schemas, ${counts.tables} tables, ${Object.keys(glossPath).length} glossary terms)\n`);
  return emit ? fileCount : files;
}
