/* Glossary actions (v1.69 — extracted from App.jsx): save / delete terms (with attachments uploaded after the
   save), the JSON export of all terms, and the tick that tells the glossary view to reload its file list. */
import { useState } from "react";
import { useT } from "../i18n.jsx";
import { fill } from "../lib/i18n-format.js";
import { uid } from "../lib/model.js";
import { downloadJson, fileToBase64 } from "../lib/download.js";
import { apiPost, apiGetOr } from "../lib/api.js";
import * as ops from "../lib/catalog-ops.js";

/* v1.73 (F-F7): inputs grouped — catalog: { glossary, perm, refLabel, catVersion }, toast: { flash, confirm } */
export function useGlossaryActions({ me, catalog, patch, setModal, toast }) {
  const { glossary, perm, refLabel, catVersion } = catalog;
  const { flash, confirm } = toast;
  const { t, tn } = useT();
  const [glossaryFilesTick, setGlossaryFilesTick] = useState(0);
  const uploadGlossaryFile = async (termId, file) => {
    const data = await fileToBase64(file);
    await apiPost(`/api/glossary/${termId}/files`, { name: file.name, mime: file.type, data });
  };
  const saveGlossaryTerm = async (f, editId) => {
    const name = String(f.name || "").trim();
    if (!name) { flash("A glossary term needs a name"); return; }
    if (glossary.some((g) => g.name.toLowerCase() === name.toLowerCase() && g.id !== editId)) { flash("Glossary term \"{name}\" already exists", { name }); return; }
    const termId = editId || uid();
    patch((s) => ops.saveGlossaryTerm(s, f, editId, { termId, canSetOwner: perm.canSetOwner, createdBy: me?.email }));
    setModal(null);
    const pending = f.files || [];
    let ok = 0; const failed = [];
    for (const file of pending) { try { await uploadGlossaryFile(termId, file); ok++; } catch (e) { failed.push(`${file.name} (${e.message})`); } }
    if (pending.length) setGlossaryFilesTick((t) => t + 1);
    /* attachment outcome, translated (v1.73 — it used to be appended in English); the file names stay as they are */
    const tail = `${ok ? ` · ${tn(["{n} file attached", "{n} files attached"], ok)}` : ""}${failed.length ? ` · ${fill(t("failed: {files}"), { files: failed.join(", ") })}` : ""}`;
    flash(editId ? "Glossary term updated{tail}" : "Glossary term \"{name}\" created{tail}", { name, tail });
  };
  const deleteGlossaryTerm = async (g) => {
    if (!(await confirm("Delete glossary term \"{name}\"? Attached files are removed as well.", { name: g.name }, { danger: true }))) return;
    patch((s) => ops.deleteGlossaryTerm(s, g.id));
    flash("Glossary term \"{name}\" deleted", { name: g.name });
  };
  const exportGlossary = async () => {
    const files = (await apiGetOr("/api/glossary/files-index"))?.files || [];
    downloadJson({
      format: "cortex-glossary", version: 1, exportedAt: new Date().toISOString(), catalogVersion: catVersion.current,
      terms: glossary.map((g) => ({
        id: g.id, name: g.name, definition: g.definition || "",
        references: (g.refs || []).map((r) => ({ type: r.type, id: r.id, path: refLabel(r) || null })),
        externalLinks: g.urls || [],
        attachments: files.filter((f) => f.termId === g.id).map((f) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, storedIn: "mariadb:glossary_files", url: f.url })),
      })),
    }, "alassio-glossary-terms.json");
    flash("Exported {n} glossary terms", { n: glossary.length });
  };
  return { glossaryFilesTick, saveGlossaryTerm, deleteGlossaryTerm, exportGlossary };
}
