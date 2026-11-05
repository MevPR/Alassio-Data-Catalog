import { useState, useEffect } from "react";
import { useT } from "../i18n.jsx";
import { useToast } from "../toast-context.jsx";
import { fill } from "../lib/i18n-format.js";
import { KeyRound, Plus, Trash2, Copy, CheckCircle2, Loader2 } from "lucide-react";
import { Modal, Field } from "./ui.jsx";
import { apiGetOr, apiPost, apiDelete, errorText } from "../lib/api.js";

/* MCP access keys for accounts with the role Agent.
   `base` = "/admin/users/<id>/keys" (admin managing an agent) or "/auth/me/keys" (agent self-service);
   revoke endpoint differs: admin → DELETE /admin/keys/<keyId>, self → DELETE /auth/me/keys/<keyId>. */
export function AgentKeysC({ base, revokeBase, title }) {
  const { t, tn } = useT();
  const { flash, confirm } = useToast();
  const [keys, setKeys] = useState(null);
  const [name, setName] = useState("Claude Desktop");
  const [scope, setScope] = useState("write");
  const [issued, setIssued] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => { const j = await apiGetOr(base); setKeys(j ? j.keys : []); };
  useEffect(() => { load(); }, [base]);
  const issue = async () => {
    setBusy(true);
    try {
      const j = await apiPost(base, { name, scope });
      setIssued(j.key); load();
    } catch (e) { flash(errorText(e, "Could not issue the key")); }
    setBusy(false);
  };
  const revoke = async (k) => {
    if (!(await confirm("Revoke key \"{name}\" ({prefix}…)? MCP clients using it lose access immediately.", { name: k.name, prefix: k.prefix }, { danger: true, confirmLabel: "Revoke" }))) return;
    try { await apiDelete(`${revokeBase}/${k.id}`); } catch { flash("Could not revoke the key"); return; }
    flash("Key revoked"); load();
  };
  const copy = async () => { try { await navigator.clipboard.writeText(issued); flash("Key copied to the clipboard"); } catch { flash("Copy failed — select the key and copy it manually"); } };
  const active = (keys || []).filter((k) => !k.revokedTs), revoked = (keys || []).filter((k) => k.revokedTs);
  return (
    <div>
      {title && <h4 style={{ margin: "14px 0 6px", display: "flex", alignItems: "center", gap: 6 }}><KeyRound size={14} /> {title}</h4>}
      <div className="modal-sub">{t("Keys connect MCP clients (Claude, other agents) to")} <span className="mono">POST /mcp</span> {t("as this account — as bearer token, without a session and without 2FA. A key is shown once; revoke it here when a client is retired.")}</div>
      {issued && (
        <div className="notice notice-ok" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
          <div><CheckCircle2 size={16} style={{ verticalAlign: "-3px" }} /> {t("New key — copy it now, it will not be shown again:")}</div>
          <code className="mono" style={{ wordBreak: "break-all", background: "white", padding: "6px 8px", borderRadius: 6, userSelect: "all" }}>{issued}</code>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-sm" onClick={copy}><Copy size={13} /> {t("Copy")}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setIssued(null)}>Done</button>
          </div>
        </div>
      )}
      <div className="field-row" style={{ alignItems: "flex-end", marginBottom: 6 }}>
        <Field label={t("Key name (which client uses it)")}><input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. Claude Desktop, n8n")} /></Field>
        <Field label={t("Scope")}><select value={scope} onChange={(e) => setScope(e.target.value)}><option value="read">{t("read")}</option><option value="write">{t("write")}</option></select></Field>
        <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={issue} style={{ marginBottom: 12 }}>{busy ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} {t("Generate key")}</button>
      </div>
      {keys === null && <div className="modal-sub">{t("Loading…")}</div>}
      {keys !== null && !active.length && <div className="modal-sub">{t("No active keys.")}</div>}
      {active.map((k) => (
        <div key={k.id} className="role-row">
          <KeyRound size={13} /><span className="mono">{k.prefix}…</span><span style={{ fontWeight: 600 }}>{k.name}</span><span className={`chip ${k.scope === "read" ? "chip-grey" : "chip-blue"}`}>{k.scope || "write"}</span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{fill(t("issued {date} by {who}"), { date: new Date(k.createdTs).toLocaleDateString(), who: k.createdBy })} · {k.lastUsedTs ? fill(t("last used {when}"), { when: new Date(k.lastUsedTs).toLocaleString() }) : t("never used")}</span>
          <button className="btn btn-ghost btn-sm btn-danger" style={{ marginLeft: "auto" }} onClick={() => revoke(k)} aria-label={fill(t("Revoke {name}"), { name: k.name })}><Trash2 size={13} /></button>
        </div>
      ))}
      {revoked.length > 0 && <div className="modal-sub" style={{ marginTop: 6 }}>{tn(["{n} revoked key.", "{n} revoked keys."], revoked.length)}</div>}
    </div>
  );
}

export function AgentKeysModalC({ user, onClose }) {
  const { t } = useT();
  return (
    <Modal title={`${t("MCP keys")} — ${user.name}`} sub={t("Agent account: keys for Claude and other MCP clients.")} onClose={onClose}>
      <AgentKeysC base={`/admin/users/${user.id}/keys`} revokeBase="/admin/keys" />
      <div className="modal-sub" style={{ marginTop: 10 }}>{t("Client configuration")}: URL <span className="mono">https://&lt;host&gt;/mcp</span>, {t("header")} <span className="mono">Authorization: Bearer &lt;key&gt;</span>. {t("Agent keys grant the same catalog actions as the MCP server (no user management).")}</div>
      <div className="modal-actions"><button className="btn btn-primary" onClick={onClose}>{t("Close")}</button></div>
    </Modal>
  );
}
