import { clickable } from "./ui.jsx";
import { useState, useEffect } from "react";
import { useT } from "../i18n.jsx";
import { Mail, MailOpen, Trash2, Store, Table2 } from "lucide-react";
import { apiGetOr, apiPost, apiDelete } from "../lib/api.js";

export function InboxViewC({ onOpenRequest, onOpenTable, refresh }) {
  const { t } = useT();
  const [msgs, setMsgs] = useState([]);
  const load = async () => { const j = await apiGetOr("/api/messages"); if (j) { setMsgs(j.messages); refresh?.(j.unread); } };
  useEffect(() => { load(); }, []);
  const markRead = async (m) => { if (m.read) return; await apiPost(`/api/messages/${m.id}/read`).catch(() => {}); load(); };
  const del = async (m) => { await apiDelete(`/api/messages/${m.id}`).catch(() => {}); load(); };
  return (
    <>
      <div className="entity-head">
        <div className="entity-icon"><Mail size={22} /></div>
        <div>
          <h1 className="entity-title">{t("Inbox")}</h1>
          <div className="entity-sub">{t("Notifications from the data product workflow, access requests and stewardship tasks. Copies go to your e-mail when SMTP is configured.")}</div>
        </div>
      </div>
      <div className="panel" style={{ padding: 10, marginTop: 16 }}>
        {!msgs.length && <div className="empty">{t("No messages yet.")}</div>}
        {msgs.map((m) => (
          <div key={m.id} className="role-row" style={{ alignItems: "flex-start", background: m.read ? "transparent" : "#FFF6E5", borderRadius: 8 }} {...clickable(() => markRead(m))}>
            {m.read ? <MailOpen size={15} style={{ color: "var(--muted)", marginTop: 3 }} /> : <Mail size={15} style={{ color: "var(--brand)", marginTop: 3 }} />}
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ fontWeight: m.read ? 500 : 700 }}>{m.subject}</div>
              <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{m.body}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{m.fromName} · {new Date(m.ts).toLocaleString()}</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {m.requestId && <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); markRead(m); onOpenRequest(); }}><Store size={13} /> {t("Open requests")}</button>}
              {m.tableId && <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); markRead(m); onOpenTable(m.tableId); }}><Table2 size={13} /> {t("Open table")}</button>}
              <button className="btn btn-ghost btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); del(m); }} aria-label={t("Delete message")}><Trash2 size={13} /></button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
