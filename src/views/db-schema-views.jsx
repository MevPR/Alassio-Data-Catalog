import { Database, Layers, Table2, Plug, Pencil, Trash2, Plus, History, Send, GitBranch } from "lucide-react";
import { sourceLabel } from "../lib/model.js";
import { hasRole } from "../lib/roles.js";
import { usePaged, clickable } from "../components/ui.jsx";
import { useT } from "../i18n.jsx";
import { useToast } from "../toast-context.jsx";
import { CollabPanel, RatingStars, useCollab } from "../components/collab.jsx";
import { useActions, useCatalogData, useNav } from "../catalog-context.jsx";
import { Crumb, GovLine, ProjectTags } from "./shared.jsx";
import { CertChip, AttestationLine } from "../components/stewardship.jsx";
import { HomeView } from "./home.jsx";

/* Database */
export function DbView() {
  const { t: tr, tn } = useT();
  const { db, schemasOf, tablesOf, isGoldSchema, canEdit, canStructure } = useCatalogData();
  const { sel, setSel, setView, setModal, setMpPreset } = useNav();
  const { removeEntity } = useActions();
  const { confirm } = useToast();
  const paged = usePaged();
  const d = db(sel.id); if (!d) return <HomeView />;
  const scs = schemasOf(d.id);
  return (
    <>
      <Crumb />
      <div className="entity-head">
        <div className="entity-icon blue"><Database size={22} /></div>
        <div>
          <h1 className="entity-title mono">{d.name}</h1>
          <div className="entity-sub">{d.description || tr("No description yet.")}</div>
          <GovLine hubId={d.hubId} country={d.country || "GLOBAL"} dmId={d.domainId} assetType="database" assetId={d.id} />
          <AttestationLine kind="database" obj={d} />
          {d.sourceRef && <div style={{ marginTop: 6 }}><span className="chip chip-grey"><Plug size={12} /> {tr("Source:")} {sourceLabel(d.sourceRef)}</span></div>}
        </div>
        <div className="head-actions">
          {canEdit && <button className="btn" onClick={() => setModal({ kind: "history", scopeId: d.id, title: d.name })}><History size={14} /> {tr("History")}</button>}
          {canStructure && <button className="btn" onClick={() => setModal({ kind: "database", edit: d })}><Pencil size={14} /> {tr("Edit")}</button>}
          {canStructure && <button className="btn btn-danger" aria-label={tr("Delete")} title={tr("Delete")} onClick={async () => (await confirm("Delete database \"{name}\" and everything in it?", { name: d.name }, { danger: true })) && removeEntity("database", d.id)}><Trash2 size={14} /></button>}
          {canStructure && <button className="btn btn-primary" onClick={() => setModal({ kind: "schema", parentId: d.id })}><Plus size={15} /> {tr("New schema")}</button>}
        </div>
      </div>
      <div className="cards" style={{ marginTop: 20 }}>
        {paged.slice("cards", scs, 60).map((sc) => (
          <div key={sc.id} className="card" {...clickable(() => setSel({ type: "schema", id: sc.id }))}>
            <div className="card-title mono-t"><Layers size={15} /> {sc.name}</div>
            <div className="card-desc">{sc.description || tr("No description yet.")}</div>
            <div className="card-meta">
              <span className="chip chip-grey">{tn(["{n} table", "{n} tables"], tablesOf(sc.id).length)}</span>
              {isGoldSchema(sc) && <span className="chip chip-amber">{tr("Data product")}</span>}
            </div>
            {isGoldSchema(sc) && (
              <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={(e) => { e.stopPropagation(); setMpPreset({ productId: sc.id }); setView("marketplace"); }}>
                <Send size={13} /> {tr("Request access")}
              </button>
            )}
          </div>
        ))}
        {scs.length === 0 && <div className="empty">{tr("This database has no schemas. Add the first one.")}</div>}
        {paged.more("cards", scs, 60)}
      </div>
    </>
  );
}

