import { clickable } from "./ui.jsx";
import { useState, useEffect } from "react";
import { useT } from "../i18n.jsx";
import { Layers, Landmark, Boxes, CheckCircle2, Loader2, Circle, Send, Store } from "lucide-react";
import { effDomainId } from "../../permissions.js";
import { PHASE_OF, PHASE_LABEL, STATUS_LABEL, waitingText } from "../lib/design-workflow.js";
import { apiGetOr } from "../lib/api.js";

/* domain › hub heading of one group — module-level since v1.72 (F-F11) */
const GroupHead = ({ g, t }) => (
  <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "12px 0 4px", fontWeight: 600 }}>
    <Landmark size={14} style={{ color: "var(--accent)" }} /> {g.domain || t("No data domain")}
    <span style={{ color: "var(--muted)" }}>·</span><Boxes size={14} style={{ color: "var(--brand)" }} /> {g.hub || t("No data hub")}
    <span className="chip chip-grey">{g.items.length}</span>
  </div>
);

export function DataProductStatusC({ state, isDataProduct, onOpenSchema, onOpenRequests }) {
  const { t } = useT();
  const [requests, setRequests] = useState(null);
  const [fDomain, setFDomain] = useState(""); const [fProject, setFProject] = useState(""); const [fUseCase, setFUseCase] = useState("");
  useEffect(() => { apiGetOr("/api/marketplace/requests").then((j) => setRequests(j?.requests || [])); }, []);

  const hub = (id) => (state.hubs || []).find((h) => h.id === id);
  const domain = (id) => (state.domains || []).find((d) => d.id === id);
  const db = (id) => (state.databases || []).find((d) => d.id === id);
  const key = (dm, h) => `${dm || "~"}‖${h || "~"}`;

  /* finished: data products in the catalog (schemas within gold-layer databases) + designs marked done */
  const finished = [];
  for (const sc of state.schemas || []) if (isDataProduct(sc)) {
    const d = db(sc.databaseId); const dm = domain(effDomainId(state, "schema", sc.id))?.name || ""; const h = hub(d?.hubId)?.name || "";
    finished.push({ kind: "catalog", id: sc.id, name: `${d?.name}.${sc.name}`, domain: dm, hub: h, tables: (state.tables || []).filter((t) => t.schemaId === sc.id).length, projects: (sc.kvTags || []).filter((k) => k.key === "Project").map((k) => k.value), useCases: (sc.kvTags || []).filter((k) => k.key === "Use Case").map((k) => k.value) });
  }
  const designs = (requests || []).filter((r) => r.kind === "design");
  for (const r of designs.filter((r) => r.status === "done")) finished.push({ kind: "design", id: r.id, name: r.name, domain: "", hub: r.hub || "", requester: r.requesterName, ts: r.decidedTs || r.ts, projects: r.project ? [r.project] : [], useCases: r.useCase ? [r.useCase] : [] });
  const planned = designs.filter((r) => !["done", "withdrawn"].includes(r.status)).map((r) => ({ id: r.id, name: r.name, project: r.project, useCase: r.useCase, domain: "", hub: r.hub || "", phase: PHASE_OF(r.status) || 1, status: r.status, waiting: waitingText(r, t), requester: r.requesterName, ts: r.updatedTs || r.ts }));

  const domainOpts = [...new Set([...finished.map((x) => x.domain)].filter(Boolean))].sort();
  const projectOpts = [...new Set([...finished.flatMap((x) => x.projects || []), ...planned.map((x) => x.project)].filter(Boolean))].sort();
  const useCaseOpts = [...new Set([...finished.flatMap((x) => x.useCases || []), ...planned.map((x) => x.useCase)].filter(Boolean))].sort();
  const keep = (it) => (!fDomain || it.domain === fDomain) && (!fProject || (it.projects || [it.project]).includes(fProject)) && (!fUseCase || (it.useCases || [it.useCase]).includes(fUseCase));
  const finishedF = finished.filter(keep), plannedF = planned.filter(keep);
  const group = (items) => {
    const m = new Map();
    for (const it of items) { const k = key(it.domain, it.hub); if (!m.has(k)) m.set(k, { domain: it.domain, hub: it.hub, items: [] }); m.get(k).items.push(it); }
    return [...m.values()].sort((a, b) => (a.domain || "\uffff").localeCompare(b.domain || "\uffff") || (a.hub || "").localeCompare(b.hub || ""))
      .map((g) => ({ ...g, items: g.items.sort((a, b) => a.name.localeCompare(b.name)) }));
  };

  return (
    <>
      <div className="entity-head">
        <div className="entity-icon"><Layers size={22} /></div>
        <div>
          <h1 className="entity-title">{t("Discover Data Products")}</h1>
          <div className="entity-sub">{t("Finished data products and the ones being designed — sorted by data domain and data hub type, with the current phase and whose feedback is awaited. Filter by data domain, project or use case.")}</div>
        </div>
      </div>

      <div className="panel" style={{ padding: "10px 16px", marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontWeight: 600 }}>{t("Filter")}</span>
        <select value={fDomain} onChange={(e) => setFDomain(e.target.value)} aria-label={t("Filter by data domain")}><option value="">{t("All data domains")}</option>{domainOpts.map((x) => <option key={x} value={x}>{x}</option>)}</select>
        <select value={fProject} onChange={(e) => setFProject(e.target.value)} aria-label={t("Filter by project")}><option value="">{t("All projects")}</option>{projectOpts.map((x) => <option key={x} value={x}>{x}</option>)}</select>
        <select value={fUseCase} onChange={(e) => setFUseCase(e.target.value)} aria-label={t("Filter by use case")}><option value="">{t("All use cases")}</option>{useCaseOpts.map((x) => <option key={x} value={x}>{x}</option>)}</select>
        {(fDomain || fProject || fUseCase) && <button className="btn btn-ghost btn-sm" onClick={() => { setFDomain(""); setFProject(""); setFUseCase(""); }}>Clear</button>}
      </div>

      <div className="panel" style={{ padding: 16, marginTop: 14 }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}><CheckCircle2 size={16} style={{ color: "var(--green)" }} /> {t("Finished data products")} <span className="chip chip-grey">{finishedF.length}{finishedF.length !== finished.length ? ` / ${finished.length}` : ""}</span></h3>
        {!finished.length && <div className="modal-sub">{t("No finished data products yet — schemas inside gold-layer databases and completed designs appear here.")}</div>}
        {group(finishedF).map((g) => (
          <div key={key(g.domain, g.hub)}>
            <GroupHead g={g} t={t} />
            {g.items.map((it) => (
              <div key={it.kind + it.id} className={`role-row ${it.kind === "catalog" ? "edge-row" : ""}`} {...(it.kind === "catalog" ? clickable(() => onOpenSchema(it.id)) : {})}>
                <Layers size={13} /><span className="mono" style={{ fontWeight: 600 }}>{it.name}</span>
                {it.kind === "catalog" ? <span className="chip chip-blue">in catalog · {it.tables} tables</span> : <span className="chip chip-grey">design done · {it.requester}</span>}
                {(it.projects || []).map((p) => <span key={p} className="chip chip-blue">Project: {p}</span>)}
                {(it.useCases || []).map((p) => <span key={"uc" + p} className="chip chip-blue">Use Case: {p}</span>)}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="panel" style={{ padding: 16, marginTop: 14 }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}><Store size={16} style={{ color: "var(--accent)" }} /> {t("Planned / requested data products")} <span className="chip chip-grey">{plannedF.length}{plannedF.length !== planned.length ? ` / ${planned.length}` : ""}</span></h3>
        {requests === null && <div className="modal-sub">{t("Loading…")}</div>}
        {requests !== null && !planned.length && <div className="modal-sub">{t("No data product designs in progress.")}</div>}
        {group(plannedF).map((g) => (
          <div key={key(g.domain, g.hub)}>
            <GroupHead g={g} t={t} />
            {g.items.map((it) => (
              <div key={it.id} className="role-row edge-row" style={{ flexWrap: "wrap" }} {...clickable(() => onOpenRequests())}>
                <span className="mono" style={{ fontWeight: 600, minWidth: 160 }}>{it.name}</span>
                {it.project && <span className="chip chip-blue">Project: {it.project}</span>}
                {it.useCase && <span className="chip chip-blue">Use Case: {it.useCase}</span>}
                <span style={{ display: "flex", gap: 4 }}>
                  {[1, 2, 3].map((p) => <span key={p} title={PHASE_LABEL[p]} className={`chip ${p < it.phase ? "chip-blue" : p === it.phase ? "chip-amber" : "chip-grey"}`} style={{ padding: "1px 7px" }}>
                    {p < it.phase ? <CheckCircle2 size={11} /> : p === it.phase ? <Loader2 size={11} className="spin" /> : <Circle size={11} />} {p}</span>)}
                </span>
                <span className="chip chip-amber">{t(PHASE_LABEL[it.phase])}</span>
                <span style={{ fontSize: 12.5 }}>{t(STATUS_LABEL[it.status] || it.status)}</span>
                <span className="chip chip-grey" style={{ marginLeft: "auto" }}><Send size={11} /> {t("waiting for:")} {it.waiting}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
