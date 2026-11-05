import { CSS } from "../styles.js";
import React, { useState, useEffect } from "react";
import { ShieldCheck, X, KeyRound, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { apiPost, apiGet, apiGetOr, ApiError } from "../lib/api.js";
import { hasRole } from "../lib/roles.js";
import { Modal, Field } from "./ui.jsx";
import { AgentKeysC } from "./agent-keys.jsx";
import { ConnectedAppsC } from "./connected-apps.jsx";
import { TwoFactorSetup } from "./two-factor-setup.jsx";
import { screenFor, headlineScreen, hasCredentialsForm } from "../lib/auth-screens.js";
import { useT, LangSwitchC } from "../i18n.jsx";
import { useToast } from "../toast-context.jsx";

/* (v1.70) The sign-in gate renders exactly one screen, chosen once per render by `screenFor` (src/lib/auth-screens.js):
     enrol         2FA enrolment right after the first admin / an invitee created the account
     header        proxy-identity mode — notice only, no form
     sso-enforced  SSO button + break-glass link, no password form
     login | totp | forgot | reset | bootstrap | invite   the credentials form (fields per screen in FORM_FIELDS)
   `entry` is the screen the session hook chose from the auth status and the query string
   ({ mode, token?, mail? }, see src/hooks/use-session.js); the gate itself only moves between "login" and "forgot". */
const EMPTY_FORM = { name: "", email: "", password: "", password2: "", code: "" };

export function AuthGateC({ screen: entry, onAuthed }) {
  const { t, lang, setLang } = useT();
  const [sso, setSso] = useState({ enabled: false, buttonLabel: "", enforce: false, mode: "local" });
  const [breakGlass, setBreakGlass] = useState(false);   /* SSO enforced: password form only on request (break-glass accounts) */
  const [identity, setIdentity] = useState(null);
  useEffect(() => { if (entry.mode === "header") apiGetOr("/auth/identity").then((j) => j && setIdentity(j)); }, [entry.mode]);
  const [ssoError] = useState(() => { try { return new URLSearchParams(window.location.search).get("sso_error"); } catch { return null; } });
  useEffect(() => { apiGetOr("/auth/sso/config").then((j) => j && setSso(j)); }, []);
  const [form, setForm] = useState(EMPTY_FORM);
  const [need2fa, setNeed2fa] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pendingUser, setPendingUser] = useState(null); // account created, offering 2FA setup
  /* v1.67: password reset (?reset=<token>) and "forgot password" */
  const [mode, setMode] = useState(entry.mode);
  const [resetFor, setResetFor] = useState(null);
  const [info, setInfo] = useState(null);
  useEffect(() => { if (entry.mode === "reset") apiGet(`/auth/reset-info?token=${encodeURIComponent(entry.token)}`).then((j) => setResetFor(j.email), (e) => { if (e instanceof ApiError) { setErr(e.body?.error || t("The reset link is invalid or has expired")); setMode("login"); } }); }, [entry.mode, entry.token]);

  const screen = screenFor(mode, { enrolling: !!pendingUser, ssoEnforced: sso.enforce, breakGlass, need2fa });
  const { name, email, password, password2, code } = form;

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      if (screen === "reset") {
        if (password !== password2) throw new Error(t("The two passwords do not match"));
        const j = await apiPost("/auth/reset-password", { token: entry.token, password });
        try { window.history.replaceState({}, "", window.location.pathname); } catch { }
        setForm((f) => ({ ...f, email: j.email || resetFor || "", password: "", password2: "" })); setInfo(t("Your password was changed — sign in with the new one.")); setMode("login");
      } else if (screen === "forgot") {
        await apiPost("/auth/forgot", { email });
        setInfo(t("If an account with this e-mail exists, a reset link is on its way. The link is valid for 24 hours.")); setMode("login");
      } else if (screen === "bootstrap") {
        const j = await apiPost("/auth/bootstrap", { name, email, password });
        setPendingUser(j.user);
      } else if (screen === "invite") {
        const j = await apiPost("/auth/accept-invite", { token: entry.token, name, password });
        setPendingUser(j.user);
      } else {
        const j = await apiPost("/auth/login", { email, password, code: code || undefined });
        if (j.need2fa) setNeed2fa(true);
        else onAuthed(j.user);
      }
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const titles = {
    login: [t("Sign in"), t("Use your Alassio Data Catalog account.")],
    bootstrap: [t("Create the first administrator"), t("No accounts exist yet — this account will have the admin role.")],
    invite: [t("Accept your invitation"), t("Choose a name and password to activate your account.")],
    header: [t("Sign-in is handled by your identity provider"), t("This catalog trusts the identity forwarded by the sign-in proxy in front of it.")],
    reset: [t("Set a new password"), resetFor ? t("Choose a new password for {email}. Your other sessions end when it is saved.").replace("{email}", resetFor) : t("Checking the reset link…")],
    forgot: [t("Forgot your password?"), t("Enter your e-mail address — we send you a link to set a new password.")],
  }[headlineScreen(screen)] || [t("Sign in"), ""];
  const signIn = headlineScreen(screen) === "login" && hasCredentialsForm(screen);   /* the sign-in form (with or without the code prompt) */

  return (
    <div className="dc-root">
      <style>{CSS}</style>
      <div className="brandband" />
      <div className="auth-bg">
        <div className="auth-card">
          <div className="brand" style={{ marginBottom: 22, cursor: "default" }}>
            <div className="brand-mark">COMPANY</div>
            <div>
              <div className="brand-name">Alassio Data Catalog</div>
              <div className="brand-sub">COMPANY Group · metadata &amp; governance</div>
            </div>
          </div>
          {screen === "enrol" ? <EnrolScreen user={pendingUser} onAuthed={onAuthed} /> : (
          <>
          <h2>{titles[0]}</h2>
          <div className="auth-sub">{titles[1]}</div>
          {err && <div className="notice notice-err"><AlertTriangle size={16} style={{ flexShrink: 0 }} /><span>{err}</span></div>}
          {info && <div className="notice notice-ok" data-testid="auth-info"><CheckCircle2 size={16} style={{ flexShrink: 0 }} /><span>{info}</span></div>}
          {screen === "header" && (
            <div className="notice notice-err" data-testid="header-auth-notice"><AlertTriangle size={16} style={{ flexShrink: 0 }} /><span>{identity?.error || t("No identity was forwarded with this request. Open the catalog through its sign-in proxy (for example the Databricks Apps URL) or ask an admin to check AUTH_MODE.")}</span></div>
          )}
          {screen === "sso-enforced" && (
            <>
              <a className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} href="/auth/sso/login"><ShieldCheck size={15} /> {sso.buttonLabel || t("Sign in with Microsoft")}</a>
              <div className="modal-sub" style={{ textAlign: "center", marginTop: 10 }}>{t("Password sign-in is reserved for break-glass accounts.")} <button className="btn btn-ghost btn-sm" onClick={() => setBreakGlass(true)}>{t("Break-glass sign-in")}</button></div>
            </>
          )}
          {hasCredentialsForm(screen) && (
            <CredentialsForm screen={screen} form={form} setForm={setForm} onSubmit={submit} busy={busy} disabled={screen === "reset" && (!resetFor || password.length < 8)} />
          )}
          {signIn && entry.mail && (
            <div className="modal-sub" style={{ textAlign: "center", marginTop: 8 }}><button className="btn btn-ghost btn-sm" onClick={() => { setErr(null); setInfo(null); setMode("forgot"); }}>{t("Forgot your password?")}</button></div>
          )}
          {signIn && !entry.mail && (
            <div className="modal-sub" style={{ textAlign: "center", marginTop: 8 }}>{t("Forgot your password? An administrator can issue a reset link.")}</div>
          )}
          {screen === "forgot" && (
            <div className="modal-sub" style={{ textAlign: "center", marginTop: 8 }}><button className="btn btn-ghost btn-sm" onClick={() => { setErr(null); setMode("login"); }}>{t("Back to sign-in")}</button></div>
          )}
          {signIn && sso.enabled && (
            <>
              <div className="modal-sub" style={{ textAlign: "center", margin: "10px 0 6px" }}>{t("or")}</div>
              <a className="btn" style={{ width: "100%", justifyContent: "center" }} href="/auth/sso/login"><ShieldCheck size={15} /> {t("Sign in with Microsoft")}</a>
            </>
          )}
          {ssoError && <div className="notice notice-err" style={{ marginTop: 8 }}><AlertTriangle size={16} style={{ flexShrink: 0 }} /><span>{ssoError}</span></div>}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
            <LangSwitchC lang={lang} setLang={setLang} label={t("Language")} />
          </div>
          </>
          )}
        </div>
      </div>
    </div>
  );
}

