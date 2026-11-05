/* Password hashing (scrypt), session/invite tokens, TOTP (RFC 6238) and key hashing. */
import crypto from "crypto";

export const uid = () => crypto.randomBytes(8).toString("hex");
export const token = () => crypto.randomBytes(24).toString("base64url");
export const b64url = (buf) => Buffer.from(buf).toString("base64url");
export const keyHash = (k) => crypto.createHash("sha256").update(String(k)).digest("hex");
export const randomPassword = () => crypto.randomBytes(32).toString("base64url");

/* v1.66.1 (security review): scrypt with N=2^17 (OWASP), r=8, p=1, asynchronous (no event-loop stall); the parameters
   travel in the hash ("s2$N$salt$key") so they can be raised later; legacy "salt:key" hashes (N=2^14) still verify and
   are upgraded on the next successful login. */
const SCRYPT = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const scryptAsync = (pw, salt, N) => new Promise((resolve, reject) => crypto.scrypt(String(pw), salt, 64, { ...SCRYPT, N }, (e, k) => (e ? reject(e) : resolve(k))));
export const scryptHash = async (pw) => {
  const salt = crypto.randomBytes(16);
  return `s2$${SCRYPT.N}$${salt.toString("hex")}$${(await scryptAsync(pw, salt, SCRYPT.N)).toString("hex")}`;
};
export const scryptVerify = async (pw, stored) => {
  try {
    if (String(stored).startsWith("s2$")) { const [, n, s, k] = stored.split("$"); return crypto.timingSafeEqual(await scryptAsync(pw, Buffer.from(s, "hex"), Number(n)), Buffer.from(k, "hex")); }
    const [s, k] = String(stored).split(":");
    return crypto.timingSafeEqual(await scryptAsync(pw, Buffer.from(s, "hex"), 16384), Buffer.from(k, "hex"));
  } catch { return false; }
};
export const scryptNeedsUpgrade = (stored) => !String(stored || "").startsWith(`s2$${SCRYPT.N}$`);
/* a verify against a throw-away hash so unknown e-mails take as long as wrong passwords (no user enumeration by timing).
   v1.73 (F-S13): the hash is computed on first use — importing crypto.js no longer runs a 128 MB scrypt in every process */
let dummy = null;
export const scryptDummy = async () => { dummy ??= scryptHash("dummy"); await scryptVerify("x", await dummy); return false; };

/* TOTP (RFC 6238) */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const b32encode = (buf) => {
  let bits = 0, val = 0, out = "";
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += B32[(val << (5 - bits)) & 31];
  return out;
};
export const b32decode = (str) => {
  let bits = 0, val = 0; const out = [];
  for (const c of String(str).replace(/=+$/, "").toUpperCase()) {
    const i = B32.indexOf(c); if (i < 0) continue;
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
};
export const totpAt = (secretB32, counter) => {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", b32decode(secretB32)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  return String(((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3])) % 1e6).padStart(6, "0");
};
/* the matching time-step counter (±1 step) or null — a counter at or below `lastCounter` is a replay (v1.66.1) */
export const totpMatch = (secret, code, lastCounter = null) => {
  const c = Math.floor(Date.now() / 1000 / 30), want = String(code || "").trim();
  if (!/^\d{6}$/.test(want)) return null;
  for (const s of [-1, 0, 1]) { const ctr = c + s; if (totpAt(secret, ctr) === want) return lastCounter !== null && lastCounter !== undefined && ctr <= Number(lastCounter) ? null : ctr; }
  return null;
};
export const totpValid = (secret, code, lastCounter = null) => totpMatch(secret, code, lastCounter) !== null;
export const newTotpSecret = () => b32encode(crypto.randomBytes(20));

/* v1.66.1: secrets at rest. With SECRETS_KEY set, stored credentials (sync profile tokens / client secrets, the Entra
   client secret) are sealed with AES-256-GCM ("enc:v1:<iv>:<tag>:<ciphertext>", base64url); without the key they are
   stored as before. Reading accepts both forms, so the key can be introduced (and secrets re-saved) at any time. */
const secretsKey = () => (process.env.SECRETS_KEY ? crypto.createHash("sha256").update(String(process.env.SECRETS_KEY)).digest() : null);
export const sealSecret = (plain) => {
  const key = secretsKey();
  if (!key || !plain || String(plain).startsWith("enc:v1:")) return plain;
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return `enc:v1:${iv.toString("base64url")}:${c.getAuthTag().toString("base64url")}:${ct.toString("base64url")}`;
};
export const openSecret = (stored) => {
  if (!stored || !String(stored).startsWith("enc:v1:")) return stored;
  const key = secretsKey();
  if (!key) throw new Error("A stored secret is encrypted but SECRETS_KEY is not set");
  const [, , iv, tag, ct] = String(stored).split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
};
export const secretsSealed = () => !!process.env.SECRETS_KEY;
