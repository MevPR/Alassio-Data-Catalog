import { Search, Database, Layers, Table2, Columns3, X } from "lucide-react";
import { LAYERS, SENSITIVITY } from "../lib/model.js";
import { SensChip, HubIcon } from "../components/ui.jsx";
import { useT } from "../i18n.jsx";
import { useCatalogData, useNav } from "../catalog-context.jsx";

import { EMPTY_FACETS } from "../lib/search.js";
const typeIcon = (t, hubId) => t === "hub" ? <HubIcon hubId={hubId} size={16} /> : t === "database" ? <Database size={16} /> : t === "schema" ? <Layers size={16} /> : t === "table" ? <Table2 size={16} /> : <Columns3 size={16} />;

/* search results with facet filters */
/* object-type facet: value → full dictionary key (v1.73 — F-F9: the label used to be built at runtime, "Hub" + "s") */
const TYPE_LABEL = { hub: "Hubs", database: "Databases", schema: "Schemas", table: "Tables", attribute: "Attributes" };

export function SearchView() {
  const { t: tr } = useT();
  const { hubs, searchResults } = useCatalogData();
  const { query, setQuery, sFacet, setSFacet, openRef } = useNav();
  const go = (r) => { setQuery(""); openRef(r.type === "attribute" ? { type: "table", id: r.tableId, tab: "technical" } : r); };
  const facetsActive = sFacet.type || sFacet.hub || sFacet.layer || sFacet.sensitivity;
  const facet = (key) => (e) => setSFacet({ ...sFacet, [key]: e.target.value });
  return (
    <>
      <div className="entity-head">
        <div className="entity-icon"><Search size={22} /></div>
        <div>
          <h1 className="entity-title">{tr("Search results")}</h1>
          <div className="entity-sub">{searchResults.length}{searchResults.length === 100 ? "+" : ""} results for “{query.trim()}” — {tr("matched against names, descriptions, business definitions, business terms, tags, data types and stewards, ranked by relevance.")}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
        <select className="btn" value={sFacet.type} onChange={facet("type")} aria-label={tr("Filter by object type")}>
          <option value="">{tr("All object types")}</option>
          {Object.entries(TYPE_LABEL).map(([k, label]) => <option key={k} value={k}>{tr(label)}</option>)}
        </select>
        <select className="btn" value={sFacet.hub} onChange={facet("hub")} aria-label={tr("Filter by data hub")}>
          <option value="">{tr("All hubs")}</option>
          {hubs.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <select className="btn" value={sFacet.layer} onChange={facet("layer")} aria-label={tr("Filter by layer")}>
          <option value="">{tr("All layers")}</option>
          {LAYERS.map((l) => <option key={l} value={l}>{l[0].toUpperCase() + l.slice(1)}</option>)}
        </select>
        <select className="btn" value={sFacet.sensitivity} onChange={facet("sensitivity")} aria-label={tr("Filter by sensitivity")}>
          <option value="">{tr("All sensitivities")}</option>
          {SENSITIVITY.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {facetsActive && <button className="btn btn-ghost btn-sm" onClick={() => setSFacet(EMPTY_FACETS)}><X size={14} /> {tr("Clear filters")}</button>}
      </div>
      <div className="panel" style={{ marginTop: 14, padding: "4px 10px" }}>
        {searchResults.map((r) => (
          <button key={r.type + r.id} className="sr-row" onClick={() => go(r)}>
            <span style={{ color: "var(--accent)", flexShrink: 0 }}>{typeIcon(r.type, r.hubId)}</span>
            <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
              <div>
                <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</span>
                {r.context && <span className="audit-ctx" style={{ marginLeft: 8 }}>{r.context}</span>}
              </div>
              {r.match && <div className="sr-snippet"><b>{r.match.field}:</b> {String(r.match.value).slice(0, 130)}</div>}
            </div>
            <span className="audit-type">{r.type}</span>
            {r.layer && <span className="chip chip-grey">{r.layer}</span>}
            {r.sensitivity && <SensChip v={r.sensitivity} />}
          </button>
        ))}
        {!searchResults.length && <div style={{ padding: 18, color: "var(--muted)" }}>{tr("No matches. Try fewer or shorter words, or clear the facet filters.")}</div>}
      </div>
    </>
  );
}
