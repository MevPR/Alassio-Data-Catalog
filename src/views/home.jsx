import { useEffect, useState } from "react";
import { Boxes, GitBranch, Plus } from "lucide-react";
import { effOwnerId, effStewardId } from "../../permissions.js";
import { HubIcon, clickable } from "../components/ui.jsx";
import { useT } from "../i18n.jsx";
import { useCatalogData, useNav } from "../catalog-context.jsx";
import { UsagePanel } from "../components/collab.jsx";
import { apiGetOr } from "../lib/api.js";

/* dashboard: coverage KPIs and the data hub type cards */
export function HomeView() {
  const { t: tr, tn } = useT();
  const { state, lazy, catalogVersion, hubs, domains, databases, schemas, tables, attributes, dbsOf, schemasOf, tablesOf, attrCount, isDataProduct, dataHubsOf, canStructure } = useCatalogData();
  const { setSel, setView, setModal, setLinSc } = useNav();
  const effOwner = (d) => effOwnerId(state, "database", d.id);
  const scOwner = (sc) => effOwnerId(state, "schema", sc.id) || tablesOf(sc.id).some((t) => t.ownerId);
  const scSteward = (sc) => effStewardId(state, "schema", sc.id) || tablesOf(sc.id).some((t) => t.stewardId);
  const tbSteward = (t) => effStewardId(state, "table", t.id);
  const products = schemas.filter(isDataProduct);
  const productIds = new Set(products.map((p) => p.id));
  const productTables = tables.filter((t) => productIds.has(t.schemaId));
  const productTableIds = new Set(productTables.map((t) => t.id));
  /* attribute counts come from the server for lazy catalogs (the lite document has no attributes) */
  const productAttrs = lazy.on ? productTables.reduce((n, t) => n + attrCount(t.id), 0) : attributes.filter((a) => productTableIds.has(a.tableId)).length;
  /* v1.66: attribute coverage is computed on the server (/api/stats) — the browser never needs the attributes for it */
  const [stats, setStats] = useState(null);
  useEffect(() => { let on = true; apiGetOr("/api/stats").then((j) => { if (on && j?.stats) setStats(j.stats); }); return () => { on = false; }; }, [catalogVersion]);   /* v1.73: once per confirmed save, not per local patch */
  const owners = new Set([...hubs.flatMap((h) => (h.dataHubs || []).map((x) => x.bpoId)), ...[...domains, ...databases, ...schemas, ...tables].map((x) => x.ownerId)].filter(Boolean));
  const stewards = new Set([...domains, ...databases, ...schemas, ...tables].map((x) => x.stewardId).filter(Boolean));
  const pct = (n, d) => d ? Math.round((n / d) * 100) : 0;
  const kpis = [
    ["Databases with owner", pct(databases.filter(effOwner).length, databases.length)],
    ["Tables with data steward", pct(tables.filter(tbSteward).length, tables.length)],
    ["Data products with owner", pct(products.filter(scOwner).length, products.length)],
    ["Data products with steward", pct(products.filter(scSteward).length, products.length)],
    ...(stats ? [["Tables with description", pct(stats.tablesWithDescription, stats.tables)], ["Attributes with description", pct(stats.attributesWithDescription, stats.attributes)], ["Attributes with sensitivity", pct(stats.attributesWithSensitivity, stats.attributes)], ["Attributes with business term", pct(stats.attributesWithBusinessTerm, stats.attributes)]] : []),
  ];
  const objectsIn = (hId) => {
    const ds = dbsOf(hId);
    const scs = ds.flatMap((d) => schemasOf(d.id));
    const tbs = scs.flatMap((sc) => tablesOf(sc.id));
    const ats = tbs.reduce((n, t) => n + attrCount(t.id), 0);
    return ds.length + scs.length + tbs.length + ats;
  };
  const objectsTotal = databases.length + schemas.length + tables.length + (lazy.on ? (lazy.stats?.attributes || 0) : attributes.length);
  const kpiColor = (p) => p >= 80 ? "var(--green)" : p >= 50 ? "var(--amber)" : "var(--red)";
  return (
    <>
      <div className="entity-head">
        <div className="entity-icon"><Boxes size={22} /></div>
        <div>
          <h1 className="entity-title">{tr("Dashboard")}</h1>
          <div className="entity-sub">{tr("Catalog coverage and governance at a glance. Ownership is inherited from data domains and hubs; data products are schemas in gold-layer databases.")}</div>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => { setLinSc("all"); setView("lineage"); }}><GitBranch size={15} /> {tr("Full lineage")}</button>
          {canStructure && <button className="btn" onClick={() => setModal({ kind: "hub" })}><Plus size={15} /> {tr("New data hub type")}</button>}
          {canStructure && <button className="btn btn-primary" onClick={() => setModal({ kind: "database" })}><Plus size={15} /> {tr("New database")}</button>}
        </div>
      </div>
      <div className="stat-grid" style={{ marginTop: 20 }}>
        <div className="stat-card"><div className="stat-num">{hubs.length}</div><div className="stat-label">{tr("Data hub types")}</div><div className="stat-sub">{objectsTotal} {tr("objects in total")}</div></div>
        <div className="stat-card"><div className="stat-num">{products.length}</div><div className="stat-label">{tr("Data products (schemas in gold layer)")}</div><div className="stat-sub">{productTables.length} {tr("tables")} · {productAttrs} {tr("attributes")}</div></div>
        <div className="stat-card"><div className="stat-num">{owners.size}</div><div className="stat-label">{tr("Data owners")}</div><div className="stat-sub">{tr("BPOs of data hubs, owners of domains, databases, schemas, tables")}</div></div>
        <div className="stat-card"><div className="stat-num">{stewards.size}</div><div className="stat-label">{tr("Data stewards")}</div><div className="stat-sub">{tr("on domains, databases, schemas, tables")}</div></div>
      </div>
      <div className="stat-grid" style={{ marginTop: 14 }}>
        {kpis.map(([label, p]) => (
          <div key={label} className="stat-card">
            <div className="stat-num" style={{ color: kpiColor(p) }}>{p}%</div>
            <div className="stat-label">{tr(label)}</div>
            <div className="stat-bar"><div className="stat-bar-fill" style={{ width: `${p}%`, background: kpiColor(p) }} /></div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 18 }}><UsagePanel onOpenTable={(id) => setSel({ type: "table", id })} /></div>
      <h3 style={{ marginTop: 26, marginBottom: 12, fontSize: 16 }}>{tr("Data hubs")}</h3>
      <div className="cards">
        {hubs.map((h) => (
          <div key={h.id} className="card hub-card" {...clickable(() => setSel({ type: "hub", id: h.id }))}>
            <div className="card-title hub-t"><span style={{ color: "var(--brand)" }}><HubIcon hubId={h.id} size={17} /></span> {h.name}</div>
            <div className="card-desc">{h.description}</div>
            <div className="card-meta">
              <span className="chip chip-grey">{tn(["{n} database", "{n} databases"], dbsOf(h.id).length)}</span>
              <span className="chip chip-grey">{objectsIn(h.id)} {tr("objects")}</span>
              <span className="chip chip-grey">{tn(["{n} data hub", "{n} data hubs"], dataHubsOf(h).length)}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
