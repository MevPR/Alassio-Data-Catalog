/* Composition root of the Alassio Data Catalog UI.
   Owns the application state (session, catalog document, navigation, modal), wires the pure catalog
   operations (src/lib) into React actions and provides everything to the views through three contexts
   (src/catalog-context.jsx: data, navigation, actions).
   The views themselves live in src/views/, dialogs and secondary screens in src/components/. */
import React, { useState, useEffect, useMemo } from "react";
import { Plus, X } from "lucide-react";
import { buildPerms } from "../permissions.js";
import { sourceKey } from "./lib/model.js";
import { makeLookups } from "./lib/lookups.js";
import { buildSearchDocs, attributeDoc, rankSearch } from "./lib/search.js";
import * as ops from "./lib/catalog-ops.js";
import { useSession } from "./hooks/use-session.js";
import { useCatalogStore } from "./hooks/use-catalog-store.js";
import { useUnread } from "./hooks/use-unread.js";
import { useServerSearch } from "./hooks/use-server-search.js";
import { useNavigation } from "./hooks/use-navigation.js";
import { useStructureActions } from "./hooks/use-structure-actions.js";
import { useImportExport } from "./hooks/use-import-export.js";
import { useStewardship } from "./hooks/use-stewardship.js";
import { useGlossaryActions } from "./hooks/use-glossary-actions.js";
import { useStableCallbacks } from "./hooks/use-stable-callbacks.js";
import { CatalogProviders, useCatalogData, useNav } from "./catalog-context.jsx";
import { I18nProvider, useT, detectLang } from "./i18n.jsx";
import { ToastProvider, useToast } from "./toast-context.jsx";
import { AuthGateC } from "./components/auth.jsx";
import { Topbar } from "./views/topbar.jsx";
import { TreeView } from "./views/tree.jsx";
import { MainView } from "./views/main.jsx";
import { ModalHost } from "./views/modals.jsx";
import { CSS } from "./styles.js";
import { hasRole } from "./lib/roles.js";

