import React, { useState } from "react";
import { Globe, Landmark, ShieldCheck, Users, Tag, X, Plus } from "lucide-react";
import { effOwnerId, effStewardId, effDomainId, chainOf } from "../../permissions.js";
import { HubIcon } from "../components/ui.jsx";
import { useT } from "../i18n.jsx";
import { fill } from "../lib/i18n-format.js";
import { useActions, useCatalogData, useNav } from "../catalog-context.jsx";
import { PROJECT_KEY } from "../lib/catalog-ops.js";

/* breadcrumb of the current selection */
export function Crumb() {
  const { t: tr } = useT();
  const { pathOf } = useCatalogData();
  const { sel, setSel } = useNav();
  const p = pathOf(sel);
  if (!p.length || p.some(([, x]) => !x)) return null;
  return (
    <div className="crumb">
      <span>{tr("catalog")}</span>
      {p.map(([type, x], i) => (
        <React.Fragment key={x.id}>
          <span className="dot">›</span>
          {i === p.length - 1 ? <b>{x.name}</b> :
            type === "country" ? <button className="btn btn-ghost btn-sm mono" style={{ padding: "0 2px" }} onClick={() => setSel({ type: "datahub", hubId: x.hubId || p[0][1]?.id, name: x.name })}>{x.name}</button> :
            <button className="btn btn-ghost btn-sm mono" style={{ padding: "0 2px" }} onClick={() => setSel({ type, id: x.id })}>{x.name}</button>}
        </React.Fragment>
      ))}
    </div>
  );
}

/* governance chips: hub, data hub, (inherited) domain, owner/BPO, steward */
export function GovLine({ hubId, country, dmId, assetType, assetId }) {
  const { state, hub, domain, person } = useCatalogData();
  const h = hub(hubId);
  const effDm = assetType ? effDomainId(state, assetType, assetId) : (dmId || h?.domainId);
  const dm = domain(effDm); const inheritedDm = dm && effDm !== dmId;
  const oid = assetType ? effOwnerId(state, assetType, assetId) : (dm?.ownerId || h?.ownerId);
  const sid = assetType ? effStewardId(state, assetType, assetId) : dm?.stewardId;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
      {h && <span className="chip chip-brand"><HubIcon hubId={h.id} size={12} /> {h.name}</span>}
      {country && <span className="chip chip-grey"><Globe size={12} /> {country}</span>}
      {dm && <span className="chip chip-blue" title={inheritedDm ? "inherited data domain" : "data domain"}><Landmark size={12} /> {dm.name}{inheritedDm ? " (inherited)" : ""}</span>}
      {oid && <span className="chip chip-amber"><ShieldCheck size={12} /> {assetType && !chainOf(state, assetType, assetId).some((r) => !r.__datahub && r.ownerId === oid) ? "BPO" : "Owner"} · {person(oid)?.name}</span>}
      {sid && <span className="chip chip-grey"><Users size={12} /> Steward · {person(sid)?.name}</span>}
    </div>
  );
}

/* "Project" tags on a table or data product schema */
export function ProjectTags({ kind, id, tags, canEdit: allowed }) {
  const { t: tr } = useT();
  const { projectValues } = useCatalogData();
  const { addProjectTag, removeProjectTag } = useActions();
  const [val, setVal] = useState("");
  const mine = (tags || []).filter((k) => k.key === PROJECT_KEY);
  const add = () => { addProjectTag(kind, id, val); setVal(""); };
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
      <span className="chip chip-grey"><Tag size={12} /> {tr("Project")}</span>
      {mine.map((k) => <span key={k.value} className="chip chip-blue">{k.value}{allowed && <button className="btn btn-ghost btn-sm" style={{ padding: 0, marginLeft: 3 }} onClick={() => removeProjectTag(kind, id, k.value)} aria-label={fill(tr("Remove project {name}"), { name: k.value })}><X size={11} /></button>}</span>)}
      {!mine.length && !allowed && <span className="modal-sub" style={{ margin: 0 }}>—</span>}
      {allowed && (
        <>
          <input list="project-values" value={val} onChange={(e) => setVal(e.target.value)} placeholder={tr("e.g. GenAI, Customer360")} style={{ maxWidth: 200, padding: "3px 8px" }}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
          <datalist id="project-values">{projectValues.map((v) => <option key={v} value={v} />)}</datalist>
          <button className="btn btn-sm" disabled={!val.trim()} onClick={add}><Plus size={12} /> {tr("Add")}</button>
        </>
      )}
    </div>
  );
}

/* person picker used by the governance overview */
export function PersonPick({ value, onChange, disabled, label }) {
  const { t: tr } = useT();
  const { people } = useCatalogData();
  return (
    <select className="btn btn-sm" value={value || ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={label} title={disabled ? "Admins only" : label}>
      <option value="">{tr("— unassigned —")}</option>
      {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}
