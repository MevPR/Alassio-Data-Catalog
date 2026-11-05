import { useState } from "react";
import { useT } from "../i18n.jsx";
import { BookOpen } from "lucide-react";
import { SENSITIVITY, CLASSIFICATION, TABLE_TYPES, LAYERS, isSourceHub as isSourceHubOf } from "../lib/model.js";
import { Modal, Field } from "./ui.jsx";

/* owner / steward / BPO and domain pickers — module-level since v1.72 (F-F11): defined inside the render they were a
   new component type on every keystroke, so a keyboard-operated <select> lost focus */
function PeopleSelect({ label, value, onChange, people, disabled = false, hint }) {
  const { t } = useT();
  return (
    <Field label={disabled && hint ? `${label} (${hint})` : label}>
      <select value={value || ""} onChange={onChange} disabled={disabled} style={disabled ? { background: "#F3F3F1" } : undefined}>
        <option value="">{t("— inherited / unassigned —")}</option>
        {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </Field>
  );
}
function DomainSelect({ label, value, onChange, domains, disabled = false, hint }) {
  const { t } = useT();
  return (
    <Field label={disabled && hint ? `${label} (${hint})` : label}>
      <select value={value || ""} onChange={onChange} disabled={disabled} style={disabled ? { background: "#F3F3F1" } : undefined}>
        <option value="">{t("— inherited / none —")}</option>
        {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
    </Field>
  );
}

/* dialog titles and buttons as full dictionary keys (v1.63 phrases; v1.73 — F-F9: an explicit map instead of keys built
   at runtime, so the coverage test sees every one) */
const PHRASES = {
  hub: { New: "New data hub type", Edit: "Edit data hub type", Create: "Create data hub type" },
  datahub: { New: "New data hub", Edit: "Edit data hub", Create: "Create data hub" },
  database: { New: "New database", Edit: "Edit database", Create: "Create database" },
  schema: { New: "New schema", Edit: "Edit schema", Create: "Create schema" },
  table: { New: "New table", Edit: "Edit table", Create: "Create table" },
  attribute: { New: "New attribute", Edit: "Edit attribute", Create: "Create attribute" },
  domain: { New: "New data domain", Edit: "Edit data domain", Create: "Create data domain" },
  person: { New: "New person", Edit: "Edit person", Create: "Create person" },
  edge: { New: "New lineage link", Edit: "Edit lineage link", Create: "Create lineage link" },
};
const SUBS = {
  hub: "Data hub types group data hubs by business segment (e.g. Finance, HR, Sales, Operations). Name the type and describe it — types have no owner; the BPO is assigned per data hub.",
  datahub: "A data hub groups the databases of one platform or source landscape inside a data hub type, e.g. SALES_DE → BRONZE / SILVER / GOLD.",
  attribute: "Technical and business metadata for one column.",
};

export function EntityModalC({ modal, hubs, people, domains, tableOptions = [], glossaryTerms = [], perm = { canSetOwner: true, canSetSteward: true, canSetDomain: true }, onClose, onSave }) {
  const { t } = useT();
  const { kind, edit, presetHubId, presetFrom, presetTo } = modal;
  const [f, setF] = useState(() => edit ? { ...edit } : {
    name: "", description: "", hubId: modal.hubTypeId || presetHubId || (kind === "datahub" ? hubs[0]?.id : null) || "central", country: modal.presetCountry || "GLOBAL", layer: "other", domainId: "",
    type: "TABLE", businessDefinition: "", stewardId: "", tags: "",
    dataType: "STRING", nullable: true, isPK: false, businessTerm: "", sensitivity: "Internal",
    ownerId: "", email: "", from: presetFrom || "", to: presetTo || "",
  });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const isSourceHub = kind === "database" && isSourceHubOf(hubs.find((h) => h.id === (f.hubId || "central")));
  const save = () => { if (kind === "edge" ? (f.from && f.to && f.from !== f.to) : f.name?.trim()) onSave(f); };
  const phrase = (verb) => t(PHRASES[kind]?.[verb] || verb);
  const ownerLock = !perm.canSetOwner, stewardLock = !perm.canSetSteward;
  return (
    <Modal title={edit ? phrase("Edit") : phrase("New")} onClose={onClose}
      sub={SUBS[kind] ? t(SUBS[kind]) : undefined}>
      {kind !== "edge" && (
        <Field label={kind === "person" ? t("Full name") : t("Name")}>
          <input className={["person", "domain", "hub"].includes(kind) ? "" : "mono"} value={f.name || ""} onChange={set("name")}
            autoFocus
            placeholder={{ hub: "Life", database: "motor_prod", schema: "policy", table: "policies", attribute: "policy_id", domain: "Motor", person: "Jane Doe" }[kind]} />
        </Field>
      )}
      {kind === "edge" && (<>
        <Field label={t("Upstream table — data flows from")}>
          <select className="mono" value={f.from} onChange={set("from")}>
            <option value="">{t("— choose table —")}</option>
            {tableOptions.map((o) => <option key={o.id} value={o.id} disabled={o.uc}>{o.label}{o.uc ? " — Unity Catalog (locked)" : ""}</option>)}
          </select>
        </Field>
        <Field label={t("Downstream table — data flows into")}>
          <select className="mono" value={f.to} onChange={set("to")}>
            <option value="">{t("— choose table —")}</option>
            {tableOptions.filter((o) => o.id !== f.from).map((o) => <option key={o.id} value={o.id} disabled={o.uc}>{o.label}{o.uc ? " — Unity Catalog (locked)" : ""}</option>)}
          </select>
        </Field>
        <div className="modal-sub">{t("Direction follows the flow: SOURCE → bronze → silver → gold. Tables from the SOURCE data hub can feed BRONZE tables in any hub. Tables imported from Unity Catalog are locked — their lineage is managed in Databricks and refreshed on import.")}</div>
      </>)}
      {kind === "person" && <Field label={t("E-mail")}><input value={f.email || ""} onChange={set("email")} placeholder={t("jane.doe@company.example")} /></Field>}
      {kind !== "person" && kind !== "attribute" && kind !== "edge" && (
        <Field label={t("Description")}>
          <textarea value={f.description || ""} onChange={set("description")} />
        </Field>
      )}
      {kind === "database" && (
        <div className="field-row">
          <Field label={t("Data hub type")}>
            <select value={f.hubId || "central"} onChange={set("hubId")}>
              {hubs.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </Field>
          <Field label={t("Data hub (free text, e.g. SALES_DE)")}>
            <input className="mono" list="datahub-names" value={f.country || ""} onChange={set("country")} placeholder={t("e.g. SALES_DE")} maxLength={64} />
            <datalist id="datahub-names">{(hubs.find((h) => h.id === (f.hubId || "central"))?.dataHubs || []).map((x) => <option key={x.name} value={x.name} />)}</datalist>
          </Field>
          <Field label={isSourceHub ? t("Medallion layer (SOURCE hub: fixed to Other)") : t("Medallion layer")}>
            <select value={isSourceHub ? "other" : (f.layer || "other")} onChange={set("layer")} disabled={isSourceHub}>
              {LAYERS.map((l) => <option key={l} value={l}>{l[0].toUpperCase() + l.slice(1)}</option>)}
            </select>
          </Field>
          <Field label={t("Data domain")}>
            <select value={f.domainId || ""} onChange={set("domainId")}>
              <option value="">{t("— none —")}</option>
              {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
        </div>
      )}
      {kind === "table" && (<>
        <div className="field-row">
          <Field label={t("Object type")}>
            <select value={f.type} onChange={set("type")}>{TABLE_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          </Field>
          <PeopleSelect value={f.ownerId} onChange={set("ownerId")} people={people} label={t("Data owner (overrides the inherited owner)")} disabled={ownerLock} hint="admins only" />
          <PeopleSelect value={f.stewardId} onChange={set("stewardId")} people={people} label={t("Table steward (overrides the inherited steward)")} disabled={stewardLock} hint="admins or the owner" />
          <DomainSelect value={f.domainId} onChange={set("domainId")} domains={domains} label={t("Data domain (overrides the inherited domain)")} disabled={!perm.canSetDomain} hint="admins or the owner" />
        </div>
        <Field label={t("Glossary term")}>
          <input list="glossary-terms-table" value={f.businessTerm || ""} onChange={set("businessTerm")} placeholder={t("Type a glossary term — unknown terms are created automatically")} />
          <datalist id="glossary-terms-table">{glossaryTerms.map((g) => <option key={g.id} value={g.name} />)}</datalist>
        </Field>
        {(() => {
          const v = String(f.businessTerm || "").trim().toLowerCase();
          if (!v) return null;
          const known = glossaryTerms.find((g) => g.name.toLowerCase() === v);
          return <div className="modal-sub" style={{ marginTop: -6 }}>{known ? <><BookOpen size={11} style={{ verticalAlign: "-1px" }} /> {t("Links to the existing glossary term “{name}”").replace("{name}", known.name)}</> : <>{t("New glossary term “{name}” will be created on save").replace("{name}", f.businessTerm.trim())}</>}</div>;
        })()}
        <Field label={t("Tags (comma-separated)")}><input value={f.tags || ""} onChange={set("tags")} placeholder={t("core, golden-record")} /></Field>
      </>)}
      {kind === "attribute" && (<>
        <div className="field-row">
          <Field label={t("Data type")}><input className="mono" value={f.dataType || ""} onChange={set("dataType")} placeholder="VARCHAR(320)" /></Field>
          <Field label={t("Sensitivity")}>
            <select value={f.sensitivity} onChange={set("sensitivity")}>{SENSITIVITY.map((x) => <option key={x}>{x}</option>)}</select>
          </Field>
          <Field label={t("Classification")}>
            <select value={f.classification || ""} onChange={set("classification")}><option value="">{t("— none —")}</option>{CLASSIFICATION.map((x) => <option key={x}>{x}</option>)}</select>
          </Field>
        </div>
        <div className="field-row" style={{ marginBottom: 14 }}>
          <label className="check"><input type="checkbox" checked={!!f.isPK} onChange={set("isPK")} /> {t("Primary key")}</label>
          <label className="check"><input type="checkbox" checked={!!f.nullable} onChange={set("nullable")} /> {t("Nullable")}</label>
        </div>
        <Field label={t("Description")}><textarea value={f.description || ""} onChange={set("description")} /></Field>
        <Field label={t("Glossary term")}>
          <input list="glossary-terms" value={f.businessTerm || ""} onChange={set("businessTerm")} placeholder={t("Type a glossary term — unknown terms are created automatically")} />
          <datalist id="glossary-terms">{glossaryTerms.map((g) => <option key={g.id} value={g.name} />)}</datalist>
        </Field>
        {(() => {
          const byName = glossaryTerms.find((g) => g.name.toLowerCase() === String(f.businessTerm || "").trim().toLowerCase());
          const linked = glossaryTerms.filter((g) => (g.refs || []).some((r) => r.type === "attribute" && r.id === edit?.id));
          const all = [...new Map([...(byName ? [byName] : []), ...linked].map((g) => [g.id, g])).values()];
          return all.length ? <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "-6px 0 12px" }}>{all.map((g) => <span key={g.id} className="chip chip-blue"><BookOpen size={11} /> {g.name}{linked.includes(g) ? " (links here)" : ""}</span>)}</div> : null;
        })()}
      </>)}
      {kind === "datahub" && (modal.hubTypeId || edit ? (
        <div className="modal-sub">{t("Data hub type:")} <b>{hubs.find((h) => h.id === (modal.hubTypeId || f.hubId))?.name}</b>{edit ? " — " + t("renaming moves all databases of this data hub along.") : ""}</div>
      ) : (
        /* opened from the catalog tree's "+" (v1.63): the data hub type is chosen here */
        <Field label={t("Data hub type")}><select value={f.hubId || ""} onChange={set("hubId")}>{hubs.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
      ))}
      {kind === "hub" && (
        <div className="field-row">
          <DomainSelect value={f.domainId} onChange={set("domainId")} domains={domains} label={t("Data domain (inherited by everything below)")} />
        </div>
      )}
      {kind === "datahub" && (
        <>
          <div className="field-row">
            <PeopleSelect value={f.bpoId} onChange={set("bpoId")} people={people} label={t("BPO — business process owner (inherited by everything below)")} disabled={ownerLock} hint="admins only" />
            <DomainSelect value={f.domainId} onChange={set("domainId")} domains={domains} label={t("Data domain (overrides the type's domain)")} />
          </div>
          <Field label={t("Link to LeanIX (optional)")}><input className="mono" type="url" value={f.leanixUrl || ""} onChange={set("leanixUrl")} placeholder="https://company.leanix.net/…" /></Field>
        </>
      )}
      {kind === "domain" && (
        <div className="field-row">
          <PeopleSelect value={f.ownerId} onChange={set("ownerId")} people={people} label={t("Data domain owner")} disabled={ownerLock} hint="admins only" />
          <PeopleSelect value={f.stewardId} onChange={set("stewardId")} people={people} label={t("Data steward")} disabled={stewardLock} hint="admins or the owner" />
        </div>
      )}
      {kind === "schema" && (
        <div className="field-row"><DomainSelect value={f.domainId} onChange={set("domainId")} domains={domains} label={t("Data domain (overrides the inherited domain)")} /></div>
      )}
      {(kind === "database" || kind === "schema") && (
        <div className="field-row">
          <PeopleSelect value={f.ownerId} onChange={set("ownerId")} people={people} label={t("Data owner (overrides the inherited owner)")} disabled={ownerLock} hint="admins only" />
          <PeopleSelect value={f.stewardId} onChange={set("stewardId")} people={people} label={t("Data steward (overrides the inherited steward)")} disabled={stewardLock} hint="admins or the owner" />
        </div>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>{t("Cancel")}</button>
        <button className="btn btn-primary" onClick={save}>{edit ? t("Save changes") : phrase("Create")}</button>
      </div>
    </Modal>
  );
}
