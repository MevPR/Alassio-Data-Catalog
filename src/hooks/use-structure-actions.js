/* Catalog structure actions (v1.69 — extracted from App.jsx): create / edit / delete of hubs, data hubs, databases,
   schemas, tables and attributes, lineage links and mappings, project / use-case tags, source references, and the
   attribute loader for lazy catalogs. Every action validates, calls the pure operation in src/lib/catalog-ops.js
   through patch() and reports with flash(). */
import { normCountry } from "../lib/model.js";
import * as ops from "../lib/catalog-ops.js";

/* v1.73 (F-F7): inputs grouped by owner, and only what is used — the hook no longer receives the whole navigation
   object nor reads the open dialog as hidden input (saveEntity gets the dialog descriptor from its caller).
     catalog: { state, L, perm, lazy }   store: { patch, ensureAttributes }
     nav:     { sel, setSel, setModal }  toast: { flash, confirm } */
export function useStructureActions({ catalog, store, nav, toast }) {
  const { state, L, perm, lazy } = catalog;
  const { patch, ensureAttributes } = store;
  const { sel, setSel, setModal } = nav;
  const { flash, confirm } = toast;
  const { hubs, tables, hub, dbsOf, dataHubsOf, attrsOf } = L;
  const removeEntity = (type, id) => {
    patch((s) => ops.removeEntity(s, type, id));
    if (sel.id === id) setSel({ type: "home" });
    flash("Deleted");
  };
  const deleteHub = async (h) => {
    if (dbsOf(h.id).length) { flash("\"{name}\" still contains databases — move or delete them first", { name: h.name }); return; }
    if (hubs.length <= 1) { flash("At least one data hub must remain"); return; }
    if (await confirm("Delete data hub \"{name}\"?", { name: h.name }, { danger: true })) removeEntity("hub", h.id);
  };
  const restoreRecord = (entry) => {
    if (!ops.restoreParentOk(state, entry)) { flash("Cannot restore — the parent object no longer exists. Restore the parent first."); return; }
    patch((s) => ops.restoreRecord(s, entry));
    flash("Restored {type} \"{name}\"", { type: entry.entityType, name: entry.name });
  };
  const saveDataHub = (hubTypeId, f, editName) => {
    const name = normCountry(f.name);
    if (!f.name?.trim()) { flash("Please name the data hub"); return false; }
    const leanixUrl = String(f.leanixUrl || "").trim();
    if (leanixUrl && !/^https?:\/\//i.test(leanixUrl)) { flash("The LeanIX link must be a URL (https://…)"); return false; }
    const h = hub(hubTypeId);
    if (dataHubsOf(h).some((x) => x.name.toLowerCase() === name.toLowerCase() && x.name !== editName)) { flash("Data hub \"{name}\" already exists in {hub}", { name, hub: h.name }); return false; }
    const cur = editName ? (h.dataHubs || []).find((x) => x.name === editName) : null;
    const bpoId = perm.canSetOwner ? (f.bpoId || null) : (cur?.bpoId || null);
    patch((s) => ops.saveDataHub(s, hubTypeId, { name, description: f.description, bpoId, domainId: f.domainId, leanixUrl }, editName));
    setSel({ type: "datahub", hubId: hubTypeId, name });
    return true;
  };
  const deleteDataHub = async (hubTypeId, name) => {
    const n = dbsOf(hubTypeId).filter((x) => (x.country || "GLOBAL") === name).length;
    if (n === 1) { flash("\"{name}\" still holds one database — move or delete it first", { name }); return; }
    if (n) { flash("\"{name}\" still holds {n} databases — move or delete them first", { name, n }); return; }
    if (!(await confirm("Delete data hub \"{name}\"?", { name }, { danger: true }))) return;
    patch((s) => ops.deleteDataHub(s, hubTypeId, name));
    setSel({ type: "hub", id: hubTypeId });
  };
  const setDataHubBpo = (hubTypeId, name, personId) => patch((s) => ops.setDataHubBpo(s, hubTypeId, name, personId));
  const assignPerson = (kind, id, field, personId) => patch((s) => ops.assignPerson(s, kind, id, field, personId));
  /* `modal` is the descriptor of the entity dialog that is saving ({ kind, edit, parentId, hubTypeId }) */
  const saveEntity = (modal, f) => {
    const { kind, edit, parentId } = modal;
    if (kind === "datahub") { if (saveDataHub(modal.hubTypeId || f.hubId, f, edit?.name || null)) setModal(null); return; }
    if (kind === "edge") { patch((s) => { ops.addEdge(s, f.from, f.to); return s; }); setModal(null); flash("Lineage link added"); return; }
    if (kind === "table") {   /* no two tables with the same name inside one schema */
      const scId = edit ? edit.schemaId : parentId;
      const clash = tables.find((t) => t.schemaId === scId && t.name.toLowerCase() === f.name.trim().toLowerCase() && t.id !== edit?.id);
      if (clash) { flash("A table named \"{name}\" already exists in this schema", { name: clash.name }); return; }
    }
    let createdTerm = null;
    patch((s) => { createdTerm = ops.saveEntity(s, { kind, edit, parentId }, f); return s; });
    setModal(null);
    if (createdTerm) flash(edit ? "Saved changes · glossary term \"{term}\" created" : "Created {kind} · glossary term \"{term}\" created", { kind, term: createdTerm });
    else if (edit) flash("Saved changes"); else flash("Created {kind}", { kind });
  };
  const addEdgeMapping = (edgeId, fromAttrId, toAttrId) => patch((s) => ops.addEdgeMapping(s, edgeId, fromAttrId, toAttrId));
  const removeEdgeMapping = (edgeId, mapId) => patch((s) => ops.removeEdgeMapping(s, edgeId, mapId));
  const addProjectTag = (kind, id, value) => patch((s) => ops.addProjectTag(s, kind, id, value));
  const removeProjectTag = (kind, id, value) => patch((s) => ops.removeProjectTag(s, kind, id, value));
  const recordSource = (dbId, ref) => patch((s) => ops.recordSource(s, dbId, ref));
  /* attributes of one table, fetched from the server while the catalog is lazy (write-back, previews) */
  const loadAttrsOf = async (tableId) => {
    if (!lazy.on || lazy.loaded.has(tableId)) return attrsOf(tableId);
    return (await ensureAttributes(tableId)) || [];   /* v1.68: through the store, so the rows are cached as well */
  };
  return { removeEntity, deleteHub, restoreRecord, saveDataHub, deleteDataHub, setDataHubBpo, assignPerson, saveEntity, addEdgeMapping, removeEdgeMapping, addProjectTag, removeProjectTag, recordSource, loadAttrsOf };
}
