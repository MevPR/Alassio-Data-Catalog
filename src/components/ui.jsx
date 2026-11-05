import React, { useState, useEffect, useRef } from "react";
import { TrendingUp, X, HeartPulse, Umbrella, Building2, Boxes, ChevronDown as CaretDown, Users, Landmark } from "lucide-react";
import { useT } from "../i18n.jsx";

export const PAGE = 100;
export function usePaged() {
  const { t } = useT();
  const [pages, setPages] = useState({});
  const slice = (key, list, page = PAGE) => list.slice(0, (pages[key] || 1) * page);
  const more = (key, list, page = PAGE) => list.length > (pages[key] || 1) * page
    ? <button className="btn btn-ghost btn-sm" style={{ margin: "4px 0 6px 12px", color: "var(--accent)" }} onClick={() => setPages((p) => ({ ...p, [key]: (p[key] || 1) + 1 }))}>
        {t("Show more ({n} remaining)").replace("{n}", list.length - (pages[key] || 1) * page)}
      </button>
    : null;
  return { slice, more };
}

export const HUB_ICON = { finance: Landmark, hr: Users, sales: TrendingUp, central: Building2, health: HeartPulse, pc: Umbrella };   /* central / health / pc: hub types of catalogs created before v1.78 */

/* keyboard support for clickable non-button elements (cards, tree rows, list rows): Enter / Space activate */
export const clickable = (onClick, extra = {}) => ({
  role: "button", tabIndex: 0, onClick,
  onKeyDown: (e) => { if (e.target !== e.currentTarget) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e); } },
  ...extra,
});

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let modalSeq = 0;
/* accessible dialog (v1.57): aria-modal, labelled by its title, Escape closes, focus moves into the dialog and is
   trapped there, and returns to the opener when the dialog closes. Initial focus (v1.71): an element the dialog marked
   with `autoFocus` (React focused it before this effect runs) or `data-autofocus` wins; otherwise the first control
   after the close button — never the close "X" itself. `describedBy` links a body text for screen readers.
   v1.74 (F-F1 of the third review): the opener is remembered during the first render — before React applies
   `autoFocus` in the commit phase — so focus really returns to the button that opened the dialog (it went to <body>
   for every dialog with an autofocused field); Escape and the backdrop call the current `onClose`, not the first one. */
export const Modal = ({ title, sub, onClose, wide, className = "", describedBy, children }) => {
  const { t } = useT();
  const ref = useRef(null);
  const [ids] = useState(() => { modalSeq += 1; return { title: `dlg-title-${modalSeq}`, sub: `dlg-sub-${modalSeq}` }; });
  const [opener] = useState(() => (typeof document !== "undefined" ? document.activeElement : null));
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    const node = ref.current;
    if (node && !node.contains(document.activeElement)) {
      const preferred = node.querySelector("[data-autofocus]");
      const first = preferred || [...node.querySelectorAll(FOCUSABLE)].find((el) => !el.hasAttribute("data-modal-close")) || node.querySelector(FOCUSABLE);
      (first || node).focus?.();
    }
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest("[hidden]"));
      if (!items.length) { e.preventDefault(); return; }
      const [a, z] = [items[0], items[items.length - 1]];
      if (e.shiftKey && (document.activeElement === a || document.activeElement === node)) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); if (opener && opener !== document.body && typeof opener.focus === "function" && document.contains(opener)) opener.focus(); };
  }, [opener]);
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className={`modal ${wide ? "modal-wide" : ""} ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={ids.title} aria-describedby={describedBy || (sub ? ids.sub : undefined)}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div><h3 id={ids.title}>{title}</h3>{sub && <div className="modal-sub" id={ids.sub}>{sub}</div>}</div>
          <button className="btn btn-ghost" onClick={onClose} aria-label={t("Close")} data-modal-close><X size={17} /></button>
        </div>
        {children}
      </div>
    </div>
  );
};

/* label + control; a single input/select/textarea child without its own id is associated with the label (v1.59, a11y) */
export const Field = ({ label, children }) => {
  const id = React.useId();
  const kids = React.Children.toArray(children);
  const control = kids.length === 1 && React.isValidElement(kids[0]) && ["input", "select", "textarea"].includes(kids[0].type) && !kids[0].props.id ? kids[0] : null;
  return <div className="field"><label htmlFor={control ? id : undefined}>{label}</label>{control ? React.cloneElement(control, { id }) : children}</div>;
};

export const SensChip = ({ v }) => {
  const cls = v === "PII" ? "chip-red" : v === "Confidential" ? "chip-amber" : v === "Public" ? "chip-green" : "chip-grey";
  return <span className={`chip ${cls}`}>{v}</span>;
};

export const HubIcon = ({ hubId, size = 15 }) => {
  const I = HUB_ICON[hubId] || Boxes;
  return <I size={size} />;
};


export function MenuC({ label, icon, items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const list = items.filter(Boolean);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    /* keyboard: arrows move between the entries, Escape closes and returns focus to the trigger */
    const items0 = ref.current?.querySelectorAll('[role="menuitem"]');
    items0?.[0]?.focus();
    const k = (e) => {
      const els = [...(ref.current?.querySelectorAll('[role="menuitem"]') || [])];
      const i = els.indexOf(document.activeElement);
      if (e.key === "Escape") { setOpen(false); ref.current?.querySelector("button")?.focus(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
      else if (e.key === "Tab") setOpen(false);
    };
    document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [open]);
  if (!list.length) return null;
  return (
    <div className="menu-wrap" ref={ref}>
      <button className={`btn ${list.some((i) => i.active) ? "btn-primary" : ""}`} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title={label}>
        {icon} <span className="btn-txt">{label}</span> <CaretDown size={13} style={{ marginLeft: -2, opacity: .7 }} aria-hidden="true" />
      </button>
      {open && (
        <div className="menu-pop" role="menu" aria-label={label}>
          {list.map((it) => (
            <button key={it.label} className={`menu-item ${it.active ? "active" : ""}`} role="menuitem" aria-current={it.active ? "page" : undefined} onClick={() => { setOpen(false); it.onClick(); }}>
              {it.icon} {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
