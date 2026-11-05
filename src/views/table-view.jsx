import { useEffect } from "react";
import { Table2, Pencil, Trash2, Plus, History, Send, GitBranch, KeyRound, BookOpen, Tag, ArrowRight, Columns3, Landmark, CheckCircle2, Loader2 } from "lucide-react";
import { effOwnerId, effStewardId } from "../../permissions.js";
import { LAYER_COLOR, UC_LINEAGE_NOTE } from "../lib/model.js";
import { hasRole } from "../lib/roles.js";
import { usePaged, SensChip, HubIcon, clickable } from "../components/ui.jsx";
import { useT } from "../i18n.jsx";
import { useToast } from "../toast-context.jsx";
import { useActions, useCatalogData, useNav } from "../catalog-context.jsx";
import { Crumb, GovLine, ProjectTags } from "./shared.jsx";
import { HomeView } from "./home.jsx";
import { CertChip, ReviewChip, StewardshipPanel } from "../components/stewardship.jsx";
import { CollabPanel, RatingStars, UsageLine, useCollab } from "../components/collab.jsx";
import { TABLE_TABS as TABS } from "../lib/navigation.js";

const TAB_LABEL = { technical: "Technical", business: "Business", lineage: "Lineage", governance: "Governance", discussion: "Discussion" };

