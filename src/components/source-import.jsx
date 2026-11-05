import { useState, useEffect } from "react";
import { useT } from "../i18n.jsx";
import { Database, Plug, CheckCircle2, AlertTriangle, Loader2, Server, Info } from "lucide-react";
import { LAYERS, sourceLabel } from "../lib/model.js";
import { apiPost, apiGetOr } from "../lib/api.js";
import { SOURCE_TYPES, INSPECTOR_KINDS, visibleSourceTypes, initialForm, effectiveName, typeForRef, formFromRef } from "../lib/source-types.js";
import { Modal, Field } from "./ui.jsx";

const readFileText = (file) => new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result)); rd.onerror = () => rej(new Error(`could not read ${file.name}`)); rd.readAsText(file); });
/* upload connectors keep File objects in their body — hand the server their text instead */
const withFileText = async (body) => Object.fromEntries(await Promise.all(Object.entries(body).map(async ([k, v]) =>
  [k, v instanceof File ? await readFileText(v) : Array.isArray(v) && v[0] instanceof File ? await Promise.all(v.map(readFileText)) : v])));

/* v1.70: renders one registry entry's declarative `ui` spec (see source-types.js). One item = one of
   notice | sub | row | when | check | select | textarea | file | input; `set(key, value)` writes the form. */
