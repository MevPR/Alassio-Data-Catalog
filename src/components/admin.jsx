import { useState, useEffect, useRef } from "react";
import { useT } from "../i18n.jsx";
import { useToast } from "../toast-context.jsx";
import { fill } from "../lib/i18n-format.js";
import { fmtTs } from "../lib/format.js";
import { ROLE_LABEL, ROLE_OPTIONS, highestRole, roleChip, rolesOf } from "../lib/roles.js";
import { ShieldCheck, Search, Trash2, Pencil, Users, CheckCircle2, AlertTriangle, Loader2, Mail, History, RotateCcw, ChevronDown, KeyRound, Plug } from "lucide-react";
import { apiPost, apiPatch, apiDelete, apiGetOr } from "../lib/api.js";
import { AgentKeysModalC } from "./agent-keys.jsx";
import { InviteAgentC, EntraSettingsC, GroupMappingC } from "./admin-agents-sso.jsx";
import { ConnectedAppsC } from "./connected-apps.jsx";
import { Modal, Field, clickable } from "./ui.jsx";
import { initials } from "../lib/model.js";

/* multi-select dropdown: shows the chosen roles, opens a checkbox list (module-level since v1.68: a component defined
   inside the render function was a new type on every render — the open state and focus were lost on each parent update) */
function RoleSelect({ value, onChange, disabled, label }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const chosen = ROLE_OPTIONS.filter(([k]) => value.includes(k));
  return (
    <div className="menu-wrap" ref={ref} style={{ width: "100%" }}>
      <button type="button" className="btn" disabled={disabled} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label={label}
        style={{ width: "100%", justifyContent: "space-between", fontWeight: 400 }}>
        <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {chosen.length ? chosen.map(([k, l]) => <span key={k} className={`chip ${k === "admin" ? "chip-brand" : "chip-blue"}`}>{l}{chosen.length > 1 && k === highestRole(value) ? " · effective" : ""}</span>) : <span style={{ color: "var(--muted)" }}>{t("Choose roles…")}</span>}
        </span>
        <ChevronDown size={14} style={{ opacity: .7, flexShrink: 0 }} />
      </button>
      {open && (
        <div className="menu-pop" role="listbox" aria-multiselectable="true" style={{ minWidth: 300 }}>
          {ROLE_OPTIONS.map(([k, l]) => (
            <label key={k} className="menu-item" role="option" aria-selected={value.includes(k)} style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={value.includes(k)} onChange={(e) => onChange(e.target.checked ? [...value, k] : value.filter((x) => x !== k))} />
              {l}
            </label>
          ))}
          <div className="modal-sub" style={{ margin: "6px 10px 4px" }}>{t("Permissions follow the highest role:")} <b>{ROLE_LABEL[highestRole(value)] || highestRole(value)}</b></div>
        </div>
      )}
    </div>
  );
}

