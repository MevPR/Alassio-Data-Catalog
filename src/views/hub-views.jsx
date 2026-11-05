import { Database, Globe, ShieldCheck, Landmark, ExternalLink, Pencil, Trash2, Plus, History } from "lucide-react";
import { LAYER_COLOR } from "../lib/model.js";
import { usePaged, HubIcon, clickable } from "../components/ui.jsx";
import { useT } from "../i18n.jsx";
import { useActions, useCatalogData, useNav } from "../catalog-context.jsx";
import { Crumb } from "./shared.jsx";
import { HomeView } from "./home.jsx";

/* Data Hub Type (top level) */
export function HubView() {
  const { t: tr, tn } = useT();
  const { hub, dbsOf, dbLayer, dataHubsOf, canEdit, canStructure } = useCatalogData();
  const { sel, setSel, setModal } = useNav();
  const { deleteHub } = useActions();
  const paged = usePaged();
  const h = hub(sel.id); if (!h) return <HomeView />;
  const dhs = dataHubsOf(h);
  return (
    <>
      <Crumb />
      <div className="entity-head">
        <div className="entity-icon"><HubIcon hubId={h.id} size={22} /></div>
        <div>
          <h1 className="entity-title">{h.name} · Data Hub Type</h1>
          <div className="entity-sub">{h.description}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <span className="chip chip-grey">{tr("Data hub type — no owner; the BPO is assigned per data hub")}</span>
          </div>
        </div>
        <div className="head-actions">
          {canEdit && <button className="btn" onClick={() => setModal({ kind: "history", scopeId: h.id, title: `${h.name} Data Hub` })}><History size={14} /> {tr("History")}</button>}
          {canStructure && <button className="btn" onClick={() => setModal({ kind: "hub", edit: h })}><Pencil size={14} /> {tr("Edit type")}</button>}
          {canStructure && <button className="btn btn-danger" onClick={() => deleteHub(h)} aria-label={tr("Delete data hub type")}><Trash2 size={14} /></button>}
          {canStructure && <button className="btn btn-primary" onClick={() => setModal({ kind: "datahub", hubTypeId: h.id })}><Plus size={15} /> {tr("New data hub")}</button>}
        </div>
      </div>
      <h3 style={{ margin: "20px 0 8px" }}>{tr("Data hubs")} <span className="chip chip-grey">{dhs.length}</span></h3>
      {!dhs.length && <div className="empty">{tr("No data hubs yet — create the first one (e.g. SALES_DE); databases are created inside a data hub.")}</div>}
      <div className="cards">
        {paged.slice("cards", dhs, 60).map((dh) => {
          const dbs = dbsOf(h.id).filter((x) => (x.country || "GLOBAL") === dh.name);
          return (
            <div key={dh.name} className="card" {...clickable(() => setSel({ type: "datahub", hubId: h.id, name: dh.name }))}>
              <div className="card-title mono-t"><Globe size={15} /> {dh.name}</div>
              <div className="card-desc">{dh.description || tr("No description yet.")}</div>
              <div className="card-meta">
                <span className="chip chip-grey">{tn(["{n} database", "{n} databases"], dbs.length)}</span>
                {dh.leanixUrl && <a className="chip chip-grey" href={dh.leanixUrl} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}><ExternalLink size={11} /> LeanIX</a>}
                {[...new Set(dbs.map((x) => dbLayer(x)))].map((l) => <span key={l} className="chip" style={{ background: "#F1EDE8", color: LAYER_COLOR[l] }}>{l.toUpperCase()}</span>)}
              </div>
            </div>
          );
        })}
      </div>
      {paged.more("cards", dhs, 60)}
    </>
  );
}

/* Data Hub (free-text level below the type, e.g. SALES_DE) */
export function DataHubView() {
  const { t: tr, tn } = useT();
  const { hub, person, domain, dbsOf, schemasOf, dbLayer, dataHubsOf, canStructure } = useCatalogData();
  const { sel, setSel, setModal } = useNav();
  const { deleteDataHub } = useActions();
  const paged = usePaged();
  const h = hub(sel.hubId); if (!h) return <HomeView />;
  const dh = dataHubsOf(h).find((x) => x.name === sel.name) || { name: sel.name, description: "" };
  const dbs = dbsOf(h.id).filter((x) => (x.country || "GLOBAL") === dh.name);
  return (
    <>
      <Crumb />
      <div className="entity-head">
        <div className="entity-icon"><Globe size={22} /></div>
        <div>
          <h1 className="entity-title mono-t">{dh.name}</h1>
          <div className="entity-sub">{dh.description || tr("Data hub")} · <span className="chip chip-brand"><HubIcon hubId={h.id} size={12} /> {h.name}</span></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            {dh.bpoId ? <span className="chip chip-amber"><ShieldCheck size={12} /> BPO · {person(dh.bpoId)?.name}</span> : <span className="chip chip-grey">{tr("No BPO assigned yet")}</span>}
            {dh.domainId && <span className="chip chip-blue"><Landmark size={12} /> {domain(dh.domainId)?.name}</span>}
            {dh.leanixUrl && <a className="chip chip-grey" href={dh.leanixUrl} target="_blank" rel="noreferrer noopener"><ExternalLink size={12} /> LeanIX</a>}
          </div>
        </div>
        <div className="head-actions">
          {canStructure && <button className="btn" onClick={() => setModal({ kind: "datahub", hubTypeId: h.id, edit: { id: `dh:${dh.name}`, name: dh.name, description: dh.description, bpoId: dh.bpoId || "", domainId: dh.domainId || "", leanixUrl: dh.leanixUrl || "" } })}><Pencil size={14} /> {tr("Edit data hub")}</button>}
          {canStructure && <button className="btn btn-danger" onClick={() => deleteDataHub(h.id, dh.name)} aria-label={tr("Delete data hub")}><Trash2 size={14} /></button>}
          {canStructure && <button className="btn btn-primary" onClick={() => setModal({ kind: "database", presetHubId: h.id, presetCountry: dh.name })}><Plus size={15} /> {tr("New database")}</button>}
        </div>
      </div>
      {!dbs.length && <div className="empty" style={{ marginTop: 20 }}>{tr("No databases in this data hub yet — e.g. BRONZE, SILVER, GOLD.")}</div>}
      <div className="cards" style={{ marginTop: 20 }}>
        {paged.slice("cards", dbs, 60).map((d) => (
          <div key={d.id} className="card" {...clickable(() => setSel({ type: "database", id: d.id }))}>
            <div className="card-title mono-t"><Database size={15} /> {d.name}</div>
            <div className="card-desc">{d.description || tr("No description yet.")}</div>
            <div className="card-meta">
              <span className="chip" style={{ background: "#F1EDE8", color: LAYER_COLOR[dbLayer(d)] }}>{dbLayer(d).toUpperCase()}</span>
              <span className="chip chip-grey">{tn(["{n} schema", "{n} schemas"], schemasOf(d.id).length)}</span>
            </div>
          </div>
        ))}
      </div>
      {paged.more("cards", dbs, 60)}
    </>
  );
}
