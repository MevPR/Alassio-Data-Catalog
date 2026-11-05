/* Marketplace (v1.73 — finding F-F6): MarketplaceViewC is the composer — header, BPMN links, tabs and the request
   list loader. The tabs are AccessForm, DesignForm (state in useDesignForm) and RequestList, in ./marketplace/. */
import { useState, useEffect, useMemo } from "react";
import { Plus, History, Send, Store, GitBranch, FileText } from "lucide-react";
import { useT } from "../i18n.jsx";
import { useCatalogData, useNav, useActions } from "../catalog-context.jsx";
import { isSourceHub } from "../lib/model.js";
import { apiGetOr } from "../lib/api.js";
import { useDesignForm, defaultDesignHub } from "../hooks/use-design-form.js";
import { AccessForm } from "./marketplace/access-form.jsx";
import { DesignForm } from "./marketplace/design-form.jsx";
import { RequestList } from "./marketplace/request-list.jsx";

/* the BPO / data owner of a design is matched by name against the account and the people it stands for */
const ownerMatcher = (me, myPersonNames) => (r) => {
  const n = String(r.sourcing?.bpo || r.sourcing?.dataOwner || "").trim().toLowerCase();
  return !!n && (n === String(me?.name || "").trim().toLowerCase() || (myPersonNames || []).map((x) => x.toLowerCase()).includes(n));
};

/* v1.73 (F-F8): reads the catalog contexts itself — main.jsx used to pass 13 props */
export function MarketplaceViewC() {
  const { t } = useT();
  const { me, isPm: canDesign, isAdmin, mpProducts: products, hubs: allHubs, sourceTree, people, perm, projectValues, useCaseValues } = useCatalogData();
  const { mpPreset: preset } = useNav();
  const { reloadCatalog: onCatalogChanged } = useActions();
  const hubs = useMemo(() => allHubs.filter((h) => !isSourceHub(h)), [allHubs]);
  const myPersonNames = useMemo(() => people.filter((p) => perm.mine.has(p.id)).map((p) => p.name), [people, perm]);
  const [tab, setTab] = useState(preset?.tab || "access");
  const [productId, setProductId] = useState(preset?.productId || "");
  const [requests, setRequests] = useState([]);
  const [scope, setScope] = useState("own");
  const design = useDesignForm(defaultDesignHub(hubs));
  /* a new preset (a gold schema's "Request access", "open my requests") is applied in place — the form keeps what
     the user typed; it used to remount the whole view through key={productId} */
  useEffect(() => {
    if (!preset) return;
    if (preset.productId) { setProductId(preset.productId); setTab(preset.tab || "access"); } else if (preset.tab) setTab(preset.tab);
  }, [preset]);
  const load = async () => { const j = await apiGetOr("/api/marketplace/requests"); if (j) { setRequests(j.requests); setScope(j.scope); } };
  useEffect(() => { load(); }, []);   /* once on mount; every change reloads explicitly */
  const changed = ({ catalog = false } = {}) => { load(); if (catalog) onCatalogChanged(); };
  const startEdit = (r) => { design.startEdit(r); setTab("design"); };
  return (
    <>
      <div className="entity-head">
        <div className="entity-icon"><Store size={22} /></div>
        <div>
          <h1 className="entity-title">{t("Marketplace")}</h1>
          <div className="entity-sub">{t("Request access to existing data products, or design a new one from SOURCE tables.")}</div>
        </div>
      </div>
      <div className="panel" style={{ padding: "10px 16px", marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}><GitBranch size={15} style={{ color: "var(--accent)" }} /> {t("Process documentation (BPMN)")}</span>
        <a className="btn btn-sm" href="/docs/Alassio_Data_Product_Design_BPMN.pdf" target="_blank" rel="noreferrer noopener"><FileText size={13} /> {t("Data product design")}</a>
        <a className="btn btn-sm" href="/docs/Alassio_Other_Workflows_BPMN.pdf" target="_blank" rel="noreferrer noopener"><FileText size={13} /> {t("Access request & attribute documentation")}</a>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>BPMN 2.0: <a href="/docs/Alassio_Data_Product_Design.bpmn" download>{t("design")}</a> · <a href="/docs/Alassio_Access_Request.bpmn" download>{t("access")}</a> · <a href="/docs/Alassio_Steward_Description_Request.bpmn" download>{t("attribute documentation")}</a></span>
      </div>
      <div className="tabs" style={{ marginTop: 12 }}>
        <button className={`tab ${tab === "access" ? "on" : ""}`} onClick={() => setTab("access")}><Send size={14} /> {t("Request access")}</button>
        {canDesign && <button className={`tab ${tab === "design" ? "on" : ""}`} onClick={() => setTab("design")}><Plus size={14} /> {design.form.editingId ? t("Edit data product design") : t("Design a new data product")}</button>}
        <button className={`tab ${tab === "requests" ? "on" : ""}`} onClick={() => setTab("requests")}><History size={14} /> {scope === "all" ? t("All requests") : t("My requests")} ({requests.length})</button>
      </div>
      {tab === "access" && <AccessForm products={products} productId={productId} onProductChange={setProductId} onSubmitted={load} />}
      {tab === "design" && canDesign && <DesignForm design={design} hubs={hubs} projectValues={projectValues} useCaseValues={useCaseValues} sourceTree={sourceTree}
        onSubmitted={() => { setTab("requests"); changed({ catalog: true }); }} />}
      {tab === "requests" && <RequestList requests={requests} me={me} isAdmin={isAdmin} isOwnerOf={ownerMatcher(me, myPersonNames)} people={people} sourceTree={sourceTree}
        onEdit={startEdit} onChanged={changed} />}
    </>
  );
}
