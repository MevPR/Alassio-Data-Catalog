import { useState, useEffect } from "react";
import { useT } from "../i18n.jsx";
import { useToast } from "../toast-context.jsx";
import { Bot, KeyRound, Copy, CheckCircle2, Loader2, ShieldCheck, Save, Users, Plus, Trash2 } from "lucide-react";
import { Field } from "./ui.jsx";
import { apiGetOr, apiPost, apiPut, errorText } from "../lib/api.js";
import { ROLE_LABEL, ROLE_OPTIONS, GROUP_ROLE_KEYS } from "../lib/roles.js";

/* Admins create agents by name; the MCP key is the agent's credential and is shown once */
export function InviteAgentC({ onCreated }) {
  const { t } = useT();
  const { flash } = useToast();
  const [name, setName] = useState(""); const [scope, setScope] = useState("write"); const [busy, setBusy] = useState(false); const [issued, setIssued] = useState(null);
  const create = async () => {
    setBusy(true);
    try {
      const j = await apiPost("/admin/agents", { name: name.trim(), scope });
      setIssued(j); setName(""); onCreated?.();
    } catch (e) { flash(errorText(e, "Could not create the agent")); }
    setBusy(false);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(issued.key); flash("Key copied"); } catch { flash("Copy failed — select the key and copy it manually"); } };
  return (
    <div className="panel">
      <h3><Bot size={17} /> {t("Invite Agent")}</h3>
      <div className="modal-sub">{t("Agents are technical accounts for Claude and other MCP clients — no governance role, no interactive sign-in. Only Admins create or delete them. Instead of an e-mail address the agent gets a name; instead of a password it gets an MCP key (bearer token for POST /mcp, works without 2FA).")}</div>
      <div className="field-row" style={{ alignItems: "flex-end" }}>
        <Field label={t("Agent name")}><input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. Claude Desktop – Alex")} /></Field>
        <Field label={t("Scope")}>
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="read">{t("read · browse, search, export")}</option>
            <option value="write">{t("write · read plus create / update / delete")}</option>
          </select>
        </Field>
        <button className="btn btn-primary" disabled={busy || name.trim().length < 2} onClick={create} style={{ marginBottom: 12 }}>{busy ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />} {t("Create agent & key")}</button>
      </div>
      {issued && (
        <div className="notice notice-ok" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
          <div><CheckCircle2 size={16} style={{ verticalAlign: "-3px" }} /> Agent <b>{issued.user.name}</b> created ({issued.scope} scope). This is its MCP key — copy it now, it will not be shown again:</div>
          <code className="mono" style={{ wordBreak: "break-all", background: "white", padding: "6px 8px", borderRadius: 6, userSelect: "all" }}>{issued.key}</code>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button className="btn btn-sm" onClick={copy}><Copy size={13} /> {t("Copy")}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setIssued(null)}>Done</button>
            <span className="modal-sub" style={{ margin: 0 }}>{t("Client configuration")}: URL <span className="mono">https://&lt;host&gt;/mcp</span> · {t("header")} <span className="mono">Authorization: Bearer &lt;key&gt;</span></span>
          </div>
        </div>
      )}
    </div>
  );
}

/* roles an auto-provisioned account may start with: guest first, never admin or agent */
const AUTO_PROVISION_ROLES = [...ROLE_OPTIONS.filter(([k]) => k === "guest"), ...ROLE_OPTIONS.filter(([k]) => !["guest", "admin", "agent"].includes(k))];

