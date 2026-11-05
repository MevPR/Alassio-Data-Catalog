/* Navigation state of the UI (v1.69 — extracted from App.jsx): the active view, the selected object, the expanded
   tree nodes, the search box and its facets, the open dialog, the active table tab, the mobile rail — plus the two
   effects that follow a selection (tree auto-expand, usage statistics) and openRef(), the one way to jump to an
   object from anywhere (search, glossary references, dashboards). */
import { useState, useEffect } from "react";
import { EMPTY_FACETS } from "../lib/search.js";
import { recordView, recordSearch } from "../lib/usage.js";
import { DEFAULT_TABLE_TAB, tableTabOr, treeKey } from "../lib/navigation.js";

export function useNavigation({ L, me }) {
  const { table, schema, db } = L;
  const [railOpen, setRailOpen] = useState(false);   /* mobile: the catalog tree is an off-canvas drawer */
  const [view, setView] = useState("catalog");   /* one of VIEWS in src/lib/navigation.js */
  const [sel, setSel] = useState({ type: "home" });
  const [open, setOpen] = useState({});
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState(null);
  const [tableTab, setTableTab] = useState(DEFAULT_TABLE_TAB);
  const [linSc, setLinSc] = useState("all");
  const [sFacet, setSFacet] = useState(EMPTY_FACETS);
  const [mpPreset, setMpPreset] = useState(null);
  const [glossaryFocus, setGlossaryFocus] = useState(null);
  /* the tree auto-expands to the selected object */
  useEffect(() => {
    if (!sel) return;
    const keys = [];
    const t = sel.type === "table" ? table(sel.id) : null;
    const sc = sel.type === "schema" ? schema(sel.id) : t ? schema(t.schemaId) : null;
    const d = sel.type === "database" ? db(sel.id) : sc ? db(sc.databaseId) : null;
    if (d) keys.push(treeKey.hub(d.hubId), treeKey.country(d.hubId, d.country));
    if (sel.type === "hub") keys.push(treeKey.hub(sel.id));
    if (d && (sc || t)) keys.push(treeKey.db(d.id));
    if (sc && t) keys.push(treeKey.schema(sc.id));
    if (keys.length) setOpen((o) => { const n = { ...o }; for (const k of keys) n[k] = true; return n; });
  }, [sel?.type, sel?.id]);   // eslint-disable-line react-hooks/exhaustive-deps -- expand on a new selection only; re-running on every catalog edit would reopen nodes the user closed
  /* usage statistics (v1.58): views of tables/schemas/databases/domains and search terms */
  useEffect(() => { if (me && sel?.id && ["table", "schema", "database", "domain", "hub"].includes(sel.type)) recordView(sel.type, sel.id); }, [me?.id, sel?.type, sel?.id]);   // eslint-disable-line react-hooks/exhaustive-deps -- one view per selection and account, not per profile update
  useEffect(() => { if (me) recordSearch(query); }, [me?.id, query]);   // eslint-disable-line react-hooks/exhaustive-deps -- per account, not per profile update
  /* the one way to jump to an object: { type, id } (+ hubId/name for a data hub, + tab for a table). An attribute
     reference opens its table; the tab is validated against TABLE_TABS (v1.71 — a jump to "attributes" used to leave
     the table page blank). */
  const openRef = (r) => {
    if (!r) return;
    setView("catalog");
    if (r.type === "datahub") { setSel({ type: "datahub", hubId: r.hubId, name: r.name }); return; }
    if (r.type === "attribute") { const a = L.attribute(r.id); if (a) { setSel({ type: "table", id: a.tableId }); setTableTab(tableTabOr(r.tab)); } return; }
    setSel({ type: r.type, id: r.id });
    if (r.type === "table") setTableTab(tableTabOr(r.tab, r.tab === undefined ? tableTab : DEFAULT_TABLE_TAB));
  };
  /* v1.73: the two jumps the dashboards and the inbox share (they were lambdas repeated in main.jsx) */
  const openRequests = () => { setMpPreset({ tab: "requests" }); setView("marketplace"); };
  const openGlossaryTerm = (id) => { setView("glossary"); setGlossaryFocus(id); };
  return { openRequests, openGlossaryTerm, view, setView, sel, setSel, open, setOpen, query, setQuery, modal, setModal, tableTab, setTableTab, linSc, setLinSc, sFacet, setSFacet, mpPreset, setMpPreset, glossaryFocus, setGlossaryFocus, railOpen, setRailOpen, openRef };
}
