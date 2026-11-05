import { ShieldCheck, Boxes, Globe, Landmark, Users, ChevronRight, Plus, Pencil, Trash2, ExternalLink } from "lucide-react";
import { initials } from "../lib/model.js";
import { HubIcon } from "../components/ui.jsx";
import { RoleBoxesC } from "../components/role-boxes.jsx";
import { useT } from "../i18n.jsx";
import { fill } from "../lib/i18n-format.js";
import { useToast } from "../toast-context.jsx";
import { useActions, useCatalogData, useNav } from "../catalog-context.jsx";
import { PersonPick } from "./shared.jsx";
import { StewardshipPolicyCard, AttestationLine } from "../components/stewardship.jsx";

/* Governance Overview: assignment of people only — names, descriptions and structure are edited on the objects themselves (Admins) */
export function GovernanceView() {
  const { t: tr, tn } = useT();
  const { hubs, domains, databases, tables, people, dbsOf, dataHubsOf, perm, canStructure } = useCatalogData();
  const { setSel, setView, setModal } = useNav();
  const { removeEntity, setDataHubBpo, assignPerson } = useActions();
  const { confirm } = useToast();
  return (
    <>
      <div className="entity-head">
        <div className="entity-icon" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}><ShieldCheck size={22} /></div>
        <div>
          <h1 className="entity-title">{tr("Governance Overview")}</h1>
          <div className="entity-sub">{tr("Who is responsible for what. Only the assignment of people can be changed here — names, descriptions and structure are edited on the objects themselves by Admins.")}</div>
        </div>
      </div>
      <StewardshipPolicyCard />
      <div className="gov-grid" style={{ marginTop: 20 }}>
        <div>
          <div className="panel" style={{ marginBottom: 18 }}>
            <h3><Boxes size={17} style={{ color: "var(--brand)" }} /> {tr("Data hubs & BPOs")} <span className="modal-sub" style={{ margin: "0 0 0 auto", fontWeight: 400 }}>{tr("types have no owner — the BPO sits on the data hub")}</span></h3>
            {hubs.map((h) => (
              <div key={h.id} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, margin: "6px 0 2px" }}><span style={{ color: "var(--brand)" }}><HubIcon hubId={h.id} size={15} /></span> {h.name} <span className="chip chip-grey">{tr("type")}</span>
                  <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={() => { setSel({ type: "hub", id: h.id }); setView("catalog"); }} aria-label={fill(tr("Open {name}"), { name: h.name })}><ChevronRight size={14} /></button></div>
                {!dataHubsOf(h).length && <div className="modal-sub" style={{ marginLeft: 22 }}>{tr("No data hubs yet.")}</div>}
                {dataHubsOf(h).map((dh) => (
                  <div key={dh.name} className="role-row" style={{ marginLeft: 22 }}>
                    <Globe size={14} style={{ color: "var(--accent)" }} />
                    <span className="mono" style={{ fontWeight: 600 }}>{dh.name}</span>
                    <span className="chip chip-amber"><ShieldCheck size={12} /> BPO</span>
                    <PersonPick label={`BPO of ${dh.name}`} value={dh.bpoId} disabled={!perm.canSetOwner} onChange={(v) => setDataHubBpo(h.id, dh.name, v)} />
                    <span className="chip chip-grey">{tn(["{n} database", "{n} databases"], dbsOf(h.id).filter((x) => (x.country || "GLOBAL") === dh.name).length)}</span>
                    {dh.leanixUrl && <a className="chip chip-grey" href={dh.leanixUrl} target="_blank" rel="noreferrer noopener"><ExternalLink size={11} /> LeanIX</a>}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="panel">
            <h3><Landmark size={17} /> Data domains
              {canStructure && <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => setModal({ kind: "domain" })}><Plus size={13} /> {tr("New domain")}</button>}
            </h3>
            {domains.length === 0 && <div style={{ color: "var(--muted)" }}>{tr("No domains yet. A domain groups databases under one owner and steward.")}</div>}
            {domains.map((dm) => (
              <div key={dm.id} className="role-row">
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{dm.name}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{dm.description}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <span className="chip chip-amber"><ShieldCheck size={12} /> {tr("Owner")}</span>
                    <PersonPick label={`Owner of ${dm.name}`} value={dm.ownerId} disabled={!perm.canSetOwner} onChange={(v) => assignPerson("domain", dm.id, "ownerId", v)} />
                    <span className="chip chip-grey"><Users size={12} /> {tr("Steward")}</span>
                    <PersonPick label={`Steward of ${dm.name}`} value={dm.stewardId} disabled={!perm.canSetSteward("domain", dm.id)} onChange={(v) => assignPerson("domain", dm.id, "stewardId", v)} />
                    <span className="chip chip-grey">{tn(["{n} database", "{n} databases"], databases.filter((d) => d.domainId === dm.id).length)}</span>
                  </div>
                  <AttestationLine kind="domain" obj={dm} />
                </div>
                {canStructure && <button className="btn btn-ghost btn-sm" onClick={() => setModal({ kind: "domain", edit: dm })} aria-label={tr("Edit domain")}><Pencil size={14} /></button>}
                {canStructure && <button className="btn btn-ghost btn-sm btn-danger" onClick={async () => (await confirm("Delete domain \"{name}\"?", { name: dm.name }, { danger: true })) && removeEntity("domain", dm.id)} aria-label={tr("Delete domain")}><Trash2 size={14} /></button>}
              </div>
            ))}
          </div>
        </div>
        <RoleBoxesC onOpenUsers={() => setView("users")} />
        <div className="panel">
          <h3><Users size={17} /> People
            {canStructure && <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => setModal({ kind: "person" })}><Plus size={13} /> {tr("Add person")}</button>}
          </h3>
          {people.map((p) => {
            const owns = [...hubs.flatMap((h) => (h.dataHubs || []).filter((x) => x.bpoId === p.id).map((x) => `${x.name} (BPO)`)),
            ...domains.filter((d) => d.ownerId === p.id).map((d) => d.name)];
            const stewards = [...hubs.filter((h) => h.stewardId === p.id).map((h) => h.name + " hub"),
            ...domains.filter((d) => d.stewardId === p.id).map((d) => d.name),
            ...tables.filter((t) => t.stewardId === p.id).map((t) => t.name)];
            return (
              <div key={p.id} className="role-row">
                <div className="avatar">{initials(p.name)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{p.email || "no e-mail"}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                    {owns.map((n) => <span key={n} className="chip chip-amber">Owner · {n}</span>)}
                    {stewards.map((n, i) => <span key={n + i} className="chip chip-grey">Steward · {n}</span>)}
                    {!owns.length && !stewards.length && <span className="chip chip-grey">{tr("No roles yet")}</span>}
                  </div>
                </div>
                {canStructure && <button className="btn btn-ghost btn-sm" onClick={() => setModal({ kind: "person", edit: p })} aria-label={tr("Edit person")}><Pencil size={14} /></button>}
                {canStructure && <button className="btn btn-ghost btn-sm btn-danger" onClick={() => removeEntity("person", p.id)} aria-label={tr("Delete person")}><Trash2 size={14} /></button>}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
