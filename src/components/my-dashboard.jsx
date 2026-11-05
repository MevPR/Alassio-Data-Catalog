import { clickable } from "./ui.jsx";
import { useState, useEffect } from "react";
import { useT } from "../i18n.jsx";
import { useCatalogData, useNav, useActions } from "../catalog-context.jsx";
import { UserCog, ShieldCheck, Users, Landmark, BookOpen, Database, Layers, Table2, Boxes, Store, MessageSquare, Send, Mail } from "lucide-react";
import { PHASE_OF, PHASES, STATUS_LABEL, waitingText, waitsForRequester } from "../lib/design-workflow.js";
import { fill } from "../lib/i18n-format.js";
import { ROLE_LABEL, rolesOf } from "../lib/roles.js";
import { CalendarClock, ClipboardCheck } from "lucide-react";
import { stewardshipTasks, DEFAULT_POLICY } from "../lib/stewardship.js";
import { CertChip, REVIEW_LABEL } from "./stewardship.jsx";
import { QuestionsSection } from "./collab.jsx";
import { apiGet, apiGetOr, apiPost, ApiError } from "../lib/api.js";

const ICON = { hub: Boxes, datahub: Boxes, domain: Landmark, database: Database, schema: Layers, table: Table2 };

/* presentational helper, module-level since v1.68 (no remount on each parent render) */
const Section = ({ icon: Icon, title, count, children }) => (
  <div className="panel" style={{ padding: 16, marginTop: 14 }}>
    <h3 style={{ margin: "0 0 10px", fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}><Icon size={16} style={{ color: "var(--accent)" }} /> {title}{count !== undefined && <span className="chip chip-grey">{count}</span>}</h3>
    {children}
  </div>
);

/* one request row (to act on / initiated) — module-level since v1.72 so it keeps its identity across renders */
const ReqRow = ({ r, mine, t, onOpenRequests }) => {
  const ph = r.kind === "design" ? PHASE_OF(r.status) : 0;
  const waiting = waitingText(r, t);
  const yours = mine && waitsForRequester(r);
  return (
    <div className="role-row edge-row" style={{ alignItems: "flex-start", flexWrap: "wrap" }} {...clickable(() => onOpenRequests())}>
      <span className="chip chip-amber">{t(STATUS_LABEL[r.status] || r.status)}</span>
      {ph > 0 && <span className="chip chip-blue">{t("Phase")} {ph} · {t(PHASES[ph - 1]?.title).replace(/^\d+ · /, "")}</span>}
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontWeight: 600 }}>{r.kind === "access" ? fill(t("Access to {product}"), { product: r.productLabel }) : fill(t("Data product \"{name}\""), { name: r.name })}{r.kind === "design" && <span style={{ fontWeight: 400, color: "var(--muted)" }}> · {r.hub}{r.project ? ` · ${t("Project")} ${r.project}` : ""}{r.useCase ? ` · ${t("Use Case")} ${r.useCase}` : ""}</span>}</div>
        {r.purpose && <div style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "pre-wrap" }}>{r.purpose.slice(0, 160)}{r.purpose.length > 160 ? "…" : ""}</div>}
        <div style={{ fontSize: 12.5, marginTop: 2 }}><b>{yours ? t("Your next step:") : t("Next step:")}</b> {waiting}</div>
        {r.reason && <div style={{ fontSize: 12, color: "var(--red)" }}>{t("Reason:")} {r.reason}</div>}
      </div>
      <span style={{ fontSize: 12, color: "var(--muted)" }}>{r.requesterName} · {new Date(r.updatedTs || r.ts).toLocaleDateString()}</span>
    </div>
  );
};

