/* v1.70 — the sign-in gate's single screen discriminator (Clean Code review F-F8) */
import { describe, it, expect } from "vitest";
import { screenFor, headlineScreen, hasCredentialsForm, AUTH_SCREENS } from "../../src/lib/auth-screens.js";

describe("auth screens: screenFor", () => {
  it("passes the entry screens through unchanged", () => {
    for (const m of ["login", "bootstrap", "invite", "reset", "header", "forgot"]) expect(screenFor(m)).toBe(m);
  });
  it("falls back to the sign-in form for unknown modes", () => {
    expect(screenFor(undefined)).toBe("login"); expect(screenFor("nonsense")).toBe("login");
    /* the derived screens are never valid modes — they come from the flags only */
    for (const s of ["totp", "sso-enforced", "enrol"]) expect(screenFor(s)).toBe("login");
  });
  it("hides the password form while SSO is enforced — until break-glass sign-in is requested", () => {
    expect(screenFor("login", { ssoEnforced: true })).toBe("sso-enforced");
    expect(screenFor("login", { ssoEnforced: true, breakGlass: true })).toBe("login");
    expect(screenFor("login", { ssoEnforced: true, breakGlass: true, need2fa: true })).toBe("totp");
    /* enforcement only concerns the sign-in form, never the other entry screens */
    expect(screenFor("bootstrap", { ssoEnforced: true })).toBe("bootstrap");
    expect(screenFor("reset", { ssoEnforced: true })).toBe("reset");
    expect(screenFor("forgot", { ssoEnforced: true })).toBe("forgot");
  });
  it("asks for the authenticator code on the sign-in form only", () => {
    expect(screenFor("login", { need2fa: true })).toBe("totp");
    expect(screenFor("forgot", { need2fa: true })).toBe("forgot");
    /* enforced SSO wins over the code prompt (the prompt can only appear after a password sign-in anyway) */
    expect(screenFor("login", { need2fa: true, ssoEnforced: true })).toBe("sso-enforced");
  });
  it("2FA enrolment of a freshly created account beats every other screen", () => {
    expect(screenFor("bootstrap", { enrolling: true })).toBe("enrol");
    expect(screenFor("invite", { enrolling: true, ssoEnforced: true })).toBe("enrol");
    expect(screenFor("login", { enrolling: true, need2fa: true })).toBe("enrol");
  });
  it("only ever returns a known screen id", () => {
    const flags = [false, true];
    for (const m of ["login", "bootstrap", "invite", "reset", "header", "forgot", "x"])
      for (const enrolling of flags) for (const ssoEnforced of flags) for (const breakGlass of flags) for (const need2fa of flags)
        expect(AUTH_SCREENS).toContain(screenFor(m, { enrolling, ssoEnforced, breakGlass, need2fa }));
  });
});

describe("auth screens: helpers", () => {
  it("totp and sso-enforced share the sign-in headline", () => {
    expect(headlineScreen("totp")).toBe("login"); expect(headlineScreen("sso-enforced")).toBe("login");
    for (const s of ["login", "forgot", "reset", "bootstrap", "invite", "header", "enrol"]) expect(headlineScreen(s)).toBe(s);
  });
  it("the credentials form is rendered on every screen but the notice-only and enrolment ones", () => {
    for (const s of ["login", "totp", "forgot", "reset", "bootstrap", "invite"]) expect(hasCredentialsForm(s)).toBe(true);
    for (const s of ["header", "sso-enforced", "enrol"]) expect(hasCredentialsForm(s)).toBe(false);
  });
});
