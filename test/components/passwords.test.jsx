/* v1.67 — password reset screen, "forgot password", change-password panel, admin reset link and invitation renewal */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { AuthGateC, SecurityModalC } from "../../src/components/auth.jsx";
import { UsersViewC } from "../../src/components/admin.jsx";
import { I18nProvider } from "../../src/i18n.jsx";
import { ToastStub } from "../helpers/toast.jsx";
import { routeFetch } from "../helpers/fetch.js";

afterEach(cleanup);
const calls = [];
const mockFetch = (routes) => routeFetch(routes, () => ({}), { calls });


describe("sign-in screen: reset link and forgot password", () => {
  it("sets a new password from ?reset=<token> and returns to the sign-in form with the e-mail prefilled", async () => {
    calls.length = 0;
    globalThis.fetch = mockFetch([[/\/auth\/reset-info/, () => ({ email: "pat@x.io" })], [/\/auth\/reset-password/, () => ({ ok: true, email: "pat@x.io" })], [/\/auth\/sso\/config/, () => ({ enabled: false, mode: "local" })]]);
    render(<I18nProvider><AuthGateC screen={{ mode: "reset", token: "tok123", mail: false }} onAuthed={() => {}} /></I18nProvider>);
    expect(await screen.findByText(/Choose a new password for pat@x.io/)).toBeTruthy();
    expect(screen.queryByLabelText("E-mail")).toBeNull();
    fireEvent.change(screen.getByLabelText("New password (min. 8 characters)"), { target: { value: "new-pass-123" } });
    fireEvent.change(screen.getByLabelText("Repeat the new password"), { target: { value: "new-pass-124" } });
    fireEvent.click(screen.getByRole("button", { name: /Save new password/ }));
    expect(await screen.findByText("The two passwords do not match")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Repeat the new password"), { target: { value: "new-pass-123" } });
    fireEvent.click(screen.getByRole("button", { name: /Save new password/ }));
    expect(await screen.findByTestId("auth-info")).toBeTruthy();
    expect(calls.find(([u]) => u.includes("/auth/reset-password"))[2]).toEqual({ token: "tok123", password: "new-pass-123" });
    expect(screen.getByLabelText("E-mail").value).toBe("pat@x.io");
    expect(screen.getByRole("button", { name: /Sign in$/ })).toBeTruthy();
    expect(screen.getByText(/An administrator can issue a reset link/)).toBeTruthy();   /* no SMTP → no self-service */
  });
  it("offers 'Forgot your password?' only when the server can mail, and posts the e-mail", async () => {
    calls.length = 0;
    globalThis.fetch = mockFetch([[/\/auth\/forgot/, () => ({ ok: true })], [/\/auth\/sso\/config/, () => ({ enabled: false, mode: "local" })]]);
    render(<I18nProvider><AuthGateC screen={{ mode: "login", mail: true }} onAuthed={() => {}} /></I18nProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Forgot your password?" }));
    expect(screen.queryByLabelText("Password")).toBeNull();
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "pat@x.io" } });
    fireEvent.click(screen.getByRole("button", { name: /Send reset link/ }));
    expect(await screen.findByText(/a reset link is on its way/)).toBeTruthy();
    expect(calls.find(([u]) => u.includes("/auth/forgot"))[2]).toEqual({ email: "pat@x.io" });
    expect(screen.getByLabelText("Password")).toBeTruthy();   /* back on the sign-in form */
  });
});

describe("security dialog: change password", () => {
  it("shows the panel for password accounts only and posts current + new password", async () => {
    calls.length = 0;
    globalThis.fetch = mockFetch([[/\/auth\/password/, () => ({ ok: true })], [/\/auth\/me\/apps|\/oauth/, () => ({ apps: [] })]]);
    const flash = vi.fn();
    const { unmount } = render(<I18nProvider><ToastStub flash={flash}><SecurityModalC me={{ id: "u1", name: "Pat", email: "pat@x.io", role: "guest", roles: ["guest"], passwordAuth: true }} onClose={() => {}} onChanged={() => {}} /></ToastStub></I18nProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Change password" }));
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "old-pass-123" } });
    fireEvent.change(screen.getByLabelText("New password (min. 8 characters)"), { target: { value: "new-pass-123" } });
    fireEvent.change(screen.getByLabelText("Repeat the new password"), { target: { value: "new-pass-123" } });
    fireEvent.click(screen.getByRole("button", { name: /Save new password/ }));
    await waitFor(() => expect(flash).toHaveBeenCalledWith(expect.stringMatching(/Password changed/)));
    expect(calls.find(([u]) => u.includes("/auth/password"))[2]).toEqual({ current: "old-pass-123", password: "new-pass-123" });
    unmount();
    render(<I18nProvider><SecurityModalC me={{ id: "u2", name: "Sam", email: "sam@x.io", role: "guest", roles: ["guest"], passwordAuth: false, sso: true }} onClose={() => {}} onChanged={() => {}} flash={flash} /></I18nProvider>);
    expect(screen.queryByTestId("password-panel")).toBeNull();
  });
});

describe("user management: reset links and invitations without stored links", () => {
  it("issues a reset link for a password account and renews / withdraws invitations", async () => {
    calls.length = 0;
    globalThis.fetch = mockFetch([
      [/\/admin\/users\/u2\/reset-password/, () => ({ link: "http://localhost/?reset=abc", mailed: false, mailError: null, hours: 24 })],
      [/\/admin\/invites\//, () => ({ ok: true })],
      [/\/admin\/invite$/, () => ({ link: "http://localhost/?invite=new", mailed: false })],
      [/\/admin\/users$/, () => ({ users: [{ id: "u2", name: "Pat", email: "pat@x.io", role: "guest", roles: ["guest"], passwordAuth: true }, { id: "u3", name: "Sam", email: "sam@x.io", role: "guest", roles: ["guest"], passwordAuth: false, sso: true }], invites: [{ email: "new@x.io", role: "guest", roles: ["guest"], expires: Date.now() + 864e5 }] })],
    ]);
    const me = { id: "u1", name: "Admin", email: "a@x.io", role: "admin", roles: ["admin"] };
    render(<I18nProvider><ToastStub><UsersViewC me={me} /></ToastStub></I18nProvider>);
    await screen.findByText("Pat");
    expect(screen.queryByLabelText("Reset password of Sam")).toBeNull();   /* Entra account: no password to reset */
    fireEvent.click(screen.getByLabelText("Reset password of Pat"));
    expect((await screen.findByTestId("reset-link")).textContent).toBe("http://localhost/?reset=abc");
    expect(screen.getByText(/hand this link over on a trusted channel/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1));
    /* the open invitation shows no link; renew posts a fresh invitation for the same e-mail and roles */
    expect(screen.queryByText(/\?invite=/)).toBeNull();
    fireEvent.click(screen.getByLabelText("Renew invitation for new@x.io"));
    await waitFor(() => expect(calls.find(([u, m]) => /\/admin\/invite$/.test(u) && m === "POST")?.[2]).toEqual({ email: "new@x.io", roles: ["guest"] }));
    expect(await screen.findByText("http://localhost/?invite=new")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Withdraw invitation for new@x.io"));
    await waitFor(() => expect(calls.some(([u, m]) => u.includes("/admin/invites/new%40x.io") && m === "DELETE")).toBe(true));
  });
});