function DataCatalogInner() {
  const { t: tr, lang, setLang } = useT();
  const { flash, confirm, prompt } = useToast();   /* v1.70: toast + confirm / prompt dialogs come from ToastProvider */

  /* ── session & shared catalog ── */
  const { me, setMe, authScreen, logout, onAuthed } = useSession();
  useEffect(() => { if (me?.lang && me.lang !== lang) setLang(me.lang); }, [me?.lang]);   // eslint-disable-line react-hooks/exhaustive-deps -- only a new account language applies; a manual switch (lang) must not be undone
  const store = useCatalogStore(me, flash);
  const { state, patch, lazy, catVersion, savedVersion: catalogVersion, ensureAttributes, ensureFullCatalog, reloadCatalog } = store;
  const { unread, setUnread, refreshUnread } = useUnread(me);

  /* ── lookups & permissions ── */
  const L = useMemo(() => makeLookups(state, lazy), [state, lazy]);
  const { hubs, databases, schemas, tables, attributes, glossary, hub, person, domain, db, schema, dbsOf, schemasOf, tablesOf, isDataProduct, refLabel } = L;
  /* v1.66: role-derived flags come from the server (me.capabilities); the role list is the fallback for older payloads */
  const caps = me?.capabilities || null;
  const isAdmin = caps ? caps.admin : me?.role === "admin";
  const isPm = caps ? caps.canDesignProducts : isAdmin || hasRole(me, "pm");
  const perm = useMemo(() => buildPerms(state, me), [state, me]);
  const canEdit = perm.canEditAnything;      /* may edit something at all (admin, or a steward/owner with at least one responsibility) */
  const canStructure = perm.canEditStructure;

  /* ── navigation (hook, v1.69): view, selection, tree state, search box, dialog, mobile rail, openRef ── */
  const nav = useNavigation({ L, me });
  const { view, sel, setSel, open, query, modal, setModal, tableTab, linSc, sFacet, mpPreset, glossaryFocus, railOpen, setRailOpen } = nav;

  /* ── derived data ── */
  const tableOptions = useMemo(() => tables.map((t) => {
    const sc = schema(t.schemaId); const d = db(sc?.databaseId);
    return { id: t.id, label: `${d?.name || "?"}.${sc?.name || "?"}.${t.name}`, uc: d?.source === "unity" };
  }).sort((a, b) => a.label.localeCompare(b.label)), [tables, schema, db]);
  const serverHits = useServerSearch(query);
  const searchDocs = useMemo(() => buildSearchDocs(state, L), [state, L]);
  /* lazy catalogs: attributes the server matched but the browser has not loaded are searchable too (v1.66) */
  const serverAttrDocs = useMemo(() => {
    if (!lazy.on || !serverHits?.attributes?.length) return [];
    const have = new Set(attributes.map((a) => a.id));
    return serverHits.attributes.filter((a) => !have.has(a.id) && L.table(a.tableId)).map((a) => attributeDoc(L, a));
  }, [lazy.on, serverHits, attributes, L]);
  const searchResults = useMemo(() => rankSearch(serverAttrDocs.length ? [...searchDocs, ...serverAttrDocs] : searchDocs, query, sFacet, serverHits), [query, sFacet, searchDocs, serverAttrDocs, serverHits]);
  const knownSources = useMemo(() => {   /* remembered connection profiles (never secrets), newest first */
    const seen = new Map();
    for (const d of databases) if (d.sourceRef) { const k = sourceKey(d.sourceRef); if (!seen.has(k) || (d.sourceRef.lastUsed || 0) > (seen.get(k).lastUsed || 0)) seen.set(k, d.sourceRef); }
    return [...seen.values()].sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
  }, [databases]);
  const mpProducts = useMemo(() => schemas.filter(isDataProduct).map((sc) => {
    const d = db(sc.databaseId);
    return { id: sc.id, label: `${hub(d?.hubId)?.name || "?"} · ${d?.name}.${sc.name}`, ownerName: person(domain(d?.domainId)?.ownerId || hub(d?.hubId)?.ownerId)?.name || null };
  }), [schemas, isDataProduct, db, hub, person, domain]);
  const sourceTree = useMemo(() => {
    const srcHub = hubs.find((h) => L.isSourceHub(h));
    if (!srcHub) return [];
    return dbsOf(srcHub.id).map((d) => ({
      id: d.id, name: d.name, country: d.country || "GLOBAL",
      schemas: schemasOf(d.id).map((sc) => ({ id: sc.id, name: sc.name, tables: tablesOf(sc.id).map((t) => ({ id: t.id, name: t.name, kvTags: t.kvTags || [] })) })),
    }));
  }, [hubs, L, dbsOf, schemasOf, tablesOf]);
  const projectValues = useMemo(() => ops.kvValuesOf(state, ops.PROJECT_KEY), [state]);
  const useCaseValues = useMemo(() => ops.kvValuesOf(state, "Use Case"), [state]);
  const glossaryRefOptions = useMemo(() => ({
    hub: hubs.map((h) => ({ id: h.id, label: h.name })),
    database: databases.map((d) => ({ id: d.id, label: `${hub(d.hubId)?.name} · ${d.name}` })),
    schema: schemas.map((sc) => { const d = db(sc.databaseId); return { id: sc.id, label: `${d?.name}.${sc.name}` }; }),
    table: tableOptions,
    attribute: attributes.map((a) => ({ id: a.id, label: refLabel({ type: "attribute", id: a.id }) })).sort((x, y) => x.label.localeCompare(y.label)),
  }), [hubs, databases, schemas, attributes, tableOptions, hub, db, refLabel]);

  /* ── actions (hooks, v1.69) ── */
  const structure = useStructureActions({ catalog: { state, L, perm, lazy }, store: { patch, ensureAttributes }, nav: { sel, setSel, setModal }, toast: { flash, confirm } });
  const io = useImportExport({ setModal, reloadCatalog, flash });
  const steward = useStewardship({ me, catalog: { state, L }, patch, toast: { flash, prompt } });
  const gloss = useGlossaryActions({ me, catalog: { glossary, perm, refLabel, catVersion }, patch, setModal, toast: { flash, confirm } });

  /* v1.73 (F-F8): three contexts instead of one. Actions: every function is stable (useStableCallbacks keeps one
     identity per action and forwards to the newest closure — v1.71, F-F1), so this value never changes. Data: changes
     with the catalog, the account and the derived lists only — a navigation step, a toast or a language switch keeps
     it. Nav: the navigation state and its (stable) setters. */
  const actions = useStableCallbacks({
    logout, refreshUnread, patch, ensureAttributes, ensureFullCatalog, reloadCatalog, setMe, setUnread, openRef: nav.openRef, openRequests: nav.openRequests, openGlossaryTerm: nav.openGlossaryTerm,
    ...structure, ...io, ...gloss, ...steward,
  });
  const { glossaryFilesTick } = gloss;
  const { stewardshipPolicy } = steward;
  const data = useMemo(() => ({
    ...L, state, lazy, catVersion, catalogVersion, me, isAdmin, isPm, perm, canEdit, canStructure, unread,
    tableOptions, searchResults, knownSources, mpProducts, sourceTree, projectValues, useCaseValues, glossaryRefOptions,
    glossaryFilesTick, stewardshipPolicy,
  }), [L, state, lazy, catVersion, catalogVersion, me, isAdmin, isPm, perm, canEdit, canStructure, unread,
    tableOptions, searchResults, knownSources, mpProducts, sourceTree, projectValues, useCaseValues, glossaryRefOptions,
    glossaryFilesTick, stewardshipPolicy]);
  const { setView, setOpen, setQuery, setTableTab, setLinSc, setSFacet, setMpPreset, setGlossaryFocus } = nav;   /* useState setters: stable */
  const { openRef } = actions;
  const navValue = useMemo(() => ({
    view, setView, sel, setSel, open, setOpen, query, setQuery, modal, setModal, tableTab, setTableTab, linSc, setLinSc,
    sFacet, setSFacet, mpPreset, setMpPreset, glossaryFocus, setGlossaryFocus, railOpen, setRailOpen, openRef,
  }), [view, setView, sel, setSel, open, setOpen, query, setQuery, modal, setModal, tableTab, setTableTab, linSc, setLinSc,
    sFacet, setSFacet, mpPreset, setMpPreset, glossaryFocus, setGlossaryFocus, railOpen, setRailOpen, openRef]);

  /* ── auth gate ── */
  if (me === undefined) {
    return (
      <div className="dc-root"><style>{CSS}</style><div className="brandband" />
        <div style={{ margin: "auto", color: "#6B6B68" }}>{tr("Loading…")}</div>
      </div>
    );
  }
  if (!me) return <AuthGateC screen={authScreen || { mode: "login" }} onAuthed={onAuthed} />;

  /* ── shell ── */
  return (
    <CatalogProviders data={data} nav={navValue} actions={actions}>
      <Shell />
    </CatalogProviders>
  );
}

