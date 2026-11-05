import { useState, useEffect } from "react";
import { useT } from "../i18n.jsx";
import { Users, ShieldCheck } from "lucide-react";
import { WORKFLOW_ROLES, hasRole } from "../lib/roles.js";
import { apiGetOr } from "../lib/api.js";

/* Governance Overview: one box per workflow role listing the accounts that hold it (roles: src/lib/roles.js) */

export function RoleBoxesC({ onOpenUsers }) {
  const { t } = useT();
  const [users, setUsers] = useState(null);
  useEffect(() => { (async () => { const j = await apiGetOr("/admin/users"); setUsers(j ? j.users || [] : []); })(); }, []);
  const holders = (role) => (users || []).filter((u) => hasRole(u, role)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="panel">
      <h3><ShieldCheck size={17} /> Workflow roles
        {onOpenUsers && <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={onOpenUsers}><Users size={13} /> {t("Manage in User management")}</button>}
      </h3>
      <div className="stat-grid" style={{ marginTop: 8 }}>
        {WORKFLOW_ROLES.map(({ key, label: title, hint }) => {
          const list = holders(key);
          return (
            <div key={key} className="stat-card" style={{ borderTopColor: "var(--accent)" }}>
              <div className="stat-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>{title} <span className="chip chip-grey">{users === null ? "…" : list.length}</span></div>
              <div className="stat-sub" style={{ marginBottom: 8 }}>{hint}</div>
              {users === null && <div className="modal-sub">{t("Loading…")}</div>}
              {users !== null && !list.length && <div className="modal-sub">{t("No one assigned yet.")}</div>}
              {list.map((u) => (
                <div key={u.id} className="role-row" style={{ padding: "4px 0" }}>
                  <div className="avatar" style={{ width: 24, height: 24, fontSize: 11 }}>{(u.name || "?").slice(0, 1).toUpperCase()}</div>
                  <span style={{ fontWeight: 600 }}>{u.name}</span>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{u.email}</span>
                  {(u.roles || []).length > 1 && u.role !== key && <span className="chip chip-grey" title={t("Permissions follow the highest role")}>also {u.role}</span>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