/* (v1.70) which inputs each credentials screen shows, in order (the submit label lives in CredentialsForm) */
const FORM_FIELDS = {
  login: ["email", "password"],
  totp: ["email", "password", "code"],
  forgot: ["email"],
  reset: ["password", "password2"],
  bootstrap: ["name", "email", "password"],
  invite: ["name", "password"],
};

/* (v1.70) the credentials form of the sign-in gate — inputs by screen plus the submit button; Enter submits */
function CredentialsForm({ screen, form, setForm, onSubmit, busy, disabled }) {
  const { t } = useT();
  const set = (k) => (e) => { const v = e.target.value; setForm((f) => ({ ...f, [k]: v })); };
  const onKey = (e) => { if (e.key === "Enter") onSubmit(); };
  const signIn = screen === "login" || screen === "totp";
  const inputs = {
    name: <Field label={t("Full name")}><input value={form.name} onChange={set("name")} onKeyDown={onKey} autoFocus placeholder={t("Jane Doe")} /></Field>,
    email: <Field label={t("E-mail")}><input type="email" value={form.email} onChange={set("email")} onKeyDown={onKey} autoFocus={signIn || screen === "forgot"} placeholder={t("jane.doe@company.example")} /></Field>,
    password: (
      <Field label={signIn ? t("Password") : screen === "reset" ? t("New password (min. 8 characters)") : t("Password (min. 8 characters)")}>
        <input type="password" value={form.password} onChange={set("password")} onKeyDown={onKey} autoFocus={screen === "reset"} autoComplete={signIn ? "current-password" : "new-password"} />
      </Field>
    ),
    password2: (
      <Field label={t("Repeat the new password")}>
        <input type="password" value={form.password2} onChange={set("password2")} onKeyDown={onKey} autoComplete="new-password" />
      </Field>
    ),
    code: (
      <Field label={t("Authenticator code")}>
        <input className="mono" value={form.code} onChange={set("code")} onKeyDown={onKey} autoFocus placeholder="123456" inputMode="numeric" maxLength={6} />
      </Field>
    ),
  };
  const submitLabel = { bootstrap: t("Create admin account"), invite: t("Activate account"), reset: t("Save new password"), forgot: t("Send reset link"), totp: t("Verify code"), login: t("Sign in") }[screen];
  return (
    <>
      {FORM_FIELDS[screen].map((k) => <React.Fragment key={k}>{inputs[k]}</React.Fragment>)}
      <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 6 }} onClick={onSubmit} disabled={busy || disabled}>
        {busy ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />}
        {submitLabel}
      </button>
    </>
  );
}

