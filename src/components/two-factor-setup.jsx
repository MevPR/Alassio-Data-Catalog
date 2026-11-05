import { useState, useEffect } from "react";
import { ShieldCheck, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import QRCode from "qrcode";
import { apiPost } from "../lib/api.js";
import { Field } from "./ui.jsx";
import { useT } from "../i18n.jsx";

/* (v1.70) Shared TOTP enrolment flow: start → QR code + manual key → verify a code → onDone(user).
   Used by the sign-in gate (freshly created account: "Set up 2FA now" / "Skip for now") and by the Security modal
   (self-service: "Set up 2FA" / "Close" / "Cancel"). The two screens differ only in texts and button layout, which the
   caller supplies:
     onDone(user)                  the user returned by /auth/2fa/enable (totpEnabled: true)
     startLabel                    label of the start button
     secretLabel                   label of the manual-entry key field
     beforeStart                   optional node above the start button (intro text)
     intro                         optional node above the QR code once enrolment has started
     actions({ started, primary })  renders the button row around the primary button (the caller adds its secondary
                                   button and layout); without it the primary button is rendered on its own
     primaryStyle                  inline style of the primary buttons (the gate stretches them with flex: 1)
   Errors (setup or a rejected code) are shown above the flow. The server issues no recovery codes
   (see server/routes/auth.js), so none are displayed. */
export function TwoFactorSetup({ onDone, startLabel, secretLabel, beforeStart = null, intro = null, actions, primaryStyle }) {
  const { t } = useT();
  const [setup, setSetup] = useState(null);   /* { secret, otpauth } once started */
  const [qr, setQr] = useState(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (setup?.otpauth) QRCode.toDataURL(setup.otpauth, { width: 190, margin: 1 }).then(setQr).catch(() => setQr(null));
    else setQr(null);
  }, [setup]);

  const start = async () => {
    setBusy(true); setErr(null);
    try { setSetup(await apiPost("/auth/2fa/setup", {})); } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const enable = async () => {
    setBusy(true); setErr(null);
    try { const j = await apiPost("/auth/2fa/enable", { code }); onDone(j.user); } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const row = (started, primary) => actions ? actions({ started, primary }) : primary;

  return (
    <>
      {err && <div className="notice notice-err"><AlertTriangle size={16} style={{ flexShrink: 0 }} /><span>{err}</span></div>}
      {!setup ? (
        <>
          {beforeStart}
          {row(false, (
            <button className="btn btn-primary" style={primaryStyle} onClick={start} disabled={busy}>
              {busy ? <Loader2 size={15} className="spin" /> : <ShieldCheck size={15} />} {startLabel}
            </button>
          ))}
        </>
      ) : (
        <>
          {intro}
          {qr && <div style={{ textAlign: "center", marginBottom: 12 }}><img src={qr} alt="QR code — scan with your authenticator app" style={{ borderRadius: 8, border: "1px solid var(--line)" }} /></div>}
          <Field label={secretLabel}><div className="secret-box">{setup.secret}</div></Field>
          <Field label={t("Code from your authenticator")}>
            <input className="mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" inputMode="numeric" maxLength={6} autoFocus onKeyDown={(e) => e.key === "Enter" && enable()} />
          </Field>
          {row(true, (
            <button className="btn btn-primary" style={primaryStyle} onClick={enable} disabled={busy || code.length < 6}>
              {busy ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />} Verify &amp; enable
            </button>
          ))}
        </>
      )}
    </>
  );
}
