import { GitBranch, Plus } from "lucide-react";
import { LAYERS, LAYER_COLOR } from "../lib/model.js";
import { useT } from "../i18n.jsx";
import { useCatalogData, useNav } from "../catalog-context.jsx";

const NW = 232, NH = 58, GX = 110, GY = 18, X0 = 16, Y0 = 62;

/* Lays the linked tables out in layer columns (source → bronze → silver → gold → other); pure, so it is unit-testable. */
export function layoutLineage({ tables, schemas, lineage, layerOf, isDataProduct, upstreamOf, downstreamOf }, linSc) {
  const linked = tables.filter((t) => upstreamOf(t.id).length > 0 || downstreamOf(t.id).length > 0);
  let shown = linked;
  if (linSc !== "all") {
    const reach = new Set(linked.filter((t) => t.schemaId === linSc).map((t) => t.id));
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of lineage) {
        if (reach.has(e.from) && !reach.has(e.to)) { reach.add(e.to); grew = true; }
        if (reach.has(e.to) && !reach.has(e.from)) { reach.add(e.from); grew = true; }
      }
    }
    shown = linked.filter((t) => reach.has(t.id));
  }
  const cols = ["source", ...LAYERS].map((L) => ({
    layer: L,
    items: shown.filter((t) => layerOf(t) === L).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((c) => (c.layer !== "other" && c.layer !== "source") || c.items.length > 0);
  const pos = {};
  cols.forEach((c, ci) => c.items.forEach((t, ri) => { pos[t.id] = { x: X0 + ci * (NW + GX), y: Y0 + ri * (NH + GY) }; }));
  const maxRows = Math.max(1, ...cols.map((c) => c.items.length));
  const W = X0 + cols.length * (NW + GX) + 10, H = Y0 + maxRows * (NH + GY) + 24;
  const edges = lineage.filter((e) => pos[e.from] && pos[e.to]);
  return { shown, cols, pos, W, H, edges, goldSchemas: schemas.filter(isDataProduct) };
}

/* lineage view: bronze → silver → gold (linked tables only) */
export function LineageView() {
  const { t: tr } = useT();
  const data = useCatalogData();   /* layoutLineage reads the lookups */
  const { canEdit, schema, db, hub, layerOf, upstreamOf, downstreamOf } = data;
  const { linSc, setLinSc, setModal, openRef } = useNav();
  const { shown, cols, pos, W, H, edges, goldSchemas } = layoutLineage(data, linSc);
  return (
    <>
      <div className="entity-head">
        <div className="entity-icon"><GitBranch size={22} /></div>
        <div>
          <h1 className="entity-title">{tr("Data lineage")}</h1>
          <div className="entity-sub">{tr("Data flow from SOURCE systems across the medallion layers — only tables with at least one lineage link are shown. Pick a data product (schema in a gold-layer database) to trace its full feeding chain. Click an arrow to map attributes between the two tables.")}</div>
        </div>
        <div className="head-actions">
          <select className="btn" value={linSc} onChange={(e) => setLinSc(e.target.value)} aria-label={tr("Filter by gold data product")}>
            <option value="all">{tr("All linked tables — pick a data product…")}</option>
            {goldSchemas.map((sc) => { const d = db(sc.databaseId); return <option key={sc.id} value={sc.id}>{hub(d?.hubId)?.name} · {d?.name}.{sc.name}</option>; })}
          </select>
          {canEdit && <button className="btn btn-primary" onClick={() => setModal({ kind: "edge" })}><Plus size={15} /> {tr("Add lineage link")}</button>}
        </div>
      </div>
      <div className="lin-wrap" style={{ marginTop: 18 }}>
        <div style={{ position: "relative", width: W, height: H, minWidth: "100%" }}>
          <svg width={W} height={H} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <defs>
              <marker id="lin-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
                <path d="M0,0 L9,4.5 L0,9 z" fill="#A9AFB3" />
              </marker>
            </defs>
            {edges.map((e) => {
              const p1 = pos[e.from], p2 = pos[e.to];
              const x1 = p1.x + NW, y1 = p1.y + NH / 2, x2 = p2.x, y2 = p2.y + NH / 2;
              const d = `M ${x1} ${y1} C ${x1 + 55} ${y1}, ${x2 - 55} ${y2}, ${x2} ${y2}`;
              const mapped = (e.mappings || []).length > 0;
              return (
                <g key={e.id}>
                  <path d={d} fill="none" stroke={mapped ? "var(--accent)" : "#A9AFB3"} strokeWidth={mapped ? 2.1 : 1.6} markerEnd="url(#lin-arrow)" />
                  <path d={d} fill="none" stroke="transparent" strokeWidth="14" style={{ pointerEvents: "stroke", cursor: "pointer" }}
                    onClick={() => setModal({ kind: "edgemap", edgeId: e.id })}>
                    <title>{tr("Map attributes between the two tables")}</title>
                  </path>
                </g>
              );
            })}
          </svg>
          {cols.map((c, ci) => (
            <div key={c.layer} className="lin-col-h" style={{ left: X0 + ci * (NW + GX), color: LAYER_COLOR[c.layer] }}>
              {c.layer.toUpperCase()} <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {c.items.length}</span>
            </div>
          ))}
          {cols.flatMap((c) => c.items).map((t) => {
            const sc = schema(t.schemaId); const d = db(sc?.databaseId); const p = pos[t.id];
            return (
              <button key={t.id} className="lin-node" style={{ left: p.x, top: p.y, borderLeft: `3px solid ${LAYER_COLOR[layerOf(t)]}` }}
                onClick={() => openRef({ type: "table", id: t.id, tab: "lineage" })}>
                <div className="lin-name">{t.name}</div>
                <div className="lin-sub">{d?.name}.{sc?.name} · {upstreamOf(t.id).length}↑ {downstreamOf(t.id).length}↓</div>
              </button>
            );
          })}
          {!shown.length && <div className="empty" style={{ position: "absolute", left: 16, top: 62, right: 16 }}>{linSc !== "all" ? tr("No tables with lineage links for this data product.") : tr("No tables with lineage links yet — add links on a table's Lineage tab or import them from Unity Catalog.")}</div>}
        </div>
      </div>
    </>
  );
}
