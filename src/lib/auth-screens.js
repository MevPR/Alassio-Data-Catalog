/* (v1.70) Sign-in gate screens — one discriminator instead of `mode` + `screen.mode` + implicit flags.
   The session hook decides the entry screen from the auth status and the query string (login | bootstrap | invite |
   reset | header, see src/hooks/use-session.js); the gate then moves between "login" and "forgot" itself and overlays
   the SSO-enforced, authenticator-code and enrolment screens from its own state. `screenFor` folds all of that into
   exactly one screen id, so the gate renders one component per screen. */

export const AUTH_SCREENS = ["login", "sso-enforced", "totp", "forgot", "reset", "bootstrap", "invite", "header", "enrol"];

/* the forms the gate can be in: the entry screens plus "forgot" (reached from the sign-in form) */
const FORM_MODES = ["login", "bootstrap", "invite", "reset", "header", "forgot"];

/* screens that share the "Sign in" headline */
const LOGIN_FAMILY = { "sso-enforced": "login", totp: "login" };

/* `mode`: the gate's current form (an entry screen or "forgot"); the flags are the gate's state.
   Precedence: 2FA enrolment of a freshly created account beats everything; on the sign-in form an enforced SSO hides the
   password form until break-glass is requested, and a pending authenticator code turns it into the "totp" screen. */
export function screenFor(mode, { enrolling = false, ssoEnforced = false, breakGlass = false, need2fa = false } = {}) {
  if (enrolling) return "enrol";
  if (mode === "login") {
    if (ssoEnforced && !breakGlass) return "sso-enforced";
    if (need2fa) return "totp";
    return "login";
  }
  return FORM_MODES.includes(mode) ? mode : "login";
}

/* the screen whose headline/sub-headline applies (totp and sso-enforced reuse the sign-in texts) */
export const headlineScreen = (screen) => LOGIN_FAMILY[screen] || screen;

/* screens that render the password/credentials form (everything but the notice-only and enrolment screens) */
export const hasCredentialsForm = (screen) => !["header", "sso-enforced", "enrol"].includes(screen);
