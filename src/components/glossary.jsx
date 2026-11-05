import { useState, useEffect, useRef } from "react";
import { useT } from "../i18n.jsx";
import { useToast } from "../toast-context.jsx";
import { useCatalogData, useNav, useActions } from "../catalog-context.jsx";
import { fmtBytes } from "../lib/format.js";
import { fileToBase64 } from "../lib/download.js";
import { apiPost, apiDelete, apiGetOr } from "../lib/api.js";
import { Plus, Trash2, Pencil, X, CheckCircle2, Loader2, History, FileUp, BookOpen, Link2, Paperclip, ExternalLink } from "lucide-react";
import { Modal, Field } from "./ui.jsx";

export function GlossaryTermModalC({ edit, refOptions, refLabel, people = [], domains = [], canSetOwner = true, canSetSteward = true, onSave, onClose }) {
  const { t, tn } = useT();
  const { flash } = useToast();
  const [f, setF] = useState(() => edit ? { name: edit.name, definition: edit.definition || "", refs: [...(edit.refs || [])], urls: [...(edit.urls || [])], files: [], domainId: edit.domainId || "", ownerId: edit.ownerId || "", stewardId: edit.stewardId || "" } : { name: "", definition: "", refs: [], urls: [], files: [], domainId: "", ownerId: "", stewardId: "" });
  const fileRef = useRef(null);
  const [refType, setRefType] = useState("table");
  const [refId, setRefId] = useState("");
  const [urlName, setUrlName] = useState("");
  const [urlHref, setUrlHref] = useState("");
  const TYPES = [["hub", "Data hub"], ["database", "Database"], ["schema", "Schema"], ["table", "Table"], ["attribute", "Attribute"]];
  const addRef = () => { if (!refId || f.refs.some((r) => r.type === refType && r.id === refId)) return; setF({ ...f, refs: [...f.refs, { type: refType, id: refId }] }); setRefId(""); };
  const addUrl = () => { const u = urlHref.trim(); if (!/^https?:\/\//i.test(u)) return; setF({ ...f, urls: [...f.urls, { name: urlName.trim() || u, url: u }] }); setUrlName(""); setUrlHref(""); };
  return (
    <Modal wide title={edit ? t("Edit glossary term") : t("New glossary term")} sub={t("A glossary term is a free-text definition that can point to catalog entities and external resources, and carry attached files (stored in the catalog database).")} onClose={onClose}>
      <Field label={t("Term")}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t("e.g. Loss ratio")} autoFocus /></Field>
      <Field label={t("Definition")}><textarea rows={7} value={f.definition} onChange={(e) => setF({ ...f, definition: e.target.value })} placeholder={t("Business definition, calculation rules, scope, examples …")} style={{ width: "100%" }} /></Field>
      <div className="field-row">
        <Field label={t("Data domain")}>
          <select value={f.domainId} onChange={(e) => setF({ ...f, domainId: e.target.value })}>
            <option value="">{t("— none —")}</option>
            {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label={canSetOwner ? t("Data owner") : t("Data owner (admins only)")}>
          <select value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })} disabled={!canSetOwner} style={!canSetOwner ? { background: "#F3F3F1" } : undefined}>
            <option value="">{t("— unassigned —")}</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label={canSetSteward ? t("Data steward") : t("Data steward (admins or the owner)")}>
          <select value={f.stewardId} onChange={(e) => setF({ ...f, stewardId: e.target.value })} disabled={!canSetSteward} style={!canSetSteward ? { background: "#F3F3F1" } : undefined}>
            <option value="">{t("— unassigned —")}</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label={t("Linked entities (data hubs, databases, schemas, tables, attributes)")}>
        {f.refs.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {f.refs.map((r) => <span key={r.type + r.id} className="chip chip-blue">{r.type} · {refLabel(r) || "(missing)"} <button className="btn btn-ghost btn-sm" style={{ padding: 0, marginLeft: 2 }} onClick={() => setF({ ...f, refs: f.refs.filter((x) => x !== r) })} aria-label={t("Remove")}><X size={11} /></button></span>)}
          </div>
        )}
        <div className="field-row" style={{ marginBottom: 0 }}>
          <select value={refType} onChange={(e) => { setRefType(e.target.value); setRefId(""); }} style={{ maxWidth: 150 }}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <select className="mono" value={refId} onChange={(e) => setRefId(e.target.value)}>
            <option value="">{t("— choose —")}</option>
            {(refOptions[refType] || []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <button className="btn" onClick={addRef} disabled={!refId}><Plus size={14} /> {t("Link")}</button>
        </div>
      </Field>
      <Field label={t("External resources (name + URL)")}>
        {f.urls.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            {f.urls.map((u, i) => <div key={i} className="role-row"><ExternalLink size={13} /><span>{u.name}</span><span className="mono" style={{ color: "var(--muted)", fontSize: 12 }}>{u.url}</span><button className="btn btn-ghost btn-sm btn-danger" style={{ marginLeft: "auto" }} onClick={() => setF({ ...f, urls: f.urls.filter((_, j) => j !== i) })} aria-label={t("Remove")}><Trash2 size={13} /></button></div>)}
          </div>
        )}
        <div className="field-row" style={{ marginBottom: 0 }}>
          <input value={urlName} onChange={(e) => setUrlName(e.target.value)} placeholder={t("Name, e.g. Group policy")} style={{ maxWidth: 220 }} />
          <input className="mono" value={urlHref} onChange={(e) => setUrlHref(e.target.value)} placeholder="https://…" onKeyDown={(e) => e.key === "Enter" && addUrl()} />
          <button className="btn" onClick={addUrl} disabled={!/^https?:\/\//i.test(urlHref.trim())}><Plus size={14} /> {t("Add")}</button>
        </div>
      </Field>
      <Field label={`Attach files${edit ? " (added to the existing attachments)" : ""} — max 15 MB each`}>
        {f.files.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            {f.files.map((file, i) => <div key={i} className="role-row"><Paperclip size={13} /><span>{file.name}</span><span style={{ fontSize: 12, color: "var(--muted)" }}>{fmtBytes(file.size)}</span><button className="btn btn-ghost btn-sm btn-danger" style={{ marginLeft: "auto" }} onClick={() => setF({ ...f, files: f.files.filter((_, j) => j !== i) })} aria-label={t("Remove")}><Trash2 size={13} /></button></div>)}
          </div>
        )}
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => { const picked = Array.from(e.target.files || []); const tooBig = picked.filter((x) => x.size > 15 * 1024 * 1024); setF({ ...f, files: [...f.files, ...picked.filter((x) => x.size <= 15 * 1024 * 1024)] }); e.target.value = ""; if (tooBig.length) flash("Skipped (over 15 MB): {names}", { names: tooBig.map((x) => x.name).join(", ") }); }} />
        <button className="btn btn-sm" onClick={() => fileRef.current?.click()}><FileUp size={13} /> {t("Choose files…")}</button>
      </Field>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>{t("Cancel")}</button>
        <button className="btn btn-primary" onClick={() => onSave(f)} disabled={!f.name.trim()}><CheckCircle2 size={15} /> {edit ? t("Save") : t("Create")}{f.files.length ? ` + ${tn(["upload {n} file", "upload {n} files"], f.files.length)}` : ""}</button>
      </div>
    </Modal>
  );
}

