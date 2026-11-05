import { useRef } from "react";
import { Menu, Search, X, ShieldCheck, UserCog, Eye, KeyRound, LogOut, Upload, Download, Plug, Server, FileText, FileJson, UploadCloud, BookOpen, Store, Layers, Users, Landmark, History, Info, Archive } from "lucide-react";
import { MenuC } from "../components/ui.jsx";
import { useT, LangSwitchC } from "../i18n.jsx";
import { fill } from "../lib/i18n-format.js";
import { useActions, useCatalogData, useNav } from "../catalog-context.jsx";

/* brand, search box, user chip and the action menus */
export function Topbar() {
  const { t: tr, lang, setLang } = useT();
  const { me, isAdmin, canEdit, canStructure, isPm, unread } = useCatalogData();
  const { view, setView, setSel, query, setQuery, setModal, railOpen, setRailOpen } = useNav();
  const { logout, importCsv, importDump, exportDump, exportGlossary } = useActions();
  const fileRef = useRef(null);
  const dumpRef = useRef(null);
  const toggleView = (v) => () => setView(view === v ? "catalog" : v);
  const navBtn = (v, icon, label, extra = null) => (
    <button className={`btn ${view === v ? "btn-primary" : ""} ${extra ? "btn-badged" : ""}`} onClick={toggleView(v)} aria-current={view === v ? "page" : undefined} title={label}>{icon} <span className="btn-txt">{label}</span>{extra}</button>
  );
  return (
    <header className="topbar" role="banner">
      <button className="btn btn-ghost rail-toggle" onClick={() => setRailOpen((o) => !o)} aria-label={tr("Catalog tree")} aria-expanded={!!railOpen} aria-controls="catalog-rail"><Menu size={20} /></button>
      <div className="brand" role="link" tabIndex={0} aria-label={tr("Alassio Data Catalog — Home")} onClick={() => { setSel({ type: "home" }); setView("catalog"); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel({ type: "home" }); setView("catalog"); } }}>
        <div className="brand-mark">COMPANY</div>
        <div>
          <div className="brand-name">Alassio Data Catalog</div>
          <div className="brand-sub">COMPANY Group · metadata &amp; governance</div>
        </div>
      </div>
      <div className="searchbox">
        <Search size={15} color="var(--muted)" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr("Search hubs, databases, schemas, tables, attributes…")} aria-label={tr("Search catalog")} />
        {query && <button className="btn btn-ghost btn-sm" onClick={() => setQuery("")} aria-label={tr("Clear search")}><X size={14} /></button>}
      </div>
      <div className="role-switch topbar-user" title={me?.email}>
        {isAdmin ? <ShieldCheck size={15} /> : canEdit ? <UserCog size={15} /> : <Eye size={15} />}
        <span className="role-name">{me?.name} · {me?.role}{me?.role === "guest" ? " (read-only)" : ""}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => setModal({ kind: "security" })} aria-label={tr("Security")} title={tr("Security")}><KeyRound size={14} /></button>
        <LangSwitchC lang={lang} setLang={setLang} label={tr("Language")} />
        <button className="btn btn-ghost btn-sm" onClick={logout} aria-label={tr("Sign out")} title={tr("Sign out")}><LogOut size={14} /></button>
      </div>
      <div className="topbar-actions">
        {navBtn("mydash", <UserCog size={15} />, tr("My Dashboard"), unread > 0 && <span className="badge" aria-label={fill(tr("{n} unread"), { n: unread })}>{unread}</span>)}
        <MenuC label={tr("Import")} icon={<Upload size={15} />} items={[
          canStructure && { label: tr("Import CSV"), icon: <Upload size={14} />, onClick: () => fileRef.current?.click() },
          isAdmin && { label: tr("Unity Catalog"), icon: <Plug size={14} />, onClick: () => setModal({ kind: "unity" }) },
          isAdmin && { label: tr("Load source"), icon: <Server size={14} />, onClick: () => setModal({ kind: "loadsource" }) },
        ]} />
        <MenuC label={tr("Export")} icon={<Download size={15} />} items={[
          { label: tr("Export CSV"), icon: <FileText size={14} />, onClick: () => setModal({ kind: "export" }) },
          { label: tr("Export OKF"), icon: <FileJson size={14} />, onClick: () => setModal({ kind: "exportokf" }) },
          { label: tr("Write back to UC"), icon: <UploadCloud size={14} />, onClick: () => setModal({ kind: "writeback" }) },   /* v1.77: every user writes their own changes, after a preview */
        ]} />
        {navBtn("glossary", <BookOpen size={15} />, tr("Glossary"))}
        <input ref={fileRef} type="file" accept=".csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ""; }} />
        <input ref={dumpRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importDump(f); e.target.value = ""; }} />
        {navBtn("marketplace", <Store size={15} />, tr("Marketplace"))}
        {(isAdmin || isPm) && navBtn("dpstatus", <Layers size={15} />, tr("Discover Data Products"))}
        <MenuC label={tr("Admin")} icon={<ShieldCheck size={15} />} items={[
          isAdmin && { label: tr("Users"), icon: <Users size={14} />, onClick: toggleView("users"), active: view === "users" },
          isAdmin && { label: tr("Governance Overview"), icon: <Landmark size={14} />, onClick: toggleView("governance"), active: view === "governance" },
          isAdmin && { label: tr("Audit trail"), icon: <History size={14} />, onClick: toggleView("audit"), active: view === "audit" },
          isAdmin && { label: tr("Dump"), icon: <Download size={14} />, onClick: exportDump },
          isAdmin && { label: tr("Restore"), icon: <Upload size={14} />, onClick: () => dumpRef.current?.click() },
          isAdmin && { label: tr("Backups & jobs"), icon: <Archive size={14} />, onClick: toggleView("backups"), active: view === "backups" },
          isAdmin && { label: tr("Export Glossary Terms"), icon: <BookOpen size={14} />, onClick: exportGlossary },
        ]} />
        <button className="btn btn-ghost" onClick={() => setModal({ kind: "help" })} aria-label={tr("Help and feature guide")} title={tr("Help and feature guide")}><Info size={19} /></button>
      </div>
    </header>
  );
}