/* Table with the tabs Technical · Business · Lineage · Governance · Discussion */
export function TableView() {
  const { t: tr } = useT();
  const { confirm } = useToast();
  const { state, me, isAdmin, lazy, perm, table, schema, db, domain, hub, person, attrsOf, upstreamOf, downstreamOf, layerOf, isDataProduct, dataHubsOf, schemas, stewardshipPolicy } = useCatalogData();
  const { sel, setSel, setView, setModal, setLinSc, tableTab: tab, setTableTab: setTab } = useNav();
  const { removeEntity, ensureAttributes, askSteward } = useActions();
  const paged = usePaged();
  const t = table(sel.id);
  const collab = useCollab("table", t?.id);   /* v1.73: one request serves the header stars, the usage line and the Discussion tab */
  useEffect(() => { if (t) ensureAttributes(t.id); }, [t?.id]);
  if (!t) return <HomeView />;
  const sc = schema(t.schemaId); const d = db(sc?.databaseId); const dm = domain(d?.domainId); const h = hub(d?.hubId);
  const ucLocked = d?.source === "unity";
  const mayEdit = perm.canEditTable(t.id);
  const attrs = attrsOf(t.id);
  const dataHub = h ? dataHubsOf(h).find((x) => x.name === (d?.country || "GLOBAL")) : null;
  const openEdgeMap = (e) => async () => { await ensureAttributes(e.from); await ensureAttributes(e.to); setModal({ kind: "edgemap", edgeId: e.id }); };

  const edgeRow = (e, other) => (
    <div key={e.id} className="role-row edge-row" {...clickable(openEdgeMap(e))} title={tr("Map attributes between the two tables")}>
      <span className="chip" style={{ background: "#F1EDE8", color: LAYER_COLOR[layerOf(other)] }}>{layerOf(other).toUpperCase()}</span>
      <button className="btn btn-ghost btn-sm mono" onClick={(ev) => { ev.stopPropagation(); setSel({ type: "table", id: other.id }); }}>{other.name}</button>
      {(e.mappings || []).length > 0 && <span className="chip chip-blue"><Columns3 size={11} /> {(e.mappings || []).length} {tr("mapped")}</span>}
      {perm.canEditLineage(e.from, e.to) && <span style={{ marginLeft: "auto" }} title={ucLocked ? tr(UC_LINEAGE_NOTE) : undefined} onClick={(ev) => ev.stopPropagation()}><button className="btn btn-ghost btn-sm btn-danger" disabled={ucLocked} onClick={() => removeEntity("edge", e.id)} aria-label={tr("Remove lineage link")}><Trash2 size={13} /></button></span>}
    </div>
  );

  return (
    <>
      <Crumb />
      <div className="entity-head">
        <div className="entity-icon blue"><Table2 size={22} /></div>
        <div>
          <h1 className="entity-title mono" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>{t.name} <CertChip t={t} /> <ReviewChip t={t} policy={stewardshipPolicy} /> <RatingStars rating={collab.data?.rating} onRate={collab.rate} /></h1>
          <div className="entity-sub">{t.description || tr("No description yet.")}</div>
          {t.certStatus === "deprecated" && <div className="notice notice-err" style={{ marginTop: 8 }}><span>{tr("This table is deprecated")}{t.certNote ? ` — ${t.certNote}` : ""}{t.successorId && table(t.successorId) ? <> · {tr("successor")}: <button className="btn btn-ghost btn-sm mono" onClick={() => setSel({ type: "table", id: t.successorId })}>{table(t.successorId).name}</button></> : null}</span></div>}
          <GovLine hubId={d?.hubId} country={d?.country || "GLOBAL"} dmId={d?.domainId} assetType="table" assetId={t.id} />
          <ProjectTags kind="table" id={t.id} tags={t.kvTags} canEdit={mayEdit} />
        </div>
        <div className="head-actions">
          {mayEdit && <button className="btn" onClick={() => setModal({ kind: "history", scopeId: t.id, title: t.name })}><History size={14} /> {tr("History")}</button>}
          {mayEdit && <button className="btn" onClick={() => setModal({ kind: "table", edit: t, parentId: t.schemaId })}><Pencil size={14} /> {tr("Edit")}</button>}
          {mayEdit && <button className="btn btn-danger" aria-label={tr("Delete")} title={tr("Delete")} onClick={async () => (await confirm("Delete table \"{name}\"?", { name: t.name }, { danger: true })) && removeEntity("table", t.id)}><Trash2 size={14} /></button>}
          {mayEdit && <button className="btn btn-primary" onClick={() => setModal({ kind: "attribute", parentId: t.id })}><Plus size={15} /> {tr("New attribute")}</button>}
          {(hasRole(me, "pm") || isAdmin) && <button className="btn" onClick={() => askSteward(t)} title={tr(effStewardId(state, "table", t.id) ? "Asks the data steward" : effOwnerId(state, "table", t.id) ? "No steward — asks the data owner to assign one" : "No steward or owner — asks the admins to name an owner")}><Send size={14} /> {tr("Request business descriptions")}</button>}
        </div>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>
            {tr(TAB_LABEL[k])}
          </button>
        ))}
      </div>

      {tab === "technical" && (
        (lazy.on && !lazy.loaded.has(t.id)) ? <div className="modal-sub"><Loader2 size={14} className="spin" /> {tr("Loading attributes…")}</div> : attrs.length ? (<>
          <table className="attrs">
            <thead><tr>
              <th scope="col">{tr("Attribute")}</th><th scope="col">{tr("Data type")}</th><th scope="col">{tr("Constraints")}</th><th scope="col">{tr("Description")}</th><th scope="col">{tr("Sensitivity")}</th><th scope="col"></th>
            </tr></thead>
            <tbody>
              {paged.slice("attrs", attrs).map((a) => (
                <tr key={a.id}>
                  <td className="mono" style={{ fontWeight: 600 }}>
                    {a.isPK && <KeyRound size={12} style={{ marginRight: 5, color: "var(--amber)" }} />}{a.name}
                  </td>
                  <td className="mono" style={{ color: "var(--accent)" }}>{a.dataType}</td>
                  <td style={{ fontSize: 13, color: "var(--muted)" }}>
                    {a.isPK ? "PRIMARY KEY" : ""}{a.isPK && !a.nullable ? " · " : ""}{!a.nullable ? "NOT NULL" : a.isPK ? "" : "NULLABLE"}
                  </td>
                  <td style={{ fontSize: 13 }}>{a.description}<br />
                    {a.businessTerm && <span style={{ color: "var(--muted)", fontSize: 12 }}><BookOpen size={11} style={{ verticalAlign: "-1px" }} /> Glossary term: {a.businessTerm}</span>}
                  </td>
                  <td><SensChip v={a.sensitivity || "Internal"} />{/* i18n: data — the default sensitivity level */}{a.classification && <span className="chip chip-blue" style={{ marginLeft: 4 }}>{a.classification}</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {mayEdit && (<>
                      <button className="btn btn-ghost btn-sm" onClick={() => setModal({ kind: "attribute", edit: a, parentId: t.id })} aria-label={tr("Edit attribute")}><Pencil size={13} /></button>
                      <button className="btn btn-ghost btn-sm btn-danger" onClick={() => removeEntity("attribute", a.id)} aria-label={tr("Delete attribute")}><Trash2 size={13} /></button>
                    </>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {paged.more("attrs", attrs)}
        </>) : <div className="empty">{tr("No attributes documented yet. Add the first column of")} <span className="mono">{t.name}</span>.</div>
      )}

      {tab === "business" && (
        <div className="kv-grid">
          <div className="kv-k">{tr("Business definition")}</div><div className="kv-v">{t.businessDefinition || "—"}</div>
          <div className="kv-k">{tr("Tags")}</div>
          <div className="kv-v">{(t.tags || "").split(",").map((x) => x.trim()).filter(Boolean).map((x) => <span key={x} className="chip chip-grey" style={{ marginRight: 6 }}>{x}</span>) || "—"}</div>
          <div className="kv-k">{tr("Object type")}</div><div className="kv-v mono">{t.type}</div>
          <div className="kv-k">{tr("Glossary terms")}</div>
          <div className="kv-v">{attrs.filter((a) => a.businessTerm).map((a) => <span key={a.id} className="chip chip-blue" style={{ marginRight: 6, marginBottom: 4 }}>{a.businessTerm}</span>)}
            {!attrs.some((a) => a.businessTerm) && "—"}</div>
        </div>
      )}

      {tab === "lineage" && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
            <span className="chip" style={{ background: "#F1EDE8", color: LAYER_COLOR[layerOf(t)] }}>Layer · {layerOf(t).toUpperCase()}</span>
            {(t.kvTags || []).filter((k) => k.key !== "Project").map((k) => <span key={k.key + k.value} className="chip chip-amber"><Tag size={11} /> {k.key}: {k.value}</span>)}
            <button className="btn btn-sm" onClick={() => { const gold = schemas.find((x) => x.id === t.schemaId && isDataProduct(x)); setLinSc(gold ? gold.id : "all"); setView("lineage"); }}><GitBranch size={13} /> {tr("Open full lineage")}</button>
            {mayEdit && (
              <span title={ucLocked ? tr(UC_LINEAGE_NOTE) : undefined}>
                <button className="btn btn-sm" disabled={ucLocked} onClick={() => setModal({ kind: "edge", presetTo: t.id })}><Plus size={13} /> {tr("Add upstream source")}</button>
              </span>
            )}
            {mayEdit && (
              <span title={ucLocked ? tr(UC_LINEAGE_NOTE) : undefined}>
                <button className="btn btn-sm" disabled={ucLocked} onClick={() => setModal({ kind: "edge", presetFrom: t.id })}><Plus size={13} /> {tr("Add downstream consumer")}</button>
              </span>
            )}
          </div>
          <div className="gov-grid">
            <div className="panel">
              <h3><ArrowRight size={16} style={{ transform: "rotate(180deg)" }} /> {tr("Upstream — reads from")}</h3>
              {upstreamOf(t.id).map((e) => { const src = table(e.from); return src ? edgeRow(e, src) : null; })}
              {!upstreamOf(t.id).length && <div style={{ color: "var(--muted)" }}>{tr("No upstream sources linked yet.")}</div>}
            </div>
            <div className="panel">
              <h3><ArrowRight size={16} /> {tr("Downstream — feeds into")}</h3>
              {downstreamOf(t.id).map((e) => { const dst = table(e.to); return dst ? edgeRow(e, dst) : null; })}
              {!downstreamOf(t.id).length && <div style={{ color: "var(--muted)" }}>{tr("No downstream consumers linked yet.")}</div>}
            </div>
          </div>
        </>
      )}

      {tab === "governance" && (<>
        <StewardshipPanel t={t} />
        <div className="kv-grid">
          <div className="kv-k">{tr("Data hub type")}</div><div className="kv-v">{h ? <span className="chip chip-brand"><HubIcon hubId={h.id} size={12} /> {h.name}</span> : "—"}</div>
          <div className="kv-k">{tr("Data hub")}</div><div className="kv-v"><span className="mono">{d?.country || "GLOBAL"}</span></div>
          <div className="kv-k">BPO</div><div className="kv-v">{person(dataHub?.bpoId)?.name || "—"}</div>
          {dataHub?.leanixUrl && <><div className="kv-k">LeanIX</div><div className="kv-v"><a href={dataHub.leanixUrl} target="_blank" rel="noreferrer noopener">{dataHub.leanixUrl}</a></div></>}
          <div className="kv-k">{tr("Data domain")}</div><div className="kv-v">{dm ? <span className="chip chip-blue"><Landmark size={12} /> {dm.name}</span> : "Not assigned — set it on the database."}</div>
          <div className="kv-k">{tr("Domain owner")}</div><div className="kv-v">{person(dm?.ownerId)?.name || "—"}</div>
          <div className="kv-k">{tr("Table steward")}</div><div className="kv-v">{person(t.stewardId)?.name || (person(dm?.stewardId) ? `${person(dm.stewardId).name} (inherited from domain)` : "—")}</div>
          <div className="kv-k">{tr("PII attributes")}</div>
          <div className="kv-v">{attrs.filter((a) => a.sensitivity === "PII").map((a) => <span key={a.id} className="chip chip-red mono" style={{ marginRight: 6 }}>{a.name}</span>)}
            {!attrs.some((a) => a.sensitivity === "PII") && <span className="chip chip-green"><CheckCircle2 size={12} /> {tr("None flagged")}</span>}</div>
          <div className="kv-k">{tr("Source system")}</div><div className="kv-v">{d?.source === "unity" ? "Databricks Unity Catalog" : d?.source === "csv" ? "CSV import" : "Manually documented"}</div>
          <div className="kv-k">{tr("Usage")}</div><div className="kv-v">{collab.data ? <UsageLine usage={collab.data.usage} /> : <span className="modal-sub">…</span>}</div>
        </div>
      </>)}
      {tab === "discussion" && <CollabPanel type="table" id={t.id} collab={collab} me={me} isAdmin={isAdmin} isSteward={hasRole(me, "steward")} />}
    </>
  );
}
