/* In-app messages for every user plus an optional e-mail copy via SMTP. */
import crypto from "crypto";
import { q } from "./db.js";
import { APP_URL, parseRoles } from "./config.js";
import { renderMessage, langsOf } from "./i18n.js";

let mailer = null;
if (process.env.SMTP_HOST) {
  const nodemailer = (await import("nodemailer")).default;
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}
export const mailEnabled = () => !!mailer;
export const sendMail = (opts) => mailer ? mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, ...opts }) : Promise.resolve(null);

/* stores one message per recipient and mails a copy when SMTP is configured; returns the number of recipients */
export const notify = async (toEmails, fromName, subject, body, { requestId = null, tableId = null } = {}) => {
  const uniq = [...new Set(toEmails.filter(Boolean).map((e) => String(e).toLowerCase()))];
  for (const to of uniq) {
    await q("INSERT INTO messages (id, to_email, from_name, subject, body, request_id, table_id, ts) VALUES (?,?,?,?,?,?,?,?)",
      [crypto.randomUUID(), to, fromName, subject.slice(0, 500), body.slice(0, 8000), requestId, tableId, Date.now()]);
    if (mailer) { try { await sendMail({ to, subject: `[Alassio Data Catalog] ${subject}`, text: `${body}\n\n${APP_URL}` }); } catch { } }
  }
  return uniq.length;
};
/* localised notification (v1.57): the message is rendered per recipient in the language of the account */
export const notifyI18n = async (toEmails, fromName, key, params, opts = {}) => {
  const langs = await langsOf(toEmails);
  let n = 0;
  for (const [email, lang] of Object.entries(langs)) {
    const { subject, body } = renderMessage(key, lang, params);
    n += await notify([email], fromName, subject, body, opts);
  }
  return n;
};
export const emailsByRole = async (role) => (await q("SELECT email, role, roles FROM users")).filter((u) => u.role === role || parseRoles(u).includes(role)).map((r) => r.email);
export const messageRow = (m) => ({ id: m.id, fromName: m.from_name, subject: m.subject, body: m.body, requestId: m.request_id, tableId: m.table_id, ts: Number(m.ts), read: !!m.read_ts });