/* Entra ID sign-in settings (Admins only) */
export function EntraSettingsC() {
  const { t } = useT();
  const { flash } = useToast();
  const [c, setC] = useState(null); const [busy, setBusy] = useState(false);
  useEffect(() => { apiGetOr("/admin/sso").then((j) => j && setC(j)); }, []);
  if (!c) return null;
  const save = async () => {
    setBusy(true);
    try { const j = await apiPut("/admin/sso", c); flash(j.enabled ? "Entra ID sign-in enabled" : "Entra ID settings saved (sign-in disabled)"); }
    catch (e) { flash(errorText(e, "Could not save")); }
    setBusy(false);
  };
  const set = (k) => (e) => setC({ ...c, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  return (
    <div className="panel">
      <h3><ShieldCheck size={17} /> {t("Entra ID sign-in (optional)")}</h3>
      <div className="modal-sub">{t("Lets users sign in with their Microsoft work account (OpenID Connect, authorization code with PKCE). Register an app in Entra with the redirect URI")} <span className="mono">{c.redirectUri}</span>{t(", ID tokens and the scopes openid, profile, email. Entra performs MFA, so local 2FA is not asked again on this path. Accounts are matched by e-mail; without auto-provisioning, users still need an invitation first.")}</div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}><input type="checkbox" checked={!!c.enabled} onChange={set("enabled")} /> Enable "{c.buttonLabel}" on the sign-in screen</label>
      <div className="field-row">
        <Field label="Tenant ID"><input className="mono" value={c.tenantId} onChange={set("tenantId")} placeholder={t("xxxxxxxx-xxxx-…")} /></Field>
        <Field label={t("Client (application) ID")}><input className="mono" value={c.clientId} onChange={set("clientId")} /></Field>
        <Field label={c.hasSecret ? t("Client secret (stored — enter to replace)") : t("Client secret")}><input type="password" className="mono" value={c.clientSecret} onChange={set("clientSecret")} placeholder={c.hasSecret ? "••••••••" : ""} /></Field>
      </div>
      <div className="field-row">
        <Field label={t("Button label")}><input value={c.buttonLabel} onChange={set("buttonLabel")} /></Field>
        <Field label={t("Auto-provision unknown users")}>
          <select value={c.autoProvision ? "1" : "0"} onChange={(e) => setC({ ...c, autoProvision: e.target.value === "1" })}>
            <option value="0">{t("No — invitation required")}</option>
            <option value="1">{t("Yes — create the account on first sign-in")}</option>
          </select>
        </Field>
        <Field label={t("Roles for auto-provisioned users")}>
          <select value={(c.defaultRoles || ["guest"])[0]} onChange={(e) => setC({ ...c, defaultRoles: [e.target.value] })}>
            {AUTO_PROVISION_ROLES.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
          </select>
        </Field>
      </div>
      <div className="field-row">
        <Field label={t("Enforce SSO")}>
          <select value={c.enforce ? "1" : "0"} onChange={(e) => setC({ ...c, enforce: e.target.value === "1" })} disabled={!c.enabled}>
            <option value="0">{t("No — password sign-in stays available")}</option>
            <option value="1">{t("Yes — password sign-in only for break-glass accounts")}</option>
          </select>
        </Field>
        <Field label={t("Break-glass accounts (e-mails, comma-separated)")}><input value={Array.isArray(c.breakGlass) ? c.breakGlass.join(", ") : (c.breakGlass || "")} onChange={(e) => setC({ ...c, breakGlass: e.target.value })} placeholder={t("admin@company.example")} disabled={!c.enforce} /></Field>
      </div>
      <div className="modal-sub">{t("With SSO enforced, every user signs in through Entra; the break-glass accounts keep their password (and 2FA) for the case that Entra is unavailable. Your own account is added automatically if the list is empty.")}</div>
      <div className="modal-actions"><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? <Loader2 size={14} className="spin" /> : <Save size={14} />} {t("Save")}</button></div>
    </div>
  );
}

/* v1.59: group → role mapping shared by Entra ID and the header-auth mode (Databricks Apps, identity proxies);
   role labels and the role list come from src/lib/roles.js since v1.72 */
export function GroupMappingC() {
  const { t } = useT();
  const { flash } = useToast();
  const [d, setD] = useState(null); const [busy, setBusy] = useState(false);
  useEffect(() => { apiGetOr("/admin/sso/groups").then((j) => j && j.mapping && setD({ roles: GROUP_ROLE_KEYS, identity: { mode: "local", headers: null }, ...j })); }, []);
  if (!d) return null;
  const m = { rules: [], syncRoles: false, unmatched: "default", ...d.mapping };
  const setM = (patch) => setD({ ...d, mapping: { ...m, ...patch } });
  const setRule = (i, patch) => setM({ rules: m.rules.map((r, k) => (k === i ? { ...r, ...patch } : r)) });
  const toggleRole = (i, role) => { const r = m.rules[i]; setRule(i, { roles: r.roles.includes(role) ? r.roles.filter((x) => x !== role) : [...r.roles, role] }); };
  const save = async () => {
    setBusy(true);
    try { const j = await apiPut("/admin/sso/groups", m); setD({ ...d, mapping: j.mapping }); flash(t("Group mapping saved")); }
    catch (e) { flash(errorText(e, "Could not save")); }
    setBusy(false);
  };
  return (
    <div className="panel" data-testid="group-mapping">
      <h3><Users size={17} /> {t("Group → role mapping")}</h3>
      <div className="modal-sub">{t("Roles derived from identity-provider groups: Entra sends the groups claim (object ids or names — enable it in the app registration) and app roles; in header mode the proxy's groups header or the Databricks account groups are used. Rules apply to newly provisioned accounts; with \"roles follow groups\" they are re-applied on every sign-in (the last admin is never demoted).")}</div>
      <div className="modal-sub" style={{ marginBottom: 8 }}>{t("Identity mode")}: <span className="mono">{d.identity.mode}</span>{d.identity.headers && <> · {t("headers")}: <span className="mono">{d.identity.headers.email}</span>, <span className="mono">{d.identity.headers.groups}</span>{d.identity.headers.groupsFrom ? ` · ${t("groups from")} ${d.identity.headers.groupsFrom}` : ""}{d.identity.headers.secretRequired ? ` · ${t("shared secret required")}` : ""}</>}</div>
      {m.rules.map((r, i) => (
        <div key={i} className="role-row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
          <input className="mono" value={r.group} onChange={(e) => setRule(i, { group: e.target.value })} placeholder={t("group id or name")} aria-label={`${t("Group")} ${i + 1}`} style={{ minWidth: 220 }} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
            {d.roles.map((role) => <label key={role} className={`chip ${r.roles.includes(role) ? "chip-blue" : "chip-grey"}`} style={{ cursor: "pointer" }}><input type="checkbox" checked={r.roles.includes(role)} onChange={() => toggleRole(i, role)} /> {ROLE_LABEL[role] || role}</label>)}
          </div>
          <button className="btn btn-ghost btn-sm btn-danger" onClick={() => setM({ rules: m.rules.filter((_, k) => k !== i) })} aria-label={`${t("Remove rule")} ${i + 1}`}><Trash2 size={13} /></button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
        <button className="btn btn-sm" onClick={() => setM({ rules: [...m.rules, { group: "", roles: ["guest"] }] })}><Plus size={13} /> {t("Add rule")}</button>
        <label className="chip chip-grey" style={{ cursor: "pointer" }}><input type="checkbox" checked={!!m.syncRoles} onChange={(e) => setM({ syncRoles: e.target.checked })} /> {t("Roles follow groups on every sign-in")}</label>
        <select value={m.unmatched} onChange={(e) => setM({ unmatched: e.target.value })} aria-label={t("Users in no mapped group")}>
          <option value="default">{t("No matching group → default roles")}</option>
          <option value="deny">{t("No matching group → access denied")}</option>
        </select>
        <button className="btn btn-primary btn-sm" style={{ marginLeft: "auto" }} disabled={busy} onClick={save}>{busy ? <Loader2 size={14} className="spin" /> : <Save size={14} />} {t("Save")}</button>
      </div>
    </div>
  );
}