/* v1.73 (F-F8): reads the catalog contexts itself — main.jsx used to pass 14 props */
export function MyDashboardC() {
  const { me, state, catalogVersion, perm, refLabel, stewardshipPolicy: policy = DEFAULT_POLICY } = useCatalogData();
  const { openRef: onOpenRef } = useNav();
  const { refreshUnread, markReviewed, attestOwnership, openRequests, openGlossaryTerm } = useActions();
  const personIds = perm.mine;
  const onOpenTable = (id, tab) => onOpenRef({ type: "table", id, tab });
  const { t } = useT();
  const [data, setData] = useState(null);
  const [messages, setMessages] = useState([]);
  const loadMessages = async () => { const j = await apiGetOr("/api/messages"); if (j) setMessages(j.messages || []); };
  useEffect(() => { loadMessages(); }, [catalogVersion]);   /* v1.73: refetch per confirmed catalog save, not per local patch */
  const markRead = async (m) => { if (m.read) return; await apiPost(`/api/messages/${m.id}/read`).catch(() => {}); loadMessages(); refreshUnread(); };
  const markAllRead = async () => { await apiPost("/api/messages/read-all").catch(() => {}); loadMessages(); refreshUnread(); };
  const [err, setErr] = useState(null);
  useEffect(() => {
    let stop = false;
    (async () => {
      try { const j = await apiGet("/api/me/dashboard"); if (!stop) setData(j); }
      catch (e) { if (!stop) setErr(e instanceof ApiError ? `HTTP ${e.status}` : e.message); }
    })();
    return () => { stop = true; };
  }, [catalogVersion]);

  const mine = new Set([...(personIds || []), ...(data?.personIds || [])]);
  const myPeople = (state.people || []).filter((p) => mine.has(p.id));
  const assets = [];
  for (const h of state.hubs || []) for (const dh of h.dataHubs || []) if (mine.has(dh.bpoId)) assets.push({ type: "datahub", id: `${h.id}::${dh.name}`, hubId: h.id, dh: dh.name, name: `${h.name} › ${dh.name}`, roles: ["BPO"] });
  for (const d of state.databases || []) { const r = []; if (mine.has(d.ownerId)) r.push("Owner"); if (mine.has(d.stewardId)) r.push("Steward"); if (r.length) assets.push({ type: "database", id: d.id, name: refLabel({ type: "database", id: d.id }), roles: r }); }
  for (const s of state.schemas || []) { const r = []; if (mine.has(s.ownerId)) r.push("Owner"); if (mine.has(s.stewardId)) r.push("Steward"); if (r.length) assets.push({ type: "schema", id: s.id, name: refLabel({ type: "schema", id: s.id }), roles: r }); }
  for (const t of state.tables || []) { const r = []; if (mine.has(t.ownerId)) r.push("Owner"); if (mine.has(t.stewardId)) r.push("Steward"); if (r.length) assets.push({ type: "table", id: t.id, name: refLabel({ type: "table", id: t.id }), roles: r }); }
  const myDomains = (state.domains || []).filter((d) => mine.has(d.ownerId) || mine.has(d.stewardId)).map((d) => ({ ...d, roles: [mine.has(d.ownerId) && "Owner", mine.has(d.stewardId) && "Steward"].filter(Boolean) }));
  const domainsViaAssets = new Set((state.databases || []).filter((d) => assets.some((a) => (a.type === "database" && a.id === d.id))).map((d) => d.domainId).filter(Boolean));
  const tasks = stewardshipTasks(state, mine, policy);
  const myTerms = (state.glossary || []).filter((g) => mine.has(g.ownerId) || mine.has(g.stewardId) || (g.createdBy && g.createdBy.toLowerCase() === (me?.email || "").toLowerCase()));

  return (
    <>
      <div className="entity-head">
        <div className="entity-icon"><UserCog size={22} /></div>
        <div>
          <h1 className="entity-title">{t("My Dashboard")}</h1>
          <div className="entity-sub">{t("What is waiting for you, what you started, and what you are responsible for.")}</div>
        </div>
      </div>

      <Section icon={ShieldCheck} title={t("My role and assignments")}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {rolesOf(me).map((r) => <span key={r} className={r === me?.role ? "chip chip-brand" : "chip chip-blue"}>Role · {t(ROLE_LABEL[r] || r)}{(me?.roles || []).length > 1 && r === me?.role ? " (effective)" : ""}</span>)}
          {myPeople.length ? myPeople.map((p) => <span key={p.id} className="chip chip-blue"><Users size={12} /> Person record · {p.name}{p.email ? ` (${p.email})` : ""}</span>)
            : <span className="chip chip-grey">{t("No person record matches your e-mail — ask an admin to add your e-mail in Governance so ownership and stewardship apply to you")}</span>}
          {myDomains.map((d) => <span key={d.id} className="chip chip-blue"><Landmark size={12} /> {d.name} · {d.roles.join(" & ")}</span>)}
          {[...domainsViaAssets].filter((id) => !myDomains.some((d) => d.id === id)).map((id) => { const d = (state.domains || []).find((x) => x.id === id); return d ? <span key={id} className="chip chip-grey"><Landmark size={12} /> {d.name} · via assets</span> : null; })}
        </div>
      </Section>

      <Section icon={Send} title={t("Waiting for my action")} count={(data?.toAct?.length || 0) + messages.filter((m) => !m.read).length}>
        {err && <div className="notice notice-err">{err}</div>}
        {!data && !err && <div className="modal-sub">{t("Loading…")}</div>}
        {data && !data.toAct.length && !messages.filter((m) => !m.read).length && <div className="modal-sub">{t("Nothing waiting — all approvals, confirmations and messages addressed to you are done.")}</div>}
        {data?.toAct.map((r) => <ReqRow key={r.id} r={r} mine t={t} onOpenRequests={openRequests} />)}
        {messages.filter((m) => !m.read).length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0 4px" }}>
            <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}><Mail size={14} /> {t("Unread messages")} <span className="chip chip-grey">{messages.filter((m) => !m.read).length}</span></span>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={markAllRead}>{t("Mark all as read")}</button>
          </div>
        )}
        {messages.filter((m) => !m.read).map((m) => (
          <div key={m.id} className="role-row edge-row" style={{ alignItems: "flex-start", flexWrap: "wrap" }} {...clickable(() => { markRead(m); if (m.requestId) openRequests(); else if (m.tableId) onOpenTable(m.tableId); })}>
            <span className="chip chip-amber"><MessageSquare size={11} /> {m.tableId ? "task" : "message"}</span>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontWeight: 600 }}>{m.subject}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "pre-wrap" }}>{m.body.slice(0, 240)}{m.body.length > 240 ? "…" : ""}</div>
            </div>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{m.fromName} · {new Date(m.ts).toLocaleString()}</span>
            <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); markRead(m); }}>Mark read</button>
          </div>
        ))}
        {messages.filter((m) => m.read).length > 0 && <details style={{ marginTop: 8 }}><summary className="modal-sub" style={{ cursor: "pointer" }}>{messages.filter((m) => m.read).length} {t("read messages")}</summary>
          {messages.filter((m) => m.read).slice(0, 30).map((m) => <div key={m.id} className="role-row" style={{ opacity: .75 }}><span style={{ fontWeight: 600 }}>{m.subject}</span><span style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>{m.fromName} · {new Date(m.ts).toLocaleString()}</span></div>)}
        </details>}
      </Section>

      <Section icon={ShieldCheck} title={t("Stewardship tasks")} count={tasks.reviews.length + tasks.attestations.length}>
        {!tasks.reviews.length && !tasks.attestations.length && <div className="modal-sub">{t("No reviews or ownership attestations are due for your assets.")}</div>}
        {tasks.reviews.map(({ table: tb, status, nextReviewAt: next }) => (
          <div key={tb.id} className="role-row edge-row" {...clickable(() => onOpenTable(tb.id, "governance"))}>
            <span className={`chip ${status === "overdue" ? "chip-red" : "chip-amber"}`}><CalendarClock size={11} /> {t(REVIEW_LABEL[status])}</span>
            <span className="mono" style={{ fontWeight: 600 }}>{refLabel({ type: "table", id: tb.id })}</span>
            <CertChip t={tb} size={11} />
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{tb.reviewCycleDays ? `${t("every")} ${tb.reviewCycleDays} ${t("days")}` : ""}{next ? ` · ${t("due")} ${new Date(next).toLocaleDateString()}` : ""}{tb.lastReviewedBy ? ` · ${t("last")} ${tb.lastReviewedBy}` : ""}</span>
            <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={(e) => { e.stopPropagation(); markReviewed(tb.id); }}><ClipboardCheck size={13} /> {t("Mark as reviewed")}</button>
          </div>
        ))}
        {tasks.attestations.map(({ kind, obj, attestedAt }) => (
          <div key={kind + obj.id} className="role-row edge-row" {...clickable(() => onOpenRef({ type: kind, id: obj.id }))}>
            <span className="chip chip-amber"><ShieldCheck size={11} /> {attestedAt ? t("Attestation overdue") : t("Ownership never confirmed")}</span>
            <span className="chip chip-grey">{kind}</span>
            <span className="mono" style={{ fontWeight: 600 }}>{kind === "domain" ? obj.name : refLabel({ type: kind, id: obj.id })}</span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{attestedAt ? `${t("last confirmed")} ${new Date(attestedAt).toLocaleDateString()}` : ""} · {t("every")} {policy.attestDays} {t("days")}</span>
            <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={(e) => { e.stopPropagation(); attestOwnership(kind, obj.id); }}><ShieldCheck size={13} /> {t("Confirm ownership")}</button>
          </div>
        ))}
      </Section>

      <QuestionsSection Section={Section} onOpenRef={onOpenRef} />   {/* v1.71: openRef honours ref.tab itself */}

      <Section icon={Store} title={t("Initiated by me")} count={data?.initiated?.length || 0}>
        {data && !data.initiated.length && <div className="modal-sub">{t("You have not initiated any requests or data product designs yet.")}</div>}
        {data?.initiated.map((r) => <ReqRow key={r.id} r={r} t={t} onOpenRequests={openRequests} />)}
      </Section>

      <Section icon={BookOpen} title={t("My glossary terms")} count={myTerms.length}>
        {!myTerms.length && <div className="modal-sub">{t("No glossary terms created by you or assigned to you as owner or steward.")}</div>}
        {myTerms.map((g) => (
          <div key={g.id} className="role-row edge-row" {...clickable(() => openGlossaryTerm(g.id))}>
            <BookOpen size={13} /><span style={{ fontWeight: 600 }}>{g.name}</span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{(g.definition || "").slice(0, 100)}</span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>{mine.has(g.ownerId) && <span className="chip chip-amber">{t("Owner")}</span>}{mine.has(g.stewardId) && <span className="chip chip-grey">{t("Steward")}</span>}</span>
          </div>
        ))}
      </Section>

      <Section icon={Database} title={t("My data assets (owner or steward)")} count={assets.length}>
        {!assets.length && <div className="modal-sub">{t("No data hubs, databases, schemas or tables list you as owner or steward.")}</div>}
        {assets.map((a) => { const Icon = ICON[a.type] || Database; return (
          <div key={a.type + a.id} className="role-row edge-row" {...clickable(() => onOpenRef({ type: a.type, id: a.id }))}>
            <Icon size={13} /><span className="chip chip-grey">{a.type}</span><span className="mono" style={{ fontWeight: 600 }}>{a.name}</span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>{a.roles.map((r) => <span key={r} className={`chip ${r === "Owner" || r === "BPO" ? "chip-amber" : "chip-grey"}`}>{r}</span>)}</span>
          </div>
        ); })}
      </Section>
    </>
  );
}
