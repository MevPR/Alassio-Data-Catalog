import { useState } from "react";
import { useT } from "../i18n.jsx";
import { Database, Layers, Table2, Download } from "lucide-react";
import { Modal, HubIcon } from "./ui.jsx";
import { sortByName } from "../lib/lookups.js";

/* presentational helper, module-level since v1.68 (no remount on each parent render) */
const Cb = ({ st, onChange, children, count, pad }) => (
  <label className="exp-row-label" style={{ paddingLeft: pad }}>
    <input type="checkbox" checked={st === "all"} ref={(el) => el && (el.indeterminate = st === "some")} onChange={onChange} />
    {children}
    {count !== undefined && <span className="tree-count">{count}</span>}
  </label>
);

export function ExportModalC({ title = "Export CSV", sub, hubs, databases, schemas, tables, attributes = null, attrCount = null, onExport, onClose }) {
  const { t } = useT();
  const scOf = (dbId) => sortByName(schemas.filter((s) => s.databaseId === dbId));
  const tbOf = (scId) => sortByName(tables.filter((t) => t.schemaId === scId));
  const allTb = () => new Set(tables.map((t) => t.id));
  const allXs = () => new Set(schemas.filter((s) => !tbOf(s.id).length).map((s) => s.id));
  const allXd = () => new Set(databases.filter((d) => !scOf(d.id).length).map((d) => d.id));
  const [tb, setTb] = useState(allTb);   // selected tables
  const [xs, setXs] = useState(allXs);   // selected empty schemas
  const [xd, setXd] = useState(allXd);   // selected empty databases

  const scState = (sc) => {
    const ts = tbOf(sc.id);
    if (!ts.length) return xs.has(sc.id) ? "all" : "none";
    const n = ts.filter((t) => tb.has(t.id)).length;
    return n === 0 ? "none" : n === ts.length ? "all" : "some";
  };
  const dbState = (d) => {
    const scs = scOf(d.id);
    if (!scs.length) return xd.has(d.id) ? "all" : "none";
    const st = scs.map(scState);
    return st.every((x) => x === "all") ? "all" : st.every((x) => x === "none") ? "none" : "some";
  };
  const hubState = (h) => {
    const ds = databases.filter((x) => x.hubId === h.id);
    if (!ds.length) return "none";
    const st = ds.map(dbState);
    return st.every((x) => x === "all") ? "all" : st.every((x) => x === "none") ? "none" : "some";
  };

  const applySchema = (sc, on, tbS, xsS) => {
    const ts = tbOf(sc.id);
    if (!ts.length) { on ? xsS.add(sc.id) : xsS.delete(sc.id); }
    else ts.forEach((t) => on ? tbS.add(t.id) : tbS.delete(t.id));
  };
  const applyDb = (d, on, tbS, xsS, xdS) => {
    const scs = scOf(d.id);
    if (!scs.length) { on ? xdS.add(d.id) : xdS.delete(d.id); }
    else scs.forEach((sc) => applySchema(sc, on, tbS, xsS));
  };
  const commit = (tbS, xsS, xdS) => { setTb(tbS); setXs(xsS); setXd(xdS); };
  const toggleTable = (t) => { const s = new Set(tb); s.has(t.id) ? s.delete(t.id) : s.add(t.id); setTb(s); };
  const toggleSchema = (sc) => { const on = scState(sc) !== "all"; const a = new Set(tb), b = new Set(xs); applySchema(sc, on, a, b); commit(a, b, new Set(xd)); };
  const toggleDb = (d) => { const on = dbState(d) !== "all"; const a = new Set(tb), b = new Set(xs), c = new Set(xd); applyDb(d, on, a, b, c); commit(a, b, c); };
  const toggleHub = (h) => {
    const on = hubState(h) !== "all";
    const a = new Set(tb), b = new Set(xs), c = new Set(xd);
    databases.filter((x) => x.hubId === h.id).forEach((d) => applyDb(d, on, a, b, c));
    commit(a, b, c);
  };

  /* attrCount(tableId) comes from the catalog (lazy-aware); the attributes array is the legacy fallback */
  const nAttr = attrCount ? [...tb].reduce((n, id) => n + (attrCount(id) || 0), 0) : (attributes || []).filter((a) => tb.has(a.tableId)).length;
  const nothing = tb.size === 0 && xs.size === 0 && xd.size === 0;


  return (
    <Modal wide title={title} sub={sub || t("Choose which data hubs, databases, schemas or tables to include. The export contains one row per attribute with all technical, business and governance columns.")} onClose={onClose}>
      <div className="exp-tree">
        {hubs.map((h) => (
          <div key={h.id}>
            <Cb st={hubState(h)} onChange={() => toggleHub(h)} count={databases.filter((x) => x.hubId === h.id).length}>
              <span style={{ color: "var(--brand)" }}><HubIcon hubId={h.id} size={15} /></span>
              <span style={{ fontWeight: 600 }}>{h.name}</span>
            </Cb>
            {sortByName(databases.filter((x) => x.hubId === h.id)).map((d) => (
              <div key={d.id}>
                <Cb st={dbState(d)} onChange={() => toggleDb(d)} pad={26} count={scOf(d.id).length}>
                  <Database size={14} /><span className="mono" style={{ fontSize: 13 }}>{d.name}</span>
                </Cb>
                {scOf(d.id).map((sc) => (
                  <div key={sc.id}>
                    <Cb st={scState(sc)} onChange={() => toggleSchema(sc)} pad={52} count={tbOf(sc.id).length}>
                      <Layers size={14} /><span className="mono" style={{ fontSize: 13 }}>{sc.name}</span>
                    </Cb>
                    {tbOf(sc.id).map((t) => (
                      <Cb key={t.id} st={tb.has(t.id) ? "all" : "none"} onChange={() => toggleTable(t)} pad={78}>
                        <Table2 size={14} /><span className="mono" style={{ fontSize: 13 }}>{t.name}</span>
                      </Cb>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
        {!databases.length && <div style={{ color: "var(--muted)", padding: 8 }}>{t("The catalog is empty — nothing to export yet.")}</div>}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
        <button className="btn btn-sm" onClick={() => commit(allTb(), allXs(), allXd())}>Select all</button>
        <button className="btn btn-sm" onClick={() => commit(new Set(), new Set(), new Set())}>Select none</button>
        <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 13 }}>{tb.size} tables · {nAttr} attributes selected</span>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>{t("Cancel")}</button>
        <button className="btn btn-primary" onClick={() => onExport([...tb], [...xs], [...xd])} disabled={nothing}>
          <Download size={15} /> {t("Export selection")}
        </button>
      </div>
    </Modal>
  );
}
