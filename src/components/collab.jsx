import { clickable } from "./ui.jsx";
import { useState, useEffect, useCallback } from "react";
import { useT } from "../i18n.jsx";
import { useToast } from "../toast-context.jsx";
import { api } from "../lib/api.js";
import { Star, MessageSquare, HelpCircle, CheckCircle2, Reply, Pencil, Trash2, Loader2, Eye, Download, BarChart3, Search } from "lucide-react";

/* Collaboration (v1.58): discussion threads, star ratings and usage statistics per catalog object. */

/* The collaboration record of one object — comments, rating, usage — loaded once (v1.73, F-F13: the header stars, the
   usage line and the Discussion tab used to fetch it separately and synced ratings through a window event). The
   owner of the page calls useCollab() and passes the result down; rate(n) stores the user's rating and updates the
   shared record, so every widget fed from it shows the same stars. type/id null = no record (nothing is fetched). */
export function useCollab(type, id) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const reload = useCallback(async () => {
    if (!type || !id) return;
    try { const j = await api(`/api/collab/${type}/${encodeURIComponent(id)}`); setData({ comments: Array.isArray(j?.comments) ? j.comments : [], rating: j?.rating || null, usage: j?.usage || null }); setErr(null); } catch (e) { setErr(e.message); }
  }, [type, id]);
  useEffect(() => { setData(null); reload(); }, [reload]);
  /* click the same star again to remove the rating */
  const rate = async (n) => {
    try {
      const j = await api(`/api/collab/${type}/${encodeURIComponent(id)}/rating`, { method: "PUT", body: { stars: data?.rating?.mine === n ? null : n } });
      setData((d) => ({ comments: [], usage: null, ...d, rating: j.rating }));
    } catch { }
  };
  return { data, err, reload, setData, rate };
}

/* ★★★★☆ 4.2 (7) — presentational: `rating` ({ avg, count, mine }) and `onRate(n)` come from useCollab() */
export function RatingStars({ rating, onRate, size = 15, compact = false }) {
  const { t } = useT();
  const [hover, setHover] = useState(0);
  const shown = hover || rating?.mine || 0, avg = rating?.avg;
  return (
    <span className="rating" role="group" aria-label={t("Rating")} data-testid="rating" style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 12, color: "var(--muted)", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 400 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" className="star-btn" aria-label={`${n} ${t("stars")}`} aria-pressed={rating?.mine === n} title={rating?.mine === n ? t("Remove my rating") : `${n} ${t("stars")}`}
          onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)} onClick={() => onRate?.(n)}
          style={{ background: "none", border: 0, padding: 1, cursor: "pointer", color: n <= shown ? "var(--amber)" : n <= Math.round(avg || 0) ? "#E2C46A" : "var(--line)", lineHeight: 0 }}>
          <Star size={size} fill={n <= shown || n <= Math.round(avg || 0) ? "currentColor" : "none"} />
        </button>
      ))}
      {!compact && <span style={{ marginLeft: 4 }}>{avg != null ? `${avg.toFixed(1)} (${rating.count})` : t("no ratings yet")}</span>}
    </span>
  );
}

export function UsageLine({ usage }) {
  const { t } = useT();
  if (!usage) return null;
  return (
    <span style={{ display: "inline-flex", gap: 10, flexWrap: "wrap", fontSize: 12.5, color: "var(--muted)", alignItems: "center" }}>
      <span title={t("Views in the last 30 / 90 days")}><Eye size={12} style={{ verticalAlign: "-2px" }} /> {usage.views30} / {usage.views90} {t("views")} · {usage.viewers90} {t("people")}</span>
      <span><Download size={12} style={{ verticalAlign: "-2px" }} /> {usage.exports} {t("exports")}</span>
      <span>{usage.lastViewedAt ? `${t("last viewed")} ${new Date(usage.lastViewedAt).toLocaleString()}` : t("not viewed yet")}</span>
    </span>
  );
}


const Body = ({ text }) => <div style={{ whiteSpace: "pre-wrap", fontSize: 13.5, lineHeight: 1.5 }}>{text}</div>;

/* the Discussion tab; `collab` is the page's useCollab() record (the header stars share it) — without it the panel
   loads its own */
