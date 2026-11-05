import { useMemo, useState } from "react";
import { Upload, Download, ShieldCheck, UserCog, Layers, Tag, Search, Pencil, KeyRound, Users, Boxes, GitBranch, History, Send, Server, Bot, FileJson, BookOpen, Store, MessageSquare, Lightbulb, FlaskConical } from "lucide-react";
import { APP_VERSION, PRODUCT } from "../lib/model.js";
import { Modal } from "./ui.jsx";
import { useT } from "../i18n.jsx";
import { helpChapters, ROLE_IDS, ROLE_OF_ACCOUNT } from "../help-chapters.js";
import { FIGURES } from "../help-figures.jsx";

const ICONS = { boxes: Boxes, search: Search, pencil: Pencil, shield: ShieldCheck, lineage: GitBranch, upload: Upload, download: Download, history: History, key: KeyRound, book: BookOpen, store: Store, message: MessageSquare, send: Send, tag: Tag, layers: Layers, users: Users, usercog: UserCog, bot: Bot, json: FileJson, server: Server };
/* which guide a signed-in person sees first: the highest of their account roles */
const ROLE_PRIORITY = ["admin", "steward", "pm", "ba", "ingestion", "dpd", "guest"];
export const defaultRoleFor = (roles = []) => ROLE_PRIORITY.find((r) => roles.includes(r)) || "guest";

/* tiny renderer: blank line = paragraph, "• " = bullet, "1. " = numbered step, ``` = code block, **x** = bold, *x* = italic */
const inline = (s) => s.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g).map((part, i) => part.startsWith("**") ? <b key={i}>{part.slice(2, -2)}</b> : part.startsWith("*") && part.length > 2 ? <i key={i}>{part.slice(1, -1)}</i> : part);
export function Body({ text }) {
  const out = []; const lines = text.split("\n"); let i = 0, para = [], list = [], steps = [];
  const flushPara = () => { if (para.length) { out.push(<p key={out.length}>{inline(para.join(" "))}</p>); para = []; } };
  const flushList = () => { if (list.length) { out.push(<ul key={out.length} className="help-list">{list.map((l, k) => <li key={k}>{inline(l)}</li>)}</ul>); list = []; } };
  const flushSteps = () => { if (steps.length) { out.push(<ol key={out.length} className="help-list help-steps">{steps.map((l, k) => <li key={k}>{inline(l)}</li>)}</ol>); steps = []; } };
  const flushAll = () => { flushPara(); flushList(); flushSteps(); };
  while (i < lines.length) {
    const ln = lines[i];
    if (ln.startsWith("```")) { flushAll(); const code = []; i++; while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]); out.push(<pre key={out.length} className="help-code">{code.join("\n")}</pre>); i++; continue; }
    if (ln.startsWith("• ")) { flushPara(); flushSteps(); list.push(ln.slice(2)); i++; continue; }
    if (/^\d+\. /.test(ln)) { flushPara(); flushList(); steps.push(ln.replace(/^\d+\. /, "")); i++; continue; }
    if (!ln.trim()) { flushAll(); i++; continue; }
    flushList(); flushSteps(); para.push(ln); i++;
  }
  flushAll();
  return <>{out}</>;
}

/* v1.65: a section may carry figures (help-figures.jsx), a worked example and tips (help-manual.js) */
export function Figure({ id, labels, caption }) {
  const Fig = FIGURES[id]; const L = labels?.[id];
  if (!Fig || !L) return null;
  return <figure className="help-figure"><Fig L={L} />{caption !== false && <figcaption>{L.title}</figcaption>}</figure>;
}
export function SectionExtras({ s, figLabels, ui }) {
  return (
    <>
      {(s.figures || []).map((id) => <Figure key={id} id={id} labels={figLabels} />)}
      {s.example && <div className="help-example" data-testid="help-example"><div className="help-example-h"><FlaskConical size={14} /> {ui.example}{s.example.title ? ` — ${s.example.title}` : ""}</div><Body text={s.example.body} /></div>}
      {s.tips?.length > 0 && <div className="help-tips"><div className="help-example-h"><Lightbulb size={14} /> {ui.tips}</div><ul className="help-list">{s.tips.map((tip, i) => <li key={i}>{inline(tip)}</li>)}</ul></div>}
    </>
  );
}
export function Section({ s, open = true, figLabels, ui }) {
  const Icon = ICONS[s.icon] || Boxes;
  return (
    <div className="help-sec" id={`help-${s.id}`}>
      <Icon size={18} className="help-sec-icon" />
      <div style={{ minWidth: 0, flex: 1 }}><b>{s.title}</b>{open && <Body text={s.body} />}{open && figLabels && ui && <SectionExtras s={s} figLabels={figLabels} ui={ui} />}</div>
    </div>
  );
}