/* Schema (a schema in a gold-layer database is a data product) */
export function SchemaView() {
  const { t: tr } = useT();
  const { schema, db, tablesOf, attrCount, isGoldSchema, perm, canEdit, canStructure, me, isAdmin } = useCatalogData();
  const { sel, setSel, setView, setModal, setMpPreset, setLinSc } = useNav();
  const { removeEntity } = useActions();
  const { confirm } = useToast();
  const paged = usePaged();
  const sc = schema(sel.id);
  const collab = useCollab("schema", sc?.id);   /* v1.73: shared by the header stars and the Discussion panel */
  if (!sc) return <HomeView />;
  const d = db(sc.databaseId);
  const tbs = tablesOf(sc.id);
  return (
    <>
      <Crumb />
      <div className="entity-head">
        <div className="entity-icon blue"><Layers size={22} /></div>
        <div>
          <h1 className="entity-title mono" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>{sc.name} {isGoldSchema(sc) && <RatingStars rating={collab.data?.rating} onRate={collab.rate} />}</h1>
          <div className="entity-sub">{sc.description || tr("No description yet.")}</div>
          <GovLine hubId={d?.hubId} country={d?.country || "GLOBAL"} dmId={d?.domainId} assetType="schema" assetId={sc.id} />
          <AttestationLine kind="schema" obj={sc} />
          {isGoldSchema(sc) && <ProjectTags kind="schema" id={sc.id} tags={sc.kvTags} canEdit={perm.isAdmin || perm.responsible("schema", sc.id)} />}
        </div>
        <div className="head-actions">
          {isGoldSchema(sc) && <button className="btn" onClick={() => { setLinSc(sc.id); setView("lineage"); }}><GitBranch size={14} /> {tr("Full lineage")}</button>}
          {isGoldSchema(sc) && <button className="btn" onClick={() => { setMpPreset({ productId: sc.id }); setView("marketplace"); }}><Send size={14} /> {tr("Request access")}</button>}
          {canEdit && <button className="btn" onClick={() => setModal({ kind: "history", scopeId: sc.id, title: sc.name })}><History size={14} /> {tr("History")}</button>}
          {canStructure && <button className="btn" onClick={() => setModal({ kind: "schema", edit: sc, parentId: sc.databaseId })}><Pencil size={14} /> {tr("Edit")}</button>}
          {canStructure && <button className="btn btn-danger" aria-label={tr("Delete")} title={tr("Delete")} onClick={async () => (await confirm("Delete schema \"{name}\" and its tables?", { name: sc.name }, { danger: true })) && removeEntity("schema", sc.id)}><Trash2 size={14} /></button>}
          {perm.canCreateTableIn(sc.id) && <button className="btn btn-primary" onClick={() => setModal({ kind: "table", parentId: sc.id })}><Plus size={15} /> {tr("New table")}</button>}
        </div>
      </div>
      <div className="cards" style={{ marginTop: 20 }}>
        {paged.slice("cards", tbs, 60).map((t) => (
          <div key={t.id} className="card" {...clickable(() => setSel({ type: "table", id: t.id }))}>
            <div className="card-title mono-t"><Table2 size={15} /> {t.name}</div>
            <div className="card-desc">{t.description || tr("No description yet.")}</div>
            <div className="card-meta">
              <span className="chip chip-grey chip-mono">{t.type}</span>
              <span className="chip chip-grey">{attrCount(t.id)} {tr("attributes")}</span>
              <CertChip t={t} size={11} />
            </div>
          </div>
        ))}
        {tbs.length === 0 && <div className="empty">{tr("No tables in this schema yet.")}</div>}
        {paged.more("cards", tbs, 60)}
      </div>
      <details style={{ marginTop: 22 }} open={isGoldSchema(sc)}>
        <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 15, marginBottom: 10 }}>{tr("Discussion")}</summary>
        <CollabPanel type="schema" id={sc.id} collab={collab} me={me} isAdmin={isAdmin} isSteward={hasRole(me, "steward")} />
      </details>
    </>
  );
}