function SpecFields({ items, form, set, t }) {
  const on = (key) => (e) => set(key, e.target.value);
  const render = (it, i) => {
    if (it.when) return it.when(form) ? it.items.map(render) : null;
    if (it.row) return <div key={i} className="field-row">{it.row.map(render)}</div>;
    if (it.notice) return <div key={i} className="notice notice-ok" style={{ marginBottom: 10 }}><CheckCircle2 size={16} /><span>{t(it.notice)}</span></div>;
    if (it.sub) return <div key={i} className="modal-sub">{t(it.sub)}</div>;
    if (it.check) return (
      <label key={i} className="check" style={{ marginBottom: 10 }}>
        <input type="checkbox" checked={it.invert ? !form[it.check] : form[it.check]} onChange={(e) => set(it.check, it.invert ? !e.target.checked : e.target.checked)} />
        {t(it.label)}
      </label>
    );
    if (it.select) return (
      <Field key={i} label={t(it.label)}>
        <select value={form[it.select]} onChange={on(it.select)}>{it.options.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select>
      </Field>
    );
    if (it.textarea) return <Field key={i} label={t(it.label)}><textarea className="mono" rows={it.rows} value={form[it.textarea]} onChange={on(it.textarea)} style={{ width: "100%" }} placeholder={it.placeholder} /></Field>;
    if (it.file) return (
      <Field key={i} label={t(it.label)}>
        <input type="file" multiple={it.multiple || undefined} aria-label={t(it.aria)} accept={it.accept} onChange={(e) => set(it.file, it.multiple ? [...(e.target.files || [])] : e.target.files?.[0] || null)} />
      </Field>
    );
    return (
      <Field key={i} label={t(it.label)}>
        <input className="mono" type={it.password ? "password" : undefined} aria-label={it.aria && t(it.aria)} value={form[it.input]} onChange={on(it.input)} placeholder={it.placeholder && t(it.placeholder)} />
      </Field>
    );
  };
  return items.map(render);
}

export function SourceModalC({ hubs = [], sources = [], onClose, onImport, onImportBundle, capabilities: capsProp }) {
  const { t } = useT();
  const [caps, setCaps] = useState(capsProp || null);
  useEffect(() => {
    if (capsProp) return;
    let alive = true;
    (async () => { const j = await apiGetOr("/api/source-import/capabilities"); /* unknown → show everything */ if (alive && j && typeof j.inspector === "boolean") setCaps(j); })();
    return () => { alive = false; };
  }, [capsProp]);
  const TYPES = visibleSourceTypes(caps);
  const [typeSel, setType] = useState(Object.keys(SOURCE_TYPES)[0]);
  const type = TYPES[typeSel] ? typeSel : Object.keys(TYPES)[0];   /* a hidden selection falls back to the first visible type */
  /* v1.70: one form object (the union of every connector's fields) instead of one useState per field — switching the
     source system keeps what was typed, as before */
  const [form, setForm] = useState(initialForm);
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const [hubId, setHubId] = useState("source"); const [layer, setLayer] = useState("");
  const [country, setCountry] = useState("GLOBAL");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const T = SOURCE_TYPES[type];
  const needsInspector = INSPECTOR_KINDS.includes(T.kind);
  const effName = effectiveName(T, form);
  const isBundle = !!T.bundle;
  const canLoad = T.isValid(form) && (isBundle || !!effName);
  const hubLabel = hubId === "source" ? "SOURCE" : hubs.find((h) => h.id === hubId)?.name || "SOURCE";

  /* one load path for every connector: single database (onImport), bundle (Power BI → several databases + lineage,
     applied on the server) or upload bundle (dbt / data contracts, parsed on the server since v1.66) */
  const load = async () => {
    setBusy(true); setStatus(null);
    try {
      const body = T.toBody(form);
      if (T.upload) {
        await onImportBundle({ hubId, country, layer, server: { ...await withFileText(body), type } });
      } else {
        const j = await apiPost("/api/source-import/inspect", body);
        const ref = T.toRef(form);
        if (isBundle) {
          await onImportBundle({ hubId, country, layer, sourceType: T.system, databases: j.databases || [], lineage: j.lineage || [], sourceRef: ref });
        } else {
          if (j.skipped?.length) setStatus({ type: "ok", msg: `${j.skipped.length} object(s) skipped: ${j.skipped.slice(0, 3).join("; ")}${j.skipped.length > 3 ? " …" : ""}` });
          await onImport(effName || "SOURCE_DB", T.system, j.schemas, country, { ...ref, name: effName || "SOURCE_DB" });
        }
      }
    } catch (e) { setStatus({ type: "err", msg: `Could not load: ${e.message}` }); }
    setBusy(false);
  };

  const restore = (r) => { setType(typeForRef(r)); setStatus(null); setForm((prev) => ({ ...prev, ...formFromRef(r) })); };

  return (
    <Modal title={t("Load generic data source")} sub={t("Admins only: introspects source systems (databases, files, APIs) or reads metadata files and loads them into the catalog. Read-only — these sources have no write-back.")} onClose={onClose}>
      {sources.length > 0 && (
        <Field label={t("Previously used sources")}>
          <select value="" onChange={(e) => { const r = sources[Number(e.target.value)]; if (r) restore(r); }}>
            <option value="">{t("— pick a source used before (passwords are never stored) —")}</option>
            {sources.map((r, i) => <option key={i} value={i}>{sourceLabel(r)}{r.name ? ` → ${r.name}` : ""}</option>)}
          </select>
        </Field>
      )}
      <Field label={t("Source system")}>
        <select value={type} onChange={(e) => { setType(e.target.value); setStatus(null); }}>
          {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{t(v.label)}</option>)}
        </select>
      </Field>
      {caps && caps.inspector === false && (
        <div className="notice" style={{ marginBottom: 10 }}><Info size={16} /><span>{t("This installation runs without the source inspector service: database introspection (DuckDB, lake files, SQL dialects, JDBC) is not offered. APIs (OData, SuccessFactors, Kafka Schema Registry, Power BI, Informatica), dbt, data contracts, CSV and Unity Catalog work as usual — register databases in Unity Catalog (Lakehouse Federation) and load them with the Unity Catalog sync.")}</span></div>
      )}
      {caps && caps.inspector && caps.inspectorReachable === false && needsInspector && (
        <div className="notice notice-warn" style={{ marginBottom: 10 }}><Info size={16} /><span>{t("The source inspector service is configured but currently not reachable — check: systemctl status datahub-catalog-inspector")}</span></div>
      )}
      <SpecFields items={T.ui} form={form} set={set} t={t} />
      <div className="field-row">
        {!isBundle && <Field label={t("Name in the catalog")}><input className="mono" value={form.dbName} onChange={(e) => set("dbName", e.target.value)} placeholder={form.database || T.defaultName(form) || "e.g. DB2_CLAIMS"} /></Field>}
        {isBundle && (
          <Field label={t("Import into data hub")}>
            <select value={hubId} onChange={(e) => setHubId(e.target.value)}>
              <option value="source">{t("SOURCE (layer Other)")}</option>
              {hubs.filter((h) => h.name?.trim().toUpperCase() !== "SOURCE").map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </Field>
        )}
        <Field label={t("Data hub (free text, e.g. SALES_DE)")}><input className="mono" value={country} onChange={(e) => setCountry(e.target.value)} maxLength={64} placeholder={t("e.g. SOURCE_SAP")} /></Field>
        {isBundle && hubId !== "source" ? (
          <Field label={t("Medallion layer")}>
            <select value={layer} onChange={(e) => setLayer(e.target.value)}>
              <option value="">{t("Guess from catalog name")}</option>
              {LAYERS.map((l) => <option key={l} value={l}>{l[0].toUpperCase() + l.slice(1)}</option>)}
            </select>
          </Field>
        ) : (
          <Field label={t("Medallion layer (SOURCE hub: fixed to Other)")}>
            <select value="other" disabled><option value="other">{t("Other")}</option></select>
          </Field>
        )}
      </div>
      {status && <div className={`notice ${status.type === "ok" ? "notice-ok" : "notice-err"}`}>{status.type === "ok" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} style={{ flexShrink: 0 }} />}<span>{status.msg}</span></div>}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>{t("Cancel")}</button>
        <button className="btn btn-primary" onClick={load} disabled={busy || !canLoad}>
          {busy ? <Loader2 size={15} className="spin" /> : <Server size={15} />} {isBundle ? `Load into ${hubLabel} hub` : t("Load into SOURCE hub")}
        </button>
      </div>
    </Modal>
  );
}