/* (v1.70) "Protect your account": optional 2FA enrolment right after the account was created — skip hands the new
   user to the app as is */
function EnrolScreen({ user, onAuthed }) {
  const { t } = useT();
  const skip = <button className="btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => onAuthed(user)}>{t("Skip for now")}</button>;
  return (
    <>
      <h2>{t("Protect your account")}</h2>
      <div className="auth-sub">{t("Your account is ready, {name}. You can set up two-factor authentication now — or skip it and enable it later under the key icon.").replace("{name}", user.name.split(" ")[0])}</div>
      <TwoFactorSetup onDone={onAuthed} startLabel={t("Set up 2FA now")} secretLabel={t("Or enter this key manually")} primaryStyle={{ flex: 1, justifyContent: "center" }}
        actions={({ primary }) => <div style={{ display: "flex", gap: 8 }}>{skip}{primary}</div>} />
    </>
  );
}

export function SecurityModalC({ me, onClose, onChanged }) {
  const { t } = useT();
  const { flash } = useToast();
  const [code, setCode] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const disable = async () => {
    setBusy(true); setErr(null);
    try { const j = await apiPost("/auth/2fa/disable", { code }); onChanged(j.user); } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  /* v1.67: change the own password (password accounts only — Entra / proxy identities manage it in the IdP) */
  const [pw, setPw] = useState({ current: "", next: "", repeat: "" });
  const [pwOpen, setPwOpen] = useState(false);
  const changePassword = async () => {
    setBusy(true); setErr(null);
    try {
      if (pw.next !== pw.repeat) throw new Error(t("The two passwords do not match"));
      await apiPost("/auth/password", { current: pw.current, password: pw.next });
      setPw({ current: "", next: "", repeat: "" }); setPwOpen(false); flash("Password changed — your other sessions were signed out");
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <Modal title={t("Security")} sub={`Signed in as ${me.name} (${me.email}) — role: ${me.role}.`} onClose={onClose}>
      {hasRole(me, "agent") && <AgentKeysC base="/auth/me/keys" revokeBase="/auth/me/keys" title={t("MCP keys for this agent account")} />}
      {!hasRole(me, "agent") && <ConnectedAppsC title={t("Connected MCP applications")} />}
      {err && <div className="notice notice-err"><AlertTriangle size={16} style={{ flexShrink: 0 }} /><span>{err}</span></div>}
      {me.passwordAuth && (
        <div className="panel" style={{ marginBottom: 14 }} data-testid="password-panel">
          <h3><KeyRound size={17} /> {t("Password")}</h3>
          {!pwOpen ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div className="modal-sub" style={{ margin: 0 }}>{t("Changing the password signs out every other session of your account.")}</div>
              <button className="btn btn-sm" onClick={() => { setErr(null); setPwOpen(true); }}>{t("Change password")}</button>
            </div>
          ) : (
            <>
              <Field label={t("Current password")}><input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" autoFocus /></Field>
              <div className="field-row">
                <Field label={t("New password (min. 8 characters)")}><input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></Field>
                <Field label={t("Repeat the new password")}><input type="password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} autoComplete="new-password" onKeyDown={(e) => e.key === "Enter" && changePassword()} /></Field>
              </div>
              <div className="modal-actions" style={{ marginTop: 0 }}>
                <button className="btn" onClick={() => setPwOpen(false)}>{t("Cancel")}</button>
                <button className="btn btn-primary" onClick={changePassword} disabled={busy || pw.next.length < 8 || !pw.current}>{busy ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />} {t("Save new password")}</button>
              </div>
            </>
          )}
        </div>
      )}
      {/* (v1.70) self-service 2FA enrolment — the shared flow; Close before it starts, Cancel once the secret exists */}
      {!me.totpEnabled && (
        <TwoFactorSetup onDone={onChanged} startLabel={t("Set up 2FA")} secretLabel={t("Manual entry key (Base32)")}
          beforeStart={<div className="modal-sub">{t("Two-factor authentication is off. With 2FA enabled, signing in additionally requires a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Aegis, 1Password …).")}</div>}
          intro={<div className="modal-sub">{t("Scan the QR code with your authenticator app (Google/Microsoft Authenticator, Aegis, 1Password …), or enter the key manually — then confirm with the current code.")}</div>}
          actions={({ started, primary }) => (
            <div className="modal-actions" style={started ? undefined : { justifyContent: "space-between" }}>
              <button className="btn" onClick={onClose}>{started ? t("Cancel") : t("Close")}</button>
              {primary}
            </div>
          )} />
      )}
      {me.totpEnabled && (
        <>
          <div className="notice notice-ok"><ShieldCheck size={16} /><span>{t("Two-factor authentication is enabled for this account.")}</span></div>
          <Field label={t("Enter a current code to disable 2FA")}>
            <input className="mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" inputMode="numeric" maxLength={6} />
          </Field>
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>{t("Close")}</button>
            <button className="btn btn-danger" onClick={disable} disabled={busy || code.length < 6}>
              {busy ? <Loader2 size={15} className="spin" /> : <X size={15} />} {t("Disable 2FA")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