export function UsersViewC({ me }) {
  const { t } = useT();
  const { flash, confirm } = useToast();
  const [users, setUsers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [invEmail, setInvEmail] = useState("");
  const [invRoles, setInvRoles] = useState(["guest"]);
  const [lastInvite, setLastInvite] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const j = await apiGetOr("/admin/users");
      if (j) { setUsers(j.users || []); setInvites(j.invites || []); }
    } catch { }
  };
  useEffect(() => { load(); }, []);

  const invite = async (email = invEmail, roles = invRoles) => {
    setBusy(true); setErr(null); setLastInvite(null);
    try {
      const j = await apiPost("/admin/invite", { email, roles });
      setLastInvite({ ...j, email });
      if (email === invEmail) setInvEmail("");
      flash(j.mailed ? "Invitation e-mail sent" : "Invitation created — copy the link below");
      load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  /* v1.67: invitation tokens are stored hashed — the list has no link any more; "Renew" issues a fresh one, "Withdraw" deletes it */
  const withdraw = async (i) => {
    if (!(await confirm("Withdraw the invitation for {email}?", { email: i.email }, { danger: true, confirmLabel: "Withdraw" }))) return;
    try {
      await apiDelete(`/admin/invites/${encodeURIComponent(i.email)}`);
      flash(t("Invitation withdrawn")); load();
    } catch (e) { flash("Could not withdraw: {error}", { error: e.message }); }
  };
  /* v1.67 (pentest L9): a password-reset link for an account — valid 24 h, mailed when SMTP is configured, shown once */
  const [reset, setReset] = useState(null);
  const resetPassword = async (u) => {
    if (!(await confirm("Issue a password-reset link for {name}? The link is valid for 24 hours; the current password keeps working until a new one is set.", { name: u.name }, { confirmLabel: "Issue link" }))) return;
    setBusy(true); setErr(null);
    try { const j = await apiPost(`/admin/users/${u.id}/reset-password`, {}); setReset({ ...j, user: u }); flash(j.mailed ? t("Reset e-mail sent") : t("Reset link created — copy it below")); }
    catch (e) { flash("Could not create a reset link: {error}", { error: e.message }); }
    setBusy(false);
  };


  const [edit, setEdit] = useState(null); // { id, name, email, roles, origRoles }
  const [keysFor, setKeysFor] = useState(null);
  const saveEdit = async () => {
    setBusy(true); setErr(null);
    try {
      await apiPatch(`/admin/users/${edit.id}`, { name: edit.name, email: edit.email });
      const changed = JSON.stringify([...edit.roles].sort()) !== JSON.stringify([...(edit.origRoles || [])].sort());
      if (changed && edit.id !== me.id) {
        if (!edit.roles.length) throw new Error("A user needs at least one role");
        await apiPatch(`/admin/users/${edit.id}`, { roles: edit.roles });
      }
      flash("Account updated"); setEdit(null); load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const del = async (u) => {
    if (!(await confirm("Delete the account of {name} ({email})?", { name: u.name, email: u.email }, { danger: true }))) return;
    try {
      await apiDelete(`/admin/users/${u.id}`);
      flash("Account deleted"); load();
    } catch (e) { flash("Could not delete: {error}", { error: e.message }); }
  };


  return (
    <>
      <div className="entity-head">
        <div className="entity-icon" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}><Users size={22} /></div>
        <div>
          <h1 className="entity-title">{t("User management")}</h1>
          <div className="entity-sub">{t("Accounts, roles and invitations. A person may hold several roles — permissions always follow the highest one (Admin › Data Steward › Project Manager › Business Analyst / Data Ingestion / Development › Guest). Agent is a technical account for MCP clients — no governance role; Admins issue its keys.")}</div>
        </div>
      </div>
      <div className="gov-grid" style={{ marginTop: 20 }}>
        <div className="panel">
          <h3><Users size={17} /> {t("Accounts")}</h3>
          {users.map((u) => (
            <div key={u.id} className="role-row">
              <div className="avatar">{initials(u.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{u.name}{u.id === me.id ? " (you)" : ""}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis" }}>{u.email}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                  {rolesOf(u).map((r) => <span key={r} className={`chip ${roleChip(r)}`}>{ROLE_LABEL[r] || r}{(u.roles || []).length > 1 && r === u.role ? " (effective)" : ""}</span>)}
                  {u.sso && <span className="chip chip-grey" title={t("Signs in with Entra ID")}>Entra</span>}
                  {u.totpEnabled ? <span className="chip chip-green"><ShieldCheck size={12} /> 2FA on</span> : <span className="chip chip-grey">2FA off</span>}
                </div>
              </div>
              {rolesOf(u).includes("agent") && <button className="btn btn-sm" onClick={() => setKeysFor(u)} aria-label={fill(t("MCP keys of {name}"), { name: u.name })}><KeyRound size={13} /> {t("MCP keys")}</button>}
              {u.passwordAuth && <button className="btn btn-ghost btn-sm" onClick={() => resetPassword(u)} disabled={busy} title={t("Password-reset link")} aria-label={fill(t("Reset password of {name}"), { name: u.name })}><RotateCcw size={14} /></button>}
              <button className="btn btn-ghost btn-sm" onClick={() => { setErr(null); setEdit({ id: u.id, name: u.name, email: u.email, roles: rolesOf(u), origRoles: rolesOf(u) }); }} aria-label={fill(t("Edit {name}"), { name: u.name })}><Pencil size={14} /></button>
              <button className="btn btn-ghost btn-sm btn-danger" disabled={u.id === me.id} onClick={() => del(u)} aria-label={fill(t("Delete {name}"), { name: u.name })}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        {keysFor && <AgentKeysModalC user={keysFor} onClose={() => setKeysFor(null)} />}
        {reset && (
          <Modal title={t("Password-reset link")} sub={`${reset.user.name} (${reset.user.email})`} onClose={() => setReset(null)}>
            <div className="modal-sub">{reset.mailed ? t("The link was e-mailed. It is also shown here in case it is needed:") : `${t("E-mail was not sent")}${reset.mailError ? ` (${reset.mailError})` : ` (${t("no SMTP configured")})`} — ${t("hand this link over on a trusted channel:")}`}</div>
            <div className="secret-box" data-testid="reset-link">{reset.link}</div>
            <div className="modal-sub">{t("The link is valid for 24 hours and works once. Every session of the account ends when the new password is saved; two-factor authentication stays enabled.")}</div>
            <div className="modal-actions"><button className="btn btn-primary" onClick={() => setReset(null)}>{t("Close")}</button></div>
          </Modal>
        )}
      {edit && (
          <Modal title={t("Edit account")} sub={t("Change the display name, e-mail address and roles. The e-mail address is the sign-in name.")} onClose={() => setEdit(null)}>
            {err && <div className="notice notice-err"><AlertTriangle size={16} style={{ flexShrink: 0 }} /><span>{err}</span></div>}
            <Field label={t("Name")}><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
            <Field label={t("E-mail")}><input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label={edit.id === me.id ? t("Roles (you cannot change your own roles)") : t("Roles")}>
              <RoleSelect label={t("Roles")} value={edit.roles} disabled={edit.id === me.id} onChange={(rs) => setEdit({ ...edit, roles: rs })} />
            </Field>
            <div className="modal-actions">
              <button className="btn" onClick={() => setEdit(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveEdit} disabled={busy || !edit.name.trim() || !edit.email.trim()}>{busy ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />} Save</button>
            </div>
          </Modal>
        )}
        <div className="panel">
          <h3><Mail size={17} /> {t("Invite someone")}</h3>
          {err && <div className="notice notice-err"><AlertTriangle size={16} style={{ flexShrink: 0 }} /><span>{err}</span></div>}
          <div className="field-row">
            <Field label={t("E-mail")}><input type="email" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} placeholder={t("new.person@company.example")} /></Field>
            <Field label={t("Roles")}>
              <RoleSelect label={t("Roles for the invitation")} value={invRoles.filter((r) => r !== "agent")} onChange={(rs) => setInvRoles(rs.filter((r) => r !== "agent"))} />
              <div className="modal-sub">{t("Agents are created below under \"Invite Agent\" — by name, with a key instead of an e-mail invitation.")}</div>
            </Field>
          </div>
          <button className="btn btn-primary" onClick={invite} disabled={busy || !invEmail}>
            {busy ? <Loader2 size={15} className="spin" /> : <Mail size={15} />} {t("Send invitation")}
          </button>
          {lastInvite && (
            <div className="notice notice-ok" style={{ marginTop: 14, display: "block" }}>
              <div style={{ marginBottom: 6 }}>
                {lastInvite.mailed ? "E-mail sent. The link is also here if needed:" : `E-mail was not sent${lastInvite.mailError ? ` (${lastInvite.mailError})` : " (no SMTP configured)"} — share this link:`}
              </div>
              <div className="secret-box" style={{ marginBottom: 0 }}>{lastInvite.link}</div>
            </div>
          )}
          {invites.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{t("Open invitations")}</div>
              {invites.map((i) => (
                <div key={i.email} className="role-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{i.email}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{t("expires")} {new Date(i.expires).toLocaleDateString()} · {t("the link was shown once at creation — renew it if it got lost")}</div>
                  </div>
                  {rolesOf(i).map((r) => <span key={r} className="chip chip-grey">{ROLE_LABEL[r] || r}</span>)}
                  <button className="btn btn-ghost btn-sm" onClick={() => invite(i.email, rolesOf(i))} disabled={busy} aria-label={fill(t("Renew invitation for {email}"), { email: i.email })} title={t("New link")}><RotateCcw size={14} /></button>
                  <button className="btn btn-ghost btn-sm btn-danger" onClick={() => withdraw(i)} aria-label={fill(t("Withdraw invitation for {email}"), { email: i.email })} title={t("Withdraw")}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
        <InviteAgentC onCreated={load} />
        <EntraSettingsC />
        <GroupMappingC />
        <div className="panel">
          <h3><Plug size={17} /> {t("Connected MCP applications")}</h3>
          <div className="modal-sub">{t("OAuth 2.1 for MCP clients: a client registers itself at /oauth/register, the user consents in the browser, and the token acts as that person. Discovery: /.well-known/oauth-authorization-server.")}</div>
          <ConnectedAppsC all />
        </div>
      </div>
    </>
  );
}
const ACTION_CHIP = { created: "chip-green", updated: "chip-blue", deleted: "chip-red", invited: "chip-amber", exported: "chip-grey", imported: "chip-amber" };
const AUDIT_TYPES = ["", "hub", "database", "schema", "table", "attribute", "domain", "person", "lineage", "user", "system"];
const fmtVal = (v) => {
  if (v === null || v === undefined || v === "") return "—";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > 90 ? s.slice(0, 90) + "…" : s;
};

export function AuditEntryRow({ e, onRestore }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const restorable = onRestore && (e.after || e.before) && !["user", "system"].includes(e.entityType);
  return (
    <div className="audit-row">
      <div className="audit-head" {...clickable(() => setOpen(!open))}>
        <span className={`chip ${ACTION_CHIP[e.action] || "chip-grey"}`}>{e.action}</span>
        <span className="audit-type">{e.entityType}</span>
        <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{e.name}</span>
        {e.context && e.context !== "lineage" && <span className="audit-ctx">{e.context}</span>}
        <span className="audit-meta">{e.user?.name} · {fmtTs(e.ts)}</span>
      </div>
      {open && (
        <div className="audit-detail">
          {(e.changes || []).map((c) => (
            <div key={c.field} className="audit-change">
              <span className="audit-field">{c.field}</span>
              <span className="audit-from">{fmtVal(c.from)}</span>
              <span style={{ color: "var(--muted)" }}>→</span>
              <span className="audit-to">{fmtVal(c.to)}</span>
            </div>
          ))}
          {!e.changes?.length && e.action === "created" && <div className="audit-change" style={{ color: "var(--muted)" }}>Record created{e.after ? ` with ${Object.keys(e.after).length} fields` : ""}.</div>}
          {!e.changes?.length && e.action === "deleted" && <div className="audit-change" style={{ color: "var(--muted)" }}>{t("Record deleted.")}</div>}
          {!e.changes?.length && !["created", "deleted"].includes(e.action) && <div className="audit-change" style={{ color: "var(--muted)" }}>{t("No field details.")}</div>}
          {restorable && (
            <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => onRestore(e)}>
              <RotateCcw size={13} /> {e.action === "deleted" ? t("Restore deleted record") : t("Restore this version")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function AuditViewC() {
  const { t } = useT();
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async (before) => {
    setBusy(true);
    const p = new URLSearchParams({ limit: "150" });
    if (type) p.set("type", type);
    if (q.trim()) p.set("q", q.trim());
    if (before) p.set("before", String(before));
    const j = await apiGetOr(`/api/audit?${p}`);
    if (j) {
      setTotal(j.total);
      setEntries((prev) => before ? [...prev, ...j.entries] : j.entries);
    }
    setBusy(false);
  };
  useEffect(() => { load(); }, [type]);

  return (
    <>
      <div className="entity-head">
        <div className="entity-icon" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}><History size={22} /></div>
        <div>
          <h1 className="entity-title">{t("Audit trail")}</h1>
          <div className="entity-sub">{t("Every change to every record — who, when, and which fields. Open an entry for the field-level diff; per-object history with restore is on each object's History button.")}</div>
        </div>
        <div className="head-actions">
          <select className="btn" value={type} onChange={(e) => setType(e.target.value)} aria-label={t("Filter by type")}>
            {AUDIT_TYPES.map((t) => <option key={t} value={t}>{t ? t : "All types"}</option>)}
          </select>
          <div className="searchbox" style={{ maxWidth: 240 }}>
            <Search size={14} color="var(--muted)" />
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder={t("Name, path or user…")} aria-label={t("Search audit trail")} />
          </div>
          <button className="btn" onClick={() => load()} disabled={busy}>{busy ? <Loader2 size={15} className="spin" /> : <Search size={15} />} Search</button>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 18, padding: "6px 12px" }}>
        {entries.map((e) => <AuditEntryRow key={e.id} e={e} />)}
        {!entries.length && !busy && <div style={{ padding: 20, color: "var(--muted)" }}>{t("No audit entries yet — changes will appear here from now on.")}</div>}
      </div>
      {entries.length < total && (
        <div style={{ marginTop: 12, textAlign: "center" }}>
          <button className="btn" onClick={() => load(entries[entries.length - 1]?.ts)} disabled={busy}>
            {busy ? <Loader2 size={15} className="spin" /> : null} {t("Load older entries ({n} more)").replace("{n}", total - entries.length)}
          </button>
        </div>
      )}
    </>
  );
}

export function HistoryModalC({ scopeId, title, canEdit, onRestore, onClose }) {
  const { t } = useT();
  const [entries, setEntries] = useState(null);
  useEffect(() => {
    (async () => { const j = await apiGetOr(`/api/audit?scopeId=${encodeURIComponent(scopeId)}&limit=300`); setEntries(j ? j.entries : []); })();
  }, [scopeId]);
  return (
    <Modal wide title={`${t("History")} — ${title}`} sub={t("All recorded versions of this object and everything inside it. Restoring applies the stored snapshot and is itself recorded in the audit trail.")} onClose={onClose}>
      {entries === null && <div style={{ color: "var(--muted)", padding: 12 }}><Loader2 size={15} className="spin" style={{ verticalAlign: "-3px" }} /> {t("Loading history…")}</div>}
      {entries?.length === 0 && <div style={{ color: "var(--muted)", padding: 12 }}>{t("No recorded changes for this object yet — history starts with the next change.")}</div>}
      {entries?.map((e) => <AuditEntryRow key={e.id} e={e} onRestore={canEdit ? ((x) => { onRestore(x); onClose(); }) : undefined} />)}
    </Modal>
  );
}
