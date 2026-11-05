import { useState } from "react";
import { useT } from "../i18n.jsx";
import { Plus, Trash2, ArrowRight } from "lucide-react";
import { Modal, Field } from "./ui.jsx";

export function EdgeMapModalC({ edge, fromTable, toTable, fromPath, toPath, fromAttrs, toAttrs, canEdit, onAdd, onRemove, onOpen, onClose }) {
  const { t, tn } = useT();
  const [fromSel, setFromSel] = useState("");
  const [toSel, setToSel] = useState("");
  const maps = edge.mappings || [];
  const aName = (list, id) => list.find((a) => a.id === id)?.name || "?";
  const dup = maps.some((m) => m.from === fromSel && m.to === toSel);
  return (
    <Modal title={t("Attribute mapping")} sub={t("Optionally map the attributes of the upstream table onto the attributes of the downstream table. The lineage link itself stays as it is.")} onClose={onClose} wide>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button className="btn btn-sm mono" onClick={() => onOpen(fromTable.id)}>{fromPath}</button>
        <ArrowRight size={15} style={{ color: "var(--muted)" }} />
        <button className="btn btn-sm mono" onClick={() => onOpen(toTable.id)}>{toPath}</button>
        <span className="chip chip-grey" style={{ marginLeft: "auto" }}>{tn(["{n} mapping", "{n} mappings"], maps.length)}</span>
      </div>
      {maps.length > 0 ? (
        <div className="panel" style={{ padding: 10, marginBottom: 12 }}>
          {maps.map((m) => (
            <div key={m.id} className="role-row">
              <span className="mono" style={{ fontSize: 13 }}>{aName(fromAttrs, m.from)}</span>
              <ArrowRight size={13} style={{ color: "var(--muted)" }} />
              <span className="mono" style={{ fontSize: 13 }}>{aName(toAttrs, m.to)}</span>
              {canEdit && <button className="btn btn-ghost btn-sm btn-danger" style={{ marginLeft: "auto" }} onClick={() => onRemove(m.id)} aria-label={t("Remove mapping")}><Trash2 size={13} /></button>}
            </div>
          ))}
        </div>
      ) : (
        <div className="modal-sub" style={{ marginBottom: 12 }}>{t("No attributes mapped yet — this is optional.")}</div>
      )}
      {canEdit && (
        <div className="field-row" style={{ alignItems: "end" }}>
          <Field label={`Attribute of ${fromTable.name} (upstream)`}>
            <select className="mono" value={fromSel} onChange={(e) => setFromSel(e.target.value)}>
              <option value="">{t("— choose attribute —")}</option>
              {fromAttrs.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.dataType})</option>)}
            </select>
          </Field>
          <Field label={`Attribute of ${toTable.name} (downstream)`}>
            <select className="mono" value={toSel} onChange={(e) => setToSel(e.target.value)}>
              <option value="">{t("— choose attribute —")}</option>
              {toAttrs.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.dataType})</option>)}
            </select>
          </Field>
          <Field label=" ">
            <button className="btn btn-primary" disabled={!fromSel || !toSel || dup}
              onClick={() => { onAdd(fromSel, toSel); setFromSel(""); setToSel(""); }}>
              <Plus size={14} /> {t("Add mapping")}
            </button>
          </Field>
        </div>
      )}
      {dup && <div className="modal-sub">{t("This pair is already mapped.")}</div>}
      {(!fromAttrs.length || !toAttrs.length) && <div className="modal-sub">Note: {!fromAttrs.length ? fromTable.name : toTable.name} has no attributes yet.</div>}
      <div className="modal-actions"><button className="btn" onClick={onClose}>{t("Close")}</button></div>
    </Modal>
  );
}
