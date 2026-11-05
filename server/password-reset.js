/* Password rules and reset links (v1.70 — moved out of routes/auth.js so routes/admin-users.js no longer imports a
   route module). issuePasswordReset() stores only the hash of the reset token; mailPasswordReset() sends the link when
   SMTP is configured and reports whether it did. */
import { q } from "./db.js";
import { token } from "./crypto.js";
import { tokenHash } from "./auth.js";
import { mailEnabled, sendMail } from "./mail.js";
import { APP_URL } from "./config.js";

export const PASSWORD_MIN = 8, PASSWORD_MAX = 200, RESET_HOURS = 24;
export const passwordProblem = (pw) => typeof pw !== "string" || pw.length < PASSWORD_MIN ? `A password of at least ${PASSWORD_MIN} characters is required` : pw.length > PASSWORD_MAX ? `The password may have at most ${PASSWORD_MAX} characters` : null;
/* issues a reset link for a user (admin action or "forgot password"); only the hash of the token is stored */
export const issuePasswordReset = async (user, by = null) => {
  const t = token(), expires = Date.now() + RESET_HOURS * 3600e3;
  await q("DELETE FROM password_resets WHERE user_id = ? OR expires < ?", [user.id, Date.now()]);
  await q("INSERT INTO password_resets (token,user_id,expires,created_by,created_ts) VALUES (?,?,?,?,?)", [tokenHash(t), user.id, expires, by?.id || null, Date.now()]);
  return { link: `${APP_URL}/?reset=${t}`, expires };
};
export const mailPasswordReset = async (user, link, byName = null) => {
  if (!mailEnabled()) return { mailed: false, mailError: null };
  try {
    await sendMail({ to: user.email, subject: "Password reset — Alassio Data Catalog", text: `${byName ? `${byName} issued a password reset for your Alassio Data Catalog account.` : "You asked for a password reset for your Alassio Data Catalog account."}\n\nSet a new password within ${RESET_HOURS} hours:\n${link}\n\nIf you did not expect this e-mail you can ignore it — your password stays unchanged.\n` });
    return { mailed: true, mailError: null };
  } catch (e) { return { mailed: false, mailError: e.message }; }
};

