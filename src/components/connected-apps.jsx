import { useState, useEffect } from "react";
import { useT } from "../i18n.jsx";
import { useToast } from "../toast-context.jsx";
import { Plug, Trash2, Loader2, ShieldCheck } from "lucide-react";
import { apiGetOr, apiDelete, errorText } from "../lib/api.js";

/* MCP clients connected via OAuth 2.1 (v1.58). `all` lists every user's connections (admins). */
export function ConnectedAppsC({ all = false, title }) {
  const { t } = useT();
  const { flash, confirm } = useToast();
  const [apps, setApps] = useState(null);
  const [limits, setLimits] = useState(null);
  const [busy, setBusy] = useState(null);
  const load = async () => {
    const j = await apiGetOr(`/oauth/apps${all ? "?all=1" : ""}`, { apps: [] }); setApps(j.apps || []); setLimits(j.limits || null);
  };
  useEffect(() => { load(); }, [all]);
  const revoke = async (a) => {
    if (!(await confirm("Disconnect {app}? Its tokens are revoked immediately; the client has to authorize again.", { app: a.clientName }, { danger: true, confirmLabel: "Disconnect" }))) return;
    setBusy(a.clientId + a.userId);
    try {
      await apiDelete(`/oauth/apps/${encodeURIComponent(a.clientId)}${all ? `?userId=${encodeURIComponent(a.userId)}` : ""}`);
      flash(t("Application disconnected")); load();
    } catch (e) { flash(errorText(e, "Could not disconnect")); }
    setBusy(null);
  };
  const active = (apps || []).filter((a) => a.active > 0), past = (apps || []).filter((a) => !a.active);
  return (
    <div data-testid="connected-apps">
      {title && <h4 style={{ margin: "14px 0 6px", display: "flex", alignItems: "center", gap: 6 }}><Plug size={14} /> {title}</h4>}
      <div className="modal-sub">{all
        ? t("MCP clients that users connected via OAuth. Each token acts as the person who authorized it and expires after an hour (refreshable for 30 days); revoking a connection ends all its tokens.")
        : t("MCP clients (Claude, IDEs, agents) that you connected via OAuth act with your permissions and are audited under your name. Disconnect a client here when you no longer use it.")}</div>
      {apps === null && <div className="modal-sub">{t("Loading…")}</div>}
      {apps !== null && !active.length && <div className="modal-sub">{t("No connected applications.")}</div>}
      {active.map((a) => (
        <div key={a.clientId + a.userId} className="role-row">
          <Plug size={13} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{a.clientName}{all && <span style={{ fontWeight: 400, color: "var(--muted)" }}> · {a.userName} ({a.userEmail})</span>}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              <span className={`chip ${a.scope?.includes("catalog:write") ? "chip-blue" : "chip-grey"}`}>{a.scope?.includes("catalog:write") ? t("read + write") : t("read")}</span>
              {" "}{t("connected")} {new Date(a.firstTs).toLocaleDateString()}{a.lastUsedTs ? ` · ${t("last used")} ${new Date(a.lastUsedTs).toLocaleString()}` : ` · ${t("never used")}`}
              {a.clientUri && <> · <span className="mono">{a.clientUri}</span></>}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm btn-danger" disabled={busy === a.clientId + a.userId} onClick={() => revoke(a)} aria-label={`${t("Disconnect")} ${a.clientName}`}>{busy === a.clientId + a.userId ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}</button>
        </div>
      ))}
      {past.length > 0 && <div className="modal-sub" style={{ marginTop: 6 }}>{past.length} {t("disconnected or expired connection(s).")}</div>}
      {all && limits && <div className="modal-sub" style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center" }}><ShieldCheck size={13} /> {t("Rate limits per credential: {n} requests and {w} write calls per minute (MCP_RATE_PER_MIN, MCP_WRITE_RATE_PER_MIN).").replace("{n}", limits.perMinute).replace("{w}", limits.writesPerMinute)}</div>}
    </div>
  );
}