/* v1.73 (F-F8): reads the catalog contexts itself — main.jsx used to pass 13 props */
export function GlossaryViewC() {
  const { t } = useT();
  const { glossary, glossaryFilesTick: refreshKey, refLabel, person, domain, perm } = useCatalogData();
  const { glossaryFocus: focusId, setModal, openRef: onOpenRef } = useNav();
  const { deleteGlossaryTerm: onDelete } = useActions();
  const canEdit = perm.canEditGlossary;
  const personName = (id) => person(id)?.name || "";
  const domainName = (id) => domain(id)?.name || "";
  const onNew = () => setModal({ kind: "glossary" });
  const onEdit = (g) => setModal({ kind: "glossary", edit: g });
  const onHistory = (g) => setModal({ kind: "history", scopeId: g.id, title: g.name });
  const { flash, confirm } = useToast();
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState(focusId);
  useEffect(() => { if (focusId) setSelId(focusId); }, [focusId]);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const term = glossary.find((g) => g.id === selId) || null;
  const list = glossary.filter((g) => { const s = q.trim().toLowerCase(); return !s || g.name.toLowerCase().includes(s) || (g.definition || "").toLowerCase().includes(s); }).sort((a, b) => a.name.localeCompare(b.name));

  const loadFiles = async (id) => { const j = await apiGetOr(`/api/glossary/${id}/files`); setFiles(j ? j.files : []); };
  useEffect(() => { if (selId) loadFiles(selId); else setFiles([]); }, [selId, refreshKey]);
  const upload = async (file) => {
    if (!term) return;
    setBusy(true);
    try {
      const data = await fileToBase64(file);
      await apiPost(`/api/glossary/${term.id}/files`, { name: file.name, mime: file.type, data });
      flash("\"{name}\" attached", { name: file.name }); loadFiles(term.id);
    } catch (e) { flash("Upload failed — {error}", { error: e.message }); }
    setBusy(false);
  };
  const removeFile = async (f) => {
    if (!(await confirm("Remove \"{name}\"?", { name: f.name }, { danger: true, confirmLabel: "Remove" }))) return;
    try { await apiDelete(`/api/glossary/files/${f.id}`); flash("File removed"); loadFiles(term.id); } catch { flash("Could not remove file"); }
  };

  return (
    <>
      <div className="entity-head">
        <div className="entity-icon"><BookOpen size={22} /></div>
        <div>
          <h1 className="entity-title">{t("Glossary")}</h1>
          <div className="entity-sub">{t("Business terms with definitions, links to catalog entities, external resources and attached documents.")}</div>
        </div>
        <div className="head-actions">
          {canEdit && <button className="btn btn-primary" onClick={onNew}><Plus size={15} /> {t("New glossary term")}</button>}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) 2fr", gap: 18, marginTop: 18 }}>
        <div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search glossary terms…")} style={{ width: "100%", marginBottom: 10 }} />
          <div className="panel" style={{ padding: 6 }}>
            {!list.length && <div className="empty">{q ? t("No glossary terms match.") : t("No glossary terms yet.")}</div>}
            {list.map((g) => (
              <button key={g.id} className={`menu-item ${g.id === selId ? "active" : ""}`} onClick={() => setSelId(g.id)} style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                <span style={{ fontWeight: 600 }}>{g.name}</span>
                <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{(g.definition || "").slice(0, 90) || t("No definition yet")}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          {!term ? <div className="empty">{canEdit ? t("Select a glossary term on the left or create a new one.") : t("Select a glossary term on the left.")}</div> : (
            <div className="panel" style={{ padding: 18 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <h2 style={{ margin: 0, fontSize: 20 }}>{term.name}</h2>
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  {canEdit && <button className="btn btn-sm" onClick={() => onHistory(term)}><History size={13} /> {t("History")}</button>}
                  {canEdit && <button className="btn btn-sm" onClick={() => onEdit(term)}><Pencil size={13} /> {t("Edit")}</button>}
                  {canEdit && <button className="btn btn-sm btn-danger" aria-label={t("Delete")} title={t("Delete")} onClick={() => { onDelete(term); setSelId(null); }}><Trash2 size={13} /></button>}
                </div>
              </div>
              <p style={{ whiteSpace: "pre-wrap", marginTop: 10 }}>{term.definition || <span style={{ color: "var(--muted)" }}>{t("No definition yet.")}</span>}</p>
              {(term.domainId || term.ownerId || term.stewardId) && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  {term.domainId && <span className="chip chip-blue">{domainName(term.domainId)}</span>}
                  {term.ownerId && <span className="chip chip-amber">Owner · {personName(term.ownerId)}</span>}
                  {term.stewardId && <span className="chip chip-grey">Steward · {personName(term.stewardId)}</span>}
                </div>
              )}
              <h4 style={{ margin: "16px 0 6px" }}><Link2 size={14} style={{ verticalAlign: "-2px" }} /> {t("Linked entities")}</h4>
              {(term.refs || []).length ? <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{term.refs.map((r) => <button key={r.type + r.id} className="chip chip-blue" style={{ cursor: "pointer", border: 0 }} onClick={() => onOpenRef(r)}>{r.type} · {refLabel(r) || "(missing)"}</button>)}</div> : <div className="modal-sub">—</div>}
              <h4 style={{ margin: "16px 0 6px" }}><ExternalLink size={14} style={{ verticalAlign: "-2px" }} /> {t("External resources")}</h4>
              {(term.urls || []).length ? term.urls.map((u, i) => <div key={i}><a href={u.url} target="_blank" rel="noreferrer noopener">{u.name}</a> <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{u.url}</span></div>) : <div className="modal-sub">—</div>}
              <h4 style={{ margin: "16px 0 6px" }}><Paperclip size={14} style={{ verticalAlign: "-2px" }} /> {t("Attached files")}</h4>
              {files.length ? files.map((f) => (
                <div key={f.id} className="role-row">
                  <a href={f.url} download>{f.name}</a>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{fmtBytes(f.size)} · {new Date(f.ts).toLocaleDateString()} · {f.uploadedBy}</span>
                  {canEdit && <button className="btn btn-ghost btn-sm btn-danger" style={{ marginLeft: "auto" }} onClick={() => removeFile(f)} aria-label={t("Remove file")}><Trash2 size={13} /></button>}
                </div>
              )) : <div className="modal-sub">{t("No files attached.")}</div>}
              {canEdit && (
                <>
                  <input ref={fileRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
                  <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? <Loader2 size={13} className="spin" /> : <FileUp size={13} />} {t("Attach file (max 15 MB)")}</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
