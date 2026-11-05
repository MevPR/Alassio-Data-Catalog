/* v1.72 (F-S15): server/password-reset.js — password rules, reset links stored hashed, mail outcome with/without SMTP */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sql = vi.hoisted(() => []);
const mail = vi.hoisted(() => ({ enabled: false, fail: null, sent: [] }));
vi.mock("../../server/db.js", () => ({ q: vi.fn(async (s, p = []) => { sql.push([s, p]); return []; }), pool: {}, sql: {}, DRIVER: "mariadb", isPostgres: false }));
vi.mock("../../server/mail.js", () => ({
  mailEnabled: () => mail.enabled,
  sendMail: vi.fn(async (opts) => { if (mail.fail) throw new Error(mail.fail); mail.sent.push(opts); return { messageId: "m1" }; }),
}));

const { passwordProblem, issuePasswordReset, mailPasswordReset, PASSWORD_MIN, PASSWORD_MAX, RESET_HOURS } = await import("../../server/password-reset.js");
const { tokenHash } = await import("../../server/auth.js");
const { APP_URL } = await import("../../server/config.js");

beforeEach(() => { sql.length = 0; mail.enabled = false; mail.fail = null; mail.sent = []; });

describe("passwordProblem", () => {
  it("accepts PASSWORD_MIN..PASSWORD_MAX characters and explains everything else", () => {
    expect(passwordProblem("x".repeat(PASSWORD_MIN))).toBe(null);
    expect(passwordProblem("x".repeat(PASSWORD_MAX))).toBe(null);
    expect(passwordProblem("x".repeat(PASSWORD_MIN - 1))).toMatch(/at least 8 characters/);
    expect(passwordProblem("x".repeat(PASSWORD_MAX + 1))).toMatch(/at most 200 characters/);
    for (const v of [undefined, null, 12345678, ["12345678"]]) expect(passwordProblem(v)).toMatch(/at least/);
  });
});

describe("issuePasswordReset", () => {
  it("deletes the user's old and all expired links, stores only the hash of the token and returns the plain link", async () => {
    const before = Date.now();
    const { link, expires } = await issuePasswordReset({ id: "u1" }, { id: "admin-1" });
    expect(sql).toHaveLength(2);
    const [del, ins] = sql;
    expect(del[0]).toBe("DELETE FROM password_resets WHERE user_id = ? OR expires < ?");
    expect(del[1][0]).toBe("u1"); expect(del[1][1]).toBeGreaterThanOrEqual(before);
    expect(ins[0]).toMatch(/^INSERT INTO password_resets \(token,user_id,expires,created_by,created_ts\)/);
    const t = link.slice(`${APP_URL}/?reset=`.length);
    expect(link.startsWith(`${APP_URL}/?reset=`)).toBe(true);
    expect(t.length).toBeGreaterThan(20);
    expect(ins[1][0]).toBe(tokenHash(t));       /* the hash goes to the database … */
    expect(ins[1][0]).not.toBe(t);              /* … never the token itself */
    expect(ins[1][0]).toMatch(/^[0-9a-f]{64}$/);
    expect(ins[1].slice(1, 4)).toEqual(["u1", expires, "admin-1"]);
    expect(expires - before).toBeGreaterThanOrEqual(RESET_HOURS * 3600e3);
    expect(expires - Date.now()).toBeLessThanOrEqual(RESET_HOURS * 3600e3);
  });
  it("a self-service reset has no creator, and every link carries a fresh token", async () => {
    const a = await issuePasswordReset({ id: "u2" });
    const b = await issuePasswordReset({ id: "u2" });
    expect(sql[1][1][3]).toBe(null);
    expect(a.link).not.toBe(b.link);
  });
});

describe("mailPasswordReset", () => {
  const user = { email: "ada@x.io" };
  it("without SMTP nothing is sent and the caller learns it (the link is shown instead)", async () => {
    expect(await mailPasswordReset(user, "http://l/?reset=t")).toEqual({ mailed: false, mailError: null });
    expect(mail.sent).toHaveLength(0);
  });
  it("with SMTP the link is mailed to the account — worded for self-service or an admin action", async () => {
    mail.enabled = true;
    expect(await mailPasswordReset(user, "http://l/?reset=t1")).toEqual({ mailed: true, mailError: null });
    expect(await mailPasswordReset(user, "http://l/?reset=t2", "Ada Admin")).toEqual({ mailed: true, mailError: null });
    expect(mail.sent.map((m) => m.to)).toEqual(["ada@x.io", "ada@x.io"]);
    expect(mail.sent[0].subject).toBe("Password reset — Alassio Data Catalog");
    expect(mail.sent[0].text).toMatch(/You asked for a password reset/); expect(mail.sent[0].text).toContain("http://l/?reset=t1");
    expect(mail.sent[1].text).toMatch(/^Ada Admin issued a password reset/); expect(mail.sent[1].text).toContain(`within ${RESET_HOURS} hours`);
  });
  it("an SMTP failure is reported, not thrown", async () => {
    mail.enabled = true; mail.fail = "connection refused";
    expect(await mailPasswordReset(user, "http://l/?reset=t")).toEqual({ mailed: false, mailError: "connection refused" });
  });
});