/* Help (v1.62): chapters on the left, one chapter at a time; the role guide chapter offers one guide per role and
   preselects the highest account role; a search box finds sections across all chapters. */
export function HelpModalC({ isAdmin, roles = [], onClose, initialChapter = "start", initialRole }) {
  const { lang, t } = useT();
  const help = useMemo(() => helpChapters(lang), [lang]);
  const chapters = help.chapters.filter((c) => !c.adminOnly || isAdmin);
  const [chapterId, setChapterId] = useState(chapters.some((c) => c.id === initialChapter) ? initialChapter : "start");
  const [role, setRole] = useState(initialRole && ROLE_IDS.includes(initialRole) ? initialRole : defaultRoleFor(roles));
  const [q, setQ] = useState("");
  const chapter = chapters.find((c) => c.id === chapterId) || chapters[0];
  const query = q.trim().toLowerCase();
  const hits = query.length < 2 ? null : chapters.flatMap((c) => c.sections.filter((s) => !s.adminOnly || isAdmin).filter((s) => [s.title, s.body, s.example?.title, s.example?.body, ...(s.tips || [])].filter(Boolean).join("\n").toLowerCase().includes(query)).map((s) => ({ ...s, chapter: c })));
  const myRoles = roles.map((r) => ROLE_OF_ACCOUNT[r]).filter(Boolean);
  const roleLabel = (r) => (help.chapters.find((c) => c.id === "roles").sections.find((s) => s.role === r) || {}).title.split(" — ")[0];
  return (
    <Modal wide className="modal-help" title={help.title} sub={help.sub} onClose={onClose}>
      <div className="help-layout">
        <nav className="help-nav" aria-label={t("Help chapters")}>
          <input className="help-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={help.ui.search} aria-label={help.ui.search} />
          {chapters.map((c) => { const Icon = ICONS[c.icon] || Boxes; return (
            <button key={c.id} type="button" className={`help-nav-btn ${c.id === chapterId && !hits ? "active" : ""}`} onClick={() => { setQ(""); setChapterId(c.id); }} aria-current={c.id === chapterId && !hits ? "page" : undefined}>
              <Icon size={15} /><span>{c.title}</span>
            </button>
          ); })}
        </nav>
        <div className="help-body">
          {hits ? (
            <>
              <h4 className="help-h">{help.ui.results} ({hits.length})</h4>
              {hits.length === 0 && <p className="modal-sub">{help.ui.noHits}</p>}
              {hits.map((s) => (
                <div key={s.chapter.id + s.id}>
                  <div className="help-crumb">{s.chapter.title}</div>
                  <Section s={s} figLabels={help.figLabels} ui={help.manual} />
                </div>
              ))}
            </>
          ) : (
            <>
              <h4 className="help-h">{chapter.title}</h4>
              <p className="modal-sub" style={{ marginBottom: 10 }}>{chapter.intro}</p>
              {chapter.id === "roles" ? (
                <>
                  <div className="help-roles" role="tablist" aria-label={help.ui.role}>
                    {ROLE_IDS.map((r) => (
                      <button key={r} type="button" role="tab" aria-selected={r === role} className={`chip ${r === role ? "chip-blue" : myRoles.includes(r) ? "chip-amber" : "chip-grey"}`} onClick={() => setRole(r)} title={myRoles.includes(r) ? help.ui.yourRoles : undefined}>
                        {roleLabel(r)}
                      </button>
                    ))}
                  </div>
                  {chapter.sections.filter((s) => s.role === role).map((s) => <Section key={s.id} s={s} figLabels={help.figLabels} ui={help.manual} />)}
                </>
              ) : chapter.sections.filter((s) => !s.adminOnly || isAdmin).map((s) => <Section key={s.id} s={s} figLabels={help.figLabels} ui={help.manual} />)}
            </>
          )}
        </div>
      </div>
      <div style={{ marginTop: 14, fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 10 }}>
        <a className="btn btn-sm" href={`?manual=1&lang=${lang}`} target="_blank" rel="noreferrer noopener"><BookOpen size={13} /> {help.manual.handbook}</a>
        <span style={{ marginLeft: "auto" }} data-testid="help-version">{PRODUCT} · {help.manual.version} {APP_VERSION}</span>
      </div>
    </Modal>
  );
}
