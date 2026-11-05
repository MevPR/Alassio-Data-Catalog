import { useEffect, useRef, useState } from "react";
import { seed, migrate } from "../lib/model.js";
import { diffCatalogs } from "../../catalog-diff.js";
import { apiGet, apiGetOr, apiPatch, ApiError } from "../lib/api.js";

/* The shared catalog document: load from the server once signed in, debounce-save deltas
   (optimistic locking per object), lazy attribute loading for large catalogs. */
export function useCatalogStore(me, flash) {
  const [state, setState] = useState(seed);
  const [lazy, setLazy] = useState({ on: false, stats: null, loaded: new Set() }); /* large catalogs: attributes are fetched per table */
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef(null);
  const catVersion = useRef(0);
  /* v1.73 (F-F13): the server version as render state — views that show server-computed data (/api/stats, the
     dashboard) refetch when it changes, i.e. once per confirmed save or reload, instead of after every local patch */
  const [savedVersion, setSavedVersion] = useState(0);
  const lastSaved = useRef(null); // catalog as last confirmed by the server — deltas are computed against it

  /* Adopt a catalog received from the server. Since v1.66 the server upgrades and seeds the stored document itself
     (server/catalog-migrate.js); migrate() here is only a defensive no-op for a current document, and the migrated
     document is the delta base for everyone — the browser never writes a migration any more. */
  const adoptCatalog = (serverCatalog, version) => {
    const migrated = migrate(serverCatalog);
    lastSaved.current = structuredClone(migrated);
    catVersion.current = version || 0;
    setSavedVersion(catVersion.current);
    setState(migrated);
    return migrated;
  };

  /* initial load */
  useEffect(() => {
    if (!me) return;
    (async () => {
      const j = await apiGetOr("/api/catalog");
      if (j) {
        if (j.catalog) {
          adoptCatalog(j.catalog, j.version);   /* a fresh installation is seeded by the server (v1.66) */
          if (j.lazy) setLazy({ on: true, stats: j.stats || null, loaded: new Set() });
        } else catVersion.current = j.version || 0;
      }
      setLoaded(true);
    })();
  }, [me]);

  /* debounced delta save */
  useEffect(() => {
    if (!loaded || !me || me.role === "guest") return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const base = lastSaved.current;
        const changes = diffCatalogs(base, state, me || {}).map((e) => ({ entityType: e.entityType, action: e.action, id: e.entityId, before: e.before, after: e.after }));
        if (!changes.length) return;
        let j;
        try { j = await apiPatch("/api/catalog", { baseVersion: catVersion.current, changes }); }
        catch (e) {
          if (!(e instanceof ApiError) || e.status !== 409) return;   /* other failures: the next edit retries the delta */
          const cur = await apiGetOr("/api/catalog");
          if (cur?.catalog) adoptCatalog(cur.catalog, cur.version);
          const who = ((e.body || {}).conflicts || []).map((c) => c.name || c.id).slice(0, 3).join(", ");
          flash(who ? "Someone else changed {who} in the meantime — the catalog was reloaded, please re-apply your last edit" : "Someone else changed the same object in the meantime — the catalog was reloaded, please re-apply your last edit", { who });
          return;
        }
        catVersion.current = j.version ?? catVersion.current;
        setSavedVersion(catVersion.current);
        lastSaved.current = state;
      } catch { }
    }, 600);
  }, [state, loaded, me, flash]);   /* flash is stable (ToastProvider useCallback) */

  const patch = (fn) => setState((s) => fn(structuredClone(s)));
  /* loads a table's attributes into the document (lazy catalogs); resolves to the rows it fetched, or null when they
     were already present / could not be loaded — callers that need the rows immediately use the return value because
     the state update lands on the next render (v1.68) */
  const ensureAttributes = async (tableId) => {
    if (!lazy.on || lazy.loaded.has(tableId)) return null;
    try {
      const { attributes: rows } = await apiGet(`/api/tables/${tableId}/attributes`);
      const merge = (c) => ({ ...c, attributes: [...(c.attributes || []).filter((a) => a.tableId !== tableId), ...rows] });
      if (lastSaved.current) lastSaved.current = merge(lastSaved.current);
      setState((s) => merge(s));
      setLazy((l) => ({ ...l, loaded: new Set([...l.loaded, tableId]) }));
      return rows;
    } catch { return null; }
  };
  /* exports and write-back need every attribute: switch to the full document once */
  const ensureFullCatalog = async () => {
    if (!lazy.on) return state;
    let j;
    try { j = await apiGet("/api/catalog?full=1"); } catch (e) { if (e instanceof ApiError) return state; throw e; }   /* a refused answer keeps the lazy document; a network error propagates as before */
    const m = adoptCatalog(j.catalog, j.version);
    setLazy((l) => ({ ...l, loaded: new Set(state.tables.map((t) => t.id)) }));
    return m;
  };
  const reloadCatalog = async () => {
    const j = await apiGetOr("/api/catalog");
    if (j?.catalog) adoptCatalog(j.catalog, j.version);
  };
  return { state, setState, patch, lazy, loaded, catVersion, savedVersion, adoptCatalog, ensureAttributes, ensureFullCatalog, reloadCatalog };
}