export function CollabPanel({ type, id, collab = null, me, isAdmin = false, isSteward = false }) {
  const { t } = useT();
  const { flash, confirm } = useToast();
  const own = useCollab(collab ? null : type, collab ? null : id);
  const { data, err, reload, rate } = collab || own;
  const [body, setBody] = useState("");
  const [kind, setKind] = useState("comment");
  const [replyTo, setReplyTo] = useState(null);
  const [replyBody, setReplyBody] = useState("");
  const [editing, setEditing] = useState(null);
  const [editBody, setEditBody] = useState("");
  const [busy, setBusy] = useState(false);
  const myEmail = String(me?.email || "").toLowerCase();
  const post = async (text, k, parentId = null) => {
    setBusy(true);
    try {
      const j = await api(`/api/collab/${type}/${encodeURIComponent(id)}/comments`, { method: "POST", body: { body: text, kind: k, parentId } });
      if (j.comment.kind === "question") flash(j.notified ? t("Question posted — steward and owner were notified") : t("Question posted"));
      setBody(""); setReplyBody(""); setReplyTo(null); await reload();
    } catch (e) { flash(e.message); }
    setBusy(false);
  };
  const resolve = async (c, resolved) => { try { await api(`/api/collab/comments/${c.id}/resolve`, { method: "POST", body: { resolved } }); reload(); } catch (e) { flash(e.message); } };
  const remove = async (c) => { if (!(await confirm("Delete this comment?", null, { danger: true }))) return; try { await api(`/api/collab/comments/${c.id}`, { method: "DELETE" }); reload(); } catch (e) { flash(e.message); } };
  const saveEdit = async () => { try { await api(`/api/collab/comments/${editing}`, { method: "PATCH", body: { body: editBody } }); setEditing(null); reload(); } catch (e) { flash(e.message); } };
  const mayEdit = (c) => c.by.email === myEmail || isAdmin;
  const mayResolve = (c) => c.by.email === myEmail || isAdmin || isSteward;
  const threads = data?.comments || [];
  const open = threads.filter((c) => c.kind === "question" && !c.resolvedTs).length;

  return (
    <div data-testid="collab-panel">
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <RatingStars rating={data?.rating} onRate={rate} />
        <UsageLine usage={data?.usage} />
      </div>
      {err && <div className="notice notice-err"><span>{err}</span></div>}
      <div className="panel" style={{ padding: 14, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
          <label className="chip chip-grey" style={{ cursor: "pointer" }}><input type="radio" name="collab-kind" checked={kind === "comment"} onChange={() => setKind("comment")} /> <MessageSquare size={11} /> {t("Comment")}</label>
          <label className="chip chip-amber" style={{ cursor: "pointer" }}><input type="radio" name="collab-kind" checked={kind === "question"} onChange={() => setKind("question")} /> <HelpCircle size={11} /> {t("Question")}</label>
          <span className="modal-sub" style={{ margin: "0 0 0 auto" }}>{kind === "question" ? t("Questions notify the data steward and owner and stay open until resolved.") : t("Visible to everyone who can see this object.")}</span>
        </div>
        <textarea aria-label={kind === "question" ? t("Your question") : t("Your comment")} value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={4000} placeholder={kind === "question" ? t("What would you like to know about this object?") : t("Add context, caveats, tips for other users…")} style={{ width: "100%", boxSizing: "border-box" }} />
        <div className="modal-actions" style={{ marginTop: 8 }}>
          <button className="btn btn-primary btn-sm" disabled={busy || !body.trim()} onClick={() => post(body, kind)}>{busy ? <Loader2 size={13} className="spin" /> : kind === "question" ? <HelpCircle size={13} /> : <MessageSquare size={13} />} {kind === "question" ? t("Ask question") : t("Post comment")}</button>
        </div>
      </div>
      {data && !threads.length && <div className="modal-sub">{t("No comments or questions yet — be the first.")}</div>}
      {open > 0 && <div className="modal-sub" style={{ marginBottom: 6 }}>{open} {t("open question(s)")}</div>}
      {threads.map((c) => (
        <div key={c.id} className="role-row" style={{ alignItems: "flex-start", flexDirection: "column", gap: 4 }} data-testid={`thread-${c.kind}`}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", width: "100%" }}>
            {c.kind === "question" ? <span className={`chip ${c.resolvedTs ? "chip-green" : "chip-amber"}`}>{c.resolvedTs ? <CheckCircle2 size={11} /> : <HelpCircle size={11} />} {c.resolvedTs ? t("Resolved") : t("Open question")}</span> : <span className="chip chip-grey"><MessageSquare size={11} /> {t("Comment")}</span>}
            <span style={{ fontWeight: 600 }}>{c.by.name}</span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{new Date(c.ts).toLocaleString()}{c.editedTs ? ` · ${t("edited")}` : ""}{c.resolvedTs ? ` · ${t("resolved by")} ${c.resolvedBy}` : ""}</span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setReplyTo(replyTo === c.id ? null : c.id); setReplyBody(""); }} aria-label={t("Reply")} title={t("Reply")}><Reply size={13} /></button>
              {c.kind === "question" && mayResolve(c) && <button className="btn btn-ghost btn-sm" onClick={() => resolve(c, !c.resolvedTs)} title={c.resolvedTs ? t("Reopen") : t("Mark as resolved")}>{c.resolvedTs ? t("Reopen") : <><CheckCircle2 size={13} /> {t("Resolve")}</>}</button>}
              {mayEdit(c) && <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(c.id); setEditBody(c.body); }} aria-label={t("Edit")} title={t("Edit")}><Pencil size={13} /></button>}
              {mayEdit(c) && <button className="btn btn-ghost btn-sm btn-danger" onClick={() => remove(c)} aria-label={t("Delete")} title={t("Delete")}><Trash2 size={13} /></button>}
            </span>
          </div>
          {editing === c.id ? <div style={{ width: "100%" }}><textarea aria-label={t("Edit comment")} value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={3} style={{ width: "100%", boxSizing: "border-box" }} /><div className="modal-actions" style={{ marginTop: 6 }}><button className="btn btn-sm" onClick={() => setEditing(null)}>{t("Cancel")}</button><button className="btn btn-primary btn-sm" onClick={saveEdit} disabled={!editBody.trim()}>{t("Save")}</button></div></div> : <Body text={c.body} />}
          {c.replies.map((r) => (
            <div key={r.id} style={{ marginLeft: 22, paddingLeft: 10, borderLeft: "2px solid var(--line)", width: "calc(100% - 32px)" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {r.kind === "answer" && <span className="chip chip-blue">{t("Answer")}</span>}
                <span style={{ fontWeight: 600, fontSize: 13 }}>{r.by.name}</span><span style={{ fontSize: 12, color: "var(--muted)" }}>{new Date(r.ts).toLocaleString()}{r.editedTs ? ` · ${t("edited")}` : ""}</span>
                {mayEdit(r) && <span style={{ marginLeft: "auto" }}><button className="btn btn-ghost btn-sm" onClick={() => { setEditing(r.id); setEditBody(r.body); }} aria-label={t("Edit")}><Pencil size={12} /></button><button className="btn btn-ghost btn-sm btn-danger" onClick={() => remove(r)} aria-label={t("Delete")}><Trash2 size={12} /></button></span>}
              </div>
              {editing === r.id ? <div><textarea aria-label={t("Edit comment")} value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={2} style={{ width: "100%", boxSizing: "border-box" }} /><div className="modal-actions" style={{ marginTop: 6 }}><button className="btn btn-sm" onClick={() => setEditing(null)}>{t("Cancel")}</button><button className="btn btn-primary btn-sm" onClick={saveEdit} disabled={!editBody.trim()}>{t("Save")}</button></div></div> : <Body text={r.body} />}
            </div>
          ))}
          {replyTo === c.id && (
            <div style={{ marginLeft: 22, width: "calc(100% - 22px)" }}>
              <textarea aria-label={c.kind === "question" ? t("Your answer") : t("Your reply")} value={replyBody} onChange={(e) => setReplyBody(e.target.value)} rows={2} maxLength={4000} autoFocus style={{ width: "100%", boxSizing: "border-box" }} placeholder={c.kind === "question" ? t("Answer the question…") : t("Reply…")} />
              <div className="modal-actions" style={{ marginTop: 6 }}>
                <button className="btn btn-sm" onClick={() => setReplyTo(null)}>{t("Cancel")}</button>
                <button className="btn btn-primary btn-sm" disabled={busy || !replyBody.trim()} onClick={() => post(replyBody, c.kind === "question" ? "answer" : "comment", c.id)}>{c.kind === "question" ? t("Post answer") : t("Post reply")}</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* dashboard: questions I should answer (steward/owner of the object, admins) and my own open questions */
export function QuestionsSection({ Section, onOpenRef }) {
  const { t } = useT();
  const [qs, setQs] = useState(null);
  useEffect(() => { let stop = false; api("/api/collab/questions/open").then((j) => !stop && setQs({ toAnswer: Array.isArray(j?.toAnswer) ? j.toAnswer : [], mine: Array.isArray(j?.mine) ? j.mine : [] })).catch(() => !stop && setQs({ toAnswer: [], mine: [] })); return () => { stop = true; }; }, []);
  const row = (qn, chip) => (
    <div key={qn.id} className="role-row edge-row" {...clickable(() => onOpenRef({ type: qn.entityType, id: qn.entityId, tab: "discussion" }))}>
      {chip}
      <span className="mono" style={{ fontWeight: 600 }}>{qn.path}</span>
      <span style={{ fontSize: 12.5, color: "var(--muted)", flex: 1, minWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{qn.body}</span>
      <span style={{ fontSize: 12, color: "var(--muted)" }}>{qn.by.name} · {new Date(qn.ts).toLocaleDateString()}</span>
    </div>
  );
  return (
    <Section icon={HelpCircle} title={t("Questions")} count={(qs?.toAnswer.length || 0) + (qs?.mine.length || 0)}>
      {qs === null && <div className="modal-sub">{t("Loading…")}</div>}
      {qs && !qs.toAnswer.length && !qs.mine.length && <div className="modal-sub">{t("No open questions for your assets, and none of your own.")}</div>}
      {qs?.toAnswer.length > 0 && <div style={{ fontWeight: 600, margin: "6px 0 2px" }}>{t("Questions to answer")} <span className="chip chip-amber">{qs.toAnswer.length}</span></div>}
      {qs?.toAnswer.map((qn) => row(qn, <span className="chip chip-amber"><HelpCircle size={11} /> {t("to answer")}</span>))}
      {qs?.mine.length > 0 && <div style={{ fontWeight: 600, margin: "10px 0 2px" }}>{t("My open questions")} <span className="chip chip-grey">{qs.mine.length}</span></div>}
      {qs?.mine.map((qn) => row(qn, <span className="chip chip-grey"><HelpCircle size={11} /> {t("asked by me")}</span>))}
    </Section>
  );
}

/* home / governance: top viewed tables, top search terms, top rated */
export function UsagePanel({ onOpenTable, days = 30 }) {
  const { t } = useT();
  const [top, setTop] = useState(null);
  const [period, setPeriod] = useState(days);
  useEffect(() => { let stop = false; api(`/api/usage/top?days=${period}`).then((j) => !stop && setTop({ tables: [], terms: [], topRated: [], totals: {}, ...(j && typeof j === "object" ? j : {}), ...(Array.isArray(j?.tables) ? {} : { tables: [], terms: [], topRated: [], totals: {} }) })).catch(() => !stop && setTop({ tables: [], terms: [], topRated: [], totals: {} })); return () => { stop = true; }; }, [period]);
  return (
    <div className="panel" data-testid="usage-panel">
      <h3><BarChart3 size={17} /> {t("Usage")}
        <select aria-label={t("Period")} value={period} onChange={(e) => setPeriod(Number(e.target.value))} style={{ marginLeft: "auto", fontSize: 12 }}>
          <option value={7}>7 {t("days")}</option><option value={30}>30 {t("days")}</option><option value={90}>90 {t("days")}</option><option value={365}>365 {t("days")}</option>
        </select>
      </h3>
      {top === null && <div className="modal-sub">{t("Loading…")}</div>}
      {top && <>
        <div className="modal-sub">{top.totals.views || 0} {t("views")} · {top.totals.searches || 0} {t("searches")} · {top.totals.exports || 0} {t("exports")} · {top.totals.users || 0} {t("active users")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4, display: "flex", gap: 6, alignItems: "center" }}><Eye size={13} /> {t("Most viewed tables")}</div>
            {!top.tables.length && <div className="modal-sub">{t("No views recorded yet.")}</div>}
            {top.tables.map((x, i) => <div key={x.tableId} className="role-row edge-row" style={{ padding: "5px 0" }} {...(x.exists ? clickable(() => onOpenTable?.(x.tableId)) : {})}><span style={{ color: "var(--muted)", width: 18 }}>{i + 1}.</span><span className="mono" style={{ fontSize: 12.5, flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{x.path}</span><span className="chip chip-grey">{x.views} · {x.users} {t("people")}</span></div>)}
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4, display: "flex", gap: 6, alignItems: "center" }}><Search size={13} /> {t("Top search terms")}</div>
            {!top.terms.length && <div className="modal-sub">{t("No searches recorded yet.")}</div>}
            {top.terms.map((x, i) => <div key={x.term} className="role-row" style={{ padding: "5px 0" }}><span style={{ color: "var(--muted)", width: 18 }}>{i + 1}.</span><span style={{ flex: 1 }}>{x.term}</span><span className="chip chip-grey">{x.count}</span></div>)}
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4, display: "flex", gap: 6, alignItems: "center" }}><Star size={13} /> {t("Best rated tables")}</div>
            {!top.topRated.length && <div className="modal-sub">{t("No ratings yet.")}</div>}
            {top.topRated.map((x, i) => <div key={x.tableId} className="role-row edge-row" style={{ padding: "5px 0" }} {...(x.exists ? clickable(() => onOpenTable?.(x.tableId)) : {})}><span style={{ color: "var(--muted)", width: 18 }}>{i + 1}.</span><span className="mono" style={{ fontSize: 12.5, flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{x.path}</span><span className="chip chip-amber"><Star size={11} /> {x.avg.toFixed(1)} ({x.count})</span></div>)}
          </div>
        </div>
      </>}
    </div>
  );
}
