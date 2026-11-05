/* Printable handbook (v1.65): the whole help as one document — cover, table of contents, the role guides and every
   feature chapter with figures, worked examples and tips. Opened from the help dialog (?manual=1&lang=xx) in a new
   tab; no sign-in needed because the texts are static. "Print / save as PDF" uses the browser's print dialog. */
import { useMemo } from "react";
import { BookOpen, Printer, ArrowLeft } from "lucide-react";
import { APP_VERSION, PRODUCT } from "../lib/model.js";
import { useT, LANGS, LOCALE } from "../i18n.jsx";
import { helpChapters } from "../help-chapters.js";
import { Body, SectionExtras } from "../components/help.jsx";

export function ManualPage() {
  const { t, lang, setLang } = useT();
  const help = useMemo(() => helpChapters(lang), [lang]);
  const ui = help.manual;
  const chapters = help.chapters;   /* the handbook includes the admin chapter — it is documentation, not access */
  const num = (ci, si) => `${ci + 1}.${si + 1}`;
  return (
    <div className="manual" lang={lang}>
      <div className="manual-bar no-print">
        <a className="btn btn-sm" href="./"><ArrowLeft size={14} /> {ui.back}</a>
        <select className="btn btn-sm" value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t("Language")}>{LANGS.map(([l, name]) => <option key={l} value={l}>{name}</option>)}</select>
        <button type="button" className="btn btn-sm btn-primary" style={{ marginLeft: "auto" }} onClick={() => window.print()}><Printer size={14} /> {ui.print}</button>
      </div>
      <header className="manual-cover">
        <BookOpen size={40} style={{ color: "var(--brand)" }} />
        <h1>{ui.handbookTitle}</h1>
        <p className="manual-sub">{help.sub}</p>
        <p className="manual-meta">{ui.version} {APP_VERSION} · {ui.generated} {new Date().toLocaleDateString(LOCALE[lang] || "en-GB")}</p>
        <p className="manual-intro">{ui.intro}</p>
      </header>
      <nav className="manual-toc" aria-label={ui.contents}>
        <h2>{ui.contents}</h2>
        <ol>
          {chapters.map((c, ci) => (
            <li key={c.id}><a href={`#ch-${c.id}`}>{c.title}</a>
              <ol>{c.sections.map((s, si) => <li key={s.id}><a href={`#sec-${c.id}-${s.id}`}>{num(ci, si)} {s.title}</a></li>)}</ol>
            </li>
          ))}
        </ol>
      </nav>
      {chapters.map((c, ci) => (
        <section key={c.id} id={`ch-${c.id}`} className="manual-chapter">
          <h2>{ci + 1}. {c.title}</h2>
          <p className="manual-intro">{c.intro}</p>
          {c.sections.map((s, si) => (
            <article key={s.id} id={`sec-${c.id}-${s.id}`} className="manual-section">
              <h3>{num(ci, si)} {s.title}</h3>
              <Body text={s.body} />
              <SectionExtras s={s} figLabels={help.figLabels} ui={ui} />
            </article>
          ))}
        </section>
      ))}
      <footer className="manual-foot">{PRODUCT} · {ui.version} {APP_VERSION}</footer>
    </div>
  );
}
