import { Database, Layers, Table2, ChevronRight, ChevronDown, Globe } from "lucide-react";
import { usePaged, HubIcon, clickable } from "../components/ui.jsx";
import { treeKey } from "../lib/navigation.js";
import { useT } from "../i18n.jsx";
import { useCatalogData, useNav } from "../catalog-context.jsx";
import { isSourceHub } from "../lib/model.js";

/* navigation tree: Data Hub Type › Data Hub › Database › Schema › Table (filtered by the search box) */
export function TreeView() {
  const { t: tr } = useT();
  const { hubs, dbsOf, schemasOf, tablesOf } = useCatalogData();
  const { sel, setSel, setView, open, setOpen, query } = useNav();
  const paged = usePaged();
  const q = query.trim().toLowerCase();
  const matches = (name) => !q || (name || "").toLowerCase().includes(q);
  const hubVisible = (h) => matches(h.name) || dbsOf(h.id).some((d) =>
    matches(d.name) || schemasOf(d.id).some((sc) => matches(sc.name) || tablesOf(sc.id).some((t) => matches(t.name))));
  const toggle = (key, cur) => (e) => { e.stopPropagation(); setOpen((o) => ({ ...o, [key]: !cur })); };
  const go = (s) => () => { setSel(s); setView("catalog"); };
  /* v1.64.1: the SOURCE hub (generic source systems) is always listed last, below a separator line */
  const visible = [...hubs.filter((h) => !isSourceHub(h)), ...hubs.filter(isSourceHub)].filter(hubVisible);
  const firstSourceId = visible.find(isSourceHub)?.id;
  return (
    <div className="tree">
      {visible.length === 0 && <div style={{ padding: "14px 10px", color: "var(--muted)", fontSize: 13 }}>{tr("No objects match “{q}”.").replace("{q}", query)}</div>}
      {visible.map((h) => {
        const hk = treeKey.hub(h.id), hOpen = open[hk] ?? false;
        const dataHubNames = [...new Set([...(h.dataHubs || []).map((x) => x.name), ...dbsOf(h.id).map((x) => x.country || "GLOBAL")])].sort((a, b) => a.localeCompare(b));
        return (
          <div key={h.id}>
            {h.id === firstSourceId && visible[0].id !== h.id && <div className="tree-sep" data-testid="tree-sep" />}
            <div className={`tree-row hub-row ${sel.type === "hub" && sel.id === h.id ? "sel" : ""}`} {...clickable(go({ type: "hub", id: h.id }))}>
              <button className="btn btn-ghost btn-sm" style={{ padding: 1 }} onClick={toggle(hk, hOpen)} aria-label={tr("Toggle hub")}>
                {hOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <span className="hub-ic"><HubIcon hubId={h.id} size={15} /></span>
              <span>{h.name}</span>
              <span className="tree-count">{dbsOf(h.id).length}</span>
            </div>
            {hOpen && (
              <div className="tree-kids">
                {dataHubNames.map((cc) => {
                  const ck = treeKey.country(h.id, cc), cOpen = open[ck] ?? false;
                  const dbs = dbsOf(h.id).filter((x) => (x.country || "GLOBAL") === cc);
                  return (
                    <div key={cc}>
                      <div className={`tree-row ${sel.type === "datahub" && sel.hubId === h.id && sel.name === cc ? "sel" : ""}`}
                        {...clickable(() => { setSel({ type: "datahub", hubId: h.id, name: cc }); setView("catalog"); setOpen((o) => ({ ...o, [ck]: true })); })}>
                        <button className="btn btn-ghost btn-sm" style={{ padding: 1 }} aria-label={tr("Toggle data hub")} onClick={toggle(ck, cOpen)}>
                          {cOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                        <Globe size={13} style={{ color: "var(--accent)" }} />
                        <span className="mono" style={{ fontWeight: 600 }}>{cc}</span>
                        <span className="tree-count">{dbs.length}</span>
                      </div>
                      {cOpen && (
                        <div className="tree-kids">
                          {paged.slice(ck, dbs).map((d) => {
                            const key = treeKey.db(d.id), isOpen = open[key] ?? false;
                            return (
                              <div key={d.id}>
                                <div className={`tree-row ${sel.type === "database" && sel.id === d.id ? "sel" : ""}`} {...clickable(go({ type: "database", id: d.id }))}>
                                  <button className="btn btn-ghost btn-sm" style={{ padding: 1 }} onClick={toggle(key, isOpen)} aria-label={tr("Toggle database")}>
                                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                  </button>
                                  <Database size={14} />
                                  <span className="mono">{d.name}</span>
                                  {d.source === "unity" && <span className="chip chip-blue" style={{ fontSize: 10, padding: "0 6px" }}>UC</span>}
                                  <span className="tree-count">{schemasOf(d.id).length}</span>
                                </div>
                                {isOpen && (
                                  <div className="tree-kids">
                                    {paged.slice(key, schemasOf(d.id)).map((sc) => {
                                      const sk = treeKey.schema(sc.id), scOpen = open[sk] ?? false;
                                      return (
                                        <div key={sc.id}>
                                          <div className={`tree-row ${sel.type === "schema" && sel.id === sc.id ? "sel" : ""}`} {...clickable(go({ type: "schema", id: sc.id }))}>
                                            <button className="btn btn-ghost btn-sm" style={{ padding: 1 }} onClick={toggle(sk, scOpen)} aria-label={tr("Toggle schema")}>
                                              {scOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                            </button>
                                            <Layers size={14} />
                                            <span className="mono">{sc.name}</span>
                                            <span className="tree-count">{tablesOf(sc.id).length}</span>
                                          </div>
                                          {scOpen && (
                                            <div className="tree-kids">
                                              {paged.slice(sk, tablesOf(sc.id).filter((t) => matches(t.name) || matches(sc.name) || matches(d.name) || matches(h.name))).map((t) => (
                                                <div key={t.id} className={`tree-row ${sel.type === "table" && sel.id === t.id ? "sel" : ""}`} {...clickable(go({ type: "table", id: t.id }))}>
                                                  <Table2 size={14} style={{ marginLeft: 18 }} />
                                                  <span className="mono">{t.name}</span>
                                                </div>
                                              ))}
                                              {paged.more(sk, tablesOf(sc.id))}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                    {paged.more(key, schemasOf(d.id))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {paged.more(ck, dbs)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