/* the application frame; a memo component without props, so it re-renders only when a context it reads changes */
const Shell = React.memo(function Shell() {
  const { t: tr } = useT();
  const { canStructure } = useCatalogData();
  const { setModal, railOpen, setRailOpen } = useNav();
  return (
    <div className="dc-root">
      <style>{CSS}</style>
      <a className="skip-link" href="#main-content">{tr("Skip to main content")}</a>
      <div className="brandband" />
      <Topbar />
      <div className="body">
        {railOpen && <div className="rail-backdrop" onClick={() => setRailOpen(false)} aria-hidden="true" />}
        <nav id="catalog-rail" className={`rail ${railOpen ? "open" : ""}`} aria-label={tr("Catalog tree")} onClick={(e) => { if (railOpen && e.target.closest(".tree-row")) setRailOpen(false); }}>
          <div className="rail-head">
            <span className="rail-title">{tr("Data hub types")}</span>
            <span style={{ display: "flex", gap: 4 }}>
              {canStructure && <button className="btn btn-ghost btn-sm" onClick={() => setModal({ kind: "datahub" })} aria-label={tr("New data hub")} title={tr("New data hub")}><Plus size={15} /></button>}
              <button className="btn btn-ghost btn-sm rail-close" onClick={() => setRailOpen(false)} aria-label={tr("Close")}><X size={16} /></button>
            </span>
          </div>
          <TreeView />
        </nav>
        <main id="main-content" className="main" tabIndex={-1}><MainView /></main>
      </div>
      <ModalHost />
    </div>
  );
});

export default function DataCatalog() {
  const [initial] = useState(() => detectLang(null));
  return <I18nProvider initial={initial}><ToastProvider><DataCatalogInner /></ToastProvider></I18nProvider>;
}
