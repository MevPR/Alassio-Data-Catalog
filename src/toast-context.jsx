/* Toast and confirmation dialogs (v1.70 — finding F-F9 of the Clean Code review).

   `useToast()` gives every component the same three calls, without prop drilling:
     flash(key, vars)                 — a short toast; `key` is an English dictionary key, `{name}` placeholders are
                                        filled from `vars` after translation — e.g. the key "Deleted {name}" with vars { name }
     confirm(key, vars, opts)         — an accessible yes/no dialog instead of window.confirm; resolves to true/false.
                                        opts: { title, confirmLabel, danger }
     prompt(key, vars, opts)          — a dialog with a text field instead of window.prompt; resolves to the trimmed
                                        text, "" when optional and empty, null when cancelled.
                                        opts: { title, label, placeholder, required = true, confirmLabel, rows }
   Outside a <ToastProvider> (unit tests rendering a single component) the calls are no-ops that resolve to
   false / null, so a component never needs a fallback. The toast and the dialog render once, beside the
   application shell, so showing a message does not re-render the views. */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useT } from "./i18n.jsx";
import { Modal, Field } from "./components/ui.jsx";
import { fill } from "./lib/i18n-format.js";   /* v1.73 (F-F7): the pure formatter lives in src/lib */

const NOOP = { flash: () => {}, confirm: async () => false, prompt: async () => null };
const ToastContext = createContext(NOOP);
export const useToast = () => useContext(ToastContext);
/* tests render components inside this when they want to observe flash() / answer confirm() */
export const ToastContextForTests = ToastContext;

export function ToastProvider({ children, duration = 3200 }) {
  const { t } = useT();
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const [dialog, setDialog] = useState(null);

  const flash = useCallback((key, vars) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(fill(t(key), vars));
    timer.current = setTimeout(() => setToast(null), duration);
  }, [t, duration]);
  const ask = useCallback((kind, key, vars, opts) => new Promise((resolve) => setDialog({ kind, text: fill(t(key), vars), ...opts, resolve })), [t]);
  const confirm = useCallback((key, vars, opts = {}) => ask("confirm", key, vars, opts), [ask]);
  const prompt = useCallback((key, vars, opts = {}) => ask("prompt", key, vars, opts), [ask]);
  const api = useMemo(() => ({ flash, confirm, prompt }), [flash, confirm, prompt]);

  const close = (value) => { const d = dialog; setDialog(null); d?.resolve(value); };
  return (
    <ToastContext.Provider value={api}>
      {children}
      {dialog && <ConfirmModalC {...dialog} onClose={close} />}
      <div className="sr-live" role="status" aria-live="polite" aria-atomic="true">{toast || ""}</div>
      {toast && <div className="toast" aria-hidden="true"><CheckCircle2 size={16} /> {toast}</div>}
    </ToastContext.Provider>
  );
}

/* the dialog behind confirm() / prompt(): one message, Cancel, and one confirming button (red for destructive steps) */
function ConfirmModalC({ kind, text, title, confirmLabel, danger = false, label, placeholder, required = true, rows = 3, onClose }) {
  const { t } = useT();
  const [value, setValue] = useState("");
  const isPrompt = kind === "prompt";
  const cancel = () => onClose(isPrompt ? null : false);
  const ok = () => onClose(isPrompt ? value.trim() : true);
  const okDisabled = isPrompt && required && !value.trim();
  return (
    <Modal title={t(title || (isPrompt ? "Your input" : "Please confirm"))} onClose={cancel} className="modal-confirm" describedBy="confirm-text">
      <p className="confirm-text" id="confirm-text" style={{ whiteSpace: "pre-line" }}>{text}</p>
      {isPrompt && <Field label={t(label || (required ? "Reason" : "Optional note"))}>
        <textarea rows={rows} value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder ? t(placeholder) : ""} style={{ width: "100%" }} autoFocus
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !okDisabled) ok(); }} />
      </Field>}
      <div className="modal-actions">
        {/* destructive steps start on Cancel, ordinary confirmations on OK, prompts in the text area (v1.71) */}
        <button className="btn" onClick={cancel} data-autofocus={!isPrompt && danger ? "" : undefined}>{t("Cancel")}</button>
        <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} disabled={okDisabled} onClick={ok} data-testid="confirm-ok" data-autofocus={!isPrompt && !danger ? "" : undefined}>{t(confirmLabel || (danger ? "Delete" : "OK"))}</button>
      </div>
    </Modal>
  );
}