/* Unity Catalog import (v1.66): runs on the server with a sync profile's credentials (or a one-off connection whose
   token never leaves the server after the request) — the browser only picks the catalog and the target, then watches
   the job. "Save as sync profile" keeps the connection for scheduled runs. */
/* v1.73 (F-F6): the connection and target fields are one `form` object (they were 13 useState slots); choosing a
   sync profile copies its target settings in the same update — no effect watching profileId any more */
const unityForm = (hubs) => ({ profileId: "", host: "", authType: "pat", token: "", clientId: "", clientSecret: "", warehouse: "",
  hubId: hubs.some((h) => h.id === "central") ? "central" : (hubs[0]?.id || "central"), country: "GLOBAL", layer: "", withLineage: true, withTags: true, saveAs: "" });
const withProfile = (f, p) => (p ? { ...f, profileId: p.id, hubId: p.hubId || "central", country: p.country || "GLOBAL", layer: p.layer || "", withLineage: !!p.lineage, withTags: p.importTags !== false } : { ...f, profileId: "" });

export function UnityModalC({ hubs, onClose, onStarted }) {
  const { t } = useT();
  const [profiles, setProfiles] = useState([]);
  useEffect(() => { apiGetOr("/admin/sync/profiles").then((j) => { if (j?.profiles) setProfiles(j.profiles); }); }, []);
  const [form, setForm] = useState(() => unityForm(hubs));
  const set = (k) => (e) => { const v = e.target.type === "checkbox" ? e.target.checked : e.target.value; setForm((f) => ({ ...f, [k]: v })); };
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [catalogs, setCatalogs] = useState(null);
  const { profileId, host, authType, token, clientId, clientSecret, warehouse, hubId, country, layer, withLineage, withTags, saveAs } = form;
  const prof = profiles.find((p) => p.id === profileId) || null;
  const chooseProfile = (id) => { setForm((f) => withProfile(f, profiles.find((p) => p.id === id))); setCatalogs(null); setStatus(null); };
  const conn = () => prof ? { profileId } : { host: host.trim(), auth: authType === "pat" ? { type: "pat", token } : authType === "sp" ? { type: "sp", clientId: clientId.trim(), clientSecret } : { type: "app" }, warehouseId: warehouse.trim() };
  const canConnect = prof || (authType === "app" || (host.trim() && (authType === "pat" ? token.trim() : clientId.trim() && clientSecret)));
  const connect = async () => {
    setBusy(true); setStatus(null); setCatalogs(null);
    try {
      const j = await apiPost("/api/import/unity/catalogs", conn());
      setCatalogs(j.catalogs || []);
      setStatus({ type: "ok", msg: `${t("Connected")} — ${(j.catalogs || []).length} ${t("catalogs found")}.` });
    } catch (e) { setStatus({ type: "err", msg: `${t("Could not reach the workspace")} (${e.message}).` }); }
    setBusy(false);
  };
  const start = async (catName) => {
    setBusy(true); setStatus(null);
    try {
      const body = { ...conn(), catalog: catName, hubId, country, layer, lineage: withLineage, importTags: withTags, ...(saveAs.trim() && !prof ? { saveProfile: { name: saveAs.trim() } } : {}) };
      const j = await apiPost("/api/import/unity", body);
      onStarted(j.job, catName);
    } catch (e) { setStatus({ type: "err", msg: `${t("Import failed")}: ${e.message}` }); setBusy(false); }
  };
  return (
    <Modal title={t("Connect Unity Catalog")} sub={t("Imports catalogs, schemas, tables, columns, lineage and governance tags from a Databricks workspace into a data hub. The import runs on the server — with a sync profile's credentials or a one-off connection whose token is used for this import only.")} onClose={onClose}>
      {profiles.length > 0 && (
        <Field label={t("Sync profile")}>
          <select value={profileId} onChange={(e) => chooseProfile(e.target.value)}>
            <option value="">{t("— one-off connection (enter the workspace below) —")}</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.auth?.type === "app" ? t("app identity") : p.host} · {p.catalog}</option>)}
          </select>
        </Field>
      )}
      {!prof && (
        <>
          <div className="field-row">
            <Field label={t("Workspace URL")}><input className="mono" value={host} onChange={set("host")} placeholder="https://adb-1234567890.12.azuredatabricks.net" disabled={authType === "app"} /></Field>
            <Field label={t("Authentication")}>
              <select value={authType} onChange={set("authType")}>
                <option value="pat">{t("Personal access token")}</option><option value="sp">{t("Service principal")}</option><option value="app">{t("App identity (Databricks Apps)")}</option>
              </select>
            </Field>
          </div>
          <div className="field-row">
            {authType === "pat" && <Field label={t("Personal access token")}><input className="mono" type="password" value={token} onChange={set("token")} placeholder={t("dapiXXXXXXXX")} /></Field>}
            {authType === "sp" && <><Field label={t("Client ID")}><input className="mono" value={clientId} onChange={set("clientId")} /></Field><Field label={t("Client secret")}><input className="mono" type="password" value={clientSecret} onChange={set("clientSecret")} /></Field></>}
            <Field label={t("SQL warehouse ID (optional — imports governance tags)")}><input className="mono" value={warehouse} onChange={set("warehouse")} placeholder={t("ab12cd34ef56gh78")} /></Field>
          </div>
        </>
      )}
      <div className="field-row">
        <Field label={t("Import into data hub")}>
          <select value={hubId} onChange={set("hubId")}>
            {hubs.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </Field>
        <Field label={t("Data hub (free text, e.g. SALES_DE)")}>
          <input className="mono" value={country} onChange={set("country")} maxLength={16} />
        </Field>
        <Field label={t("Medallion layer")}>
          <select value={layer} onChange={set("layer")}>
            <option value="">{t("Guess from catalog name")}</option>
            {LAYERS.map((l) => <option key={l} value={l}>{l[0].toUpperCase() + l.slice(1)}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
        <label className="check"><input type="checkbox" checked={withLineage} onChange={set("withLineage")} /> {t("Also import table lineage (bronze → silver → gold)")}</label>
        <label className="check"><input type="checkbox" checked={withTags} onChange={set("withTags")} /> {t("Import governance tags (needs the SQL warehouse ID)")}</label>
      </div>
      {!prof && <Field label={t("Save as sync profile (optional — name)")}><input value={saveAs} onChange={set("saveAs")} placeholder={t("e.g. Sales gold — manual schedule, run from Admin › Backups & jobs")} /></Field>}
      {status && (
        <div className={`notice ${status.type === "ok" ? "notice-ok" : "notice-err"}`}>
          {status.type === "ok" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} style={{ flexShrink: 0 }} />}
          <span>{status.msg}</span>
        </div>
      )}
      {catalogs && (
        <Field label={t("Choose a catalog to import")}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {catalogs.map((c) => (
              <button key={c.name} className="btn" style={{ justifyContent: "flex-start" }} onClick={() => start(c.name)} disabled={busy}>
                <Database size={14} /> <span className="mono">{c.name}</span>
                <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 12 }}>{c.comment || ""}</span>
              </button>
            ))}
            {!catalogs.length && <span className="modal-sub">{t("No catalogs visible for this connection.")}</span>}
          </div>
        </Field>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>{t("Close")}</button>
        <button className="btn btn-primary" onClick={connect} disabled={busy || !canConnect}>{busy ? <Loader2 size={14} className="spin" /> : <Plug size={14} />} {t("Connect")}</button>
      </div>
    </Modal>
  );
}
