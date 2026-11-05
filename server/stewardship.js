/* Stewardship reminders (v1.56): once a day the lite catalog is scanned for due reviews and ownership attestations;
   the responsible people (matched to accounts by e-mail) get an in-app message (and e-mail when SMTP is configured),
   at most every policy.remindEveryDays per object. The policy lives in the settings table. */
import { emailSet } from "./users.js";
import { getSetting, setSetting } from "./settings.js";
import { assembleLite } from "./catalog-store.js";
import { notifyI18n } from "./mail.js";
import { systemActor } from "./config.js";
import { accountEmailOf, entityPath } from "./people.js";
import { daily } from "./schedule.js";
import { effOwnerId, effStewardId, catalogIndex } from "../permissions.js";
import { DEFAULT_POLICY, reviewStatus, attestationDue, nextReviewAt } from "../src/lib/stewardship.js";

const SYSTEM = systemActor("Stewardship reminders");
export const stewardshipPolicy = async () => ({ ...DEFAULT_POLICY, ...((await getSetting("stewardship.policy", {})) || {}) });
export const saveStewardshipPolicy = async (patch, user) => {
  const cur = await stewardshipPolicy();
  const next = { ...cur, ...patch };
  for (const k of ["attestDays", "remindEveryDays", "soonDays"]) next[k] = Math.max(k === "soonDays" ? 0 : 1, Math.min(3650, Number(next[k]) || DEFAULT_POLICY[k]));
  await setSetting("stewardship.policy", next, user);
  return next;
};

/* sends the reminders that are due; returns { reviews, attestations, messages } */
export const sendStewardshipReminders = async ({ force = false, now = Date.now() } = {}) => {
  const policy = await stewardshipPolicy();
  const { catalog: c } = await assembleLite();
  if (!c) return { reviews: 0, attestations: 0, messages: 0 };
  const ix = catalogIndex(c);
  const reminded = (await getSetting("stewardship.reminded", {})) || {};
  const accounts = await emailSet();
  const emailOfPerson = (pid) => accountEmailOf(c, pid, accounts);
  const due = (key) => force || !reminded[key] || now - reminded[key] > policy.remindEveryDays * 86400000;
  const perEmail = new Map();   /* email → { reviews: [], attestations: [] } */
  const add = (email, kind, line) => { if (!email) return; if (!perEmail.has(email)) perEmail.set(email, { reviews: [], attestations: [] }); perEmail.get(email)[kind].push(line); };
  let reviews = 0, attestations = 0;
  for (const t of c.tables || []) {
    const st = reviewStatus(t, now, policy.soonDays);
    if (!["due", "overdue"].includes(st) || !due(`review:${t.id}`)) continue;
    const emails = [emailOfPerson(effStewardId(c, "table", t.id, ix)), emailOfPerson(effOwnerId(c, "table", t.id, ix))].filter(Boolean);
    if (!emails.length) continue;
    reviews++; reminded[`review:${t.id}`] = now;
    for (const e of new Set(emails)) add(e, "reviews", { id: t.id, path: entityPath(c, "table", t.id, ix), status: st, nextAt: nextReviewAt(t) });
  }
  for (const [kind, key] of [["table", "tables"], ["schema", "schemas"], ["database", "databases"], ["domain", "domains"]]) {
    for (const o of c[key] || []) {
      if (!attestationDue(o, policy.attestDays, now) || !due(`attest:${o.id}`)) continue;
      const e = emailOfPerson(o.ownerId); if (!e) continue;
      attestations++; reminded[`attest:${o.id}`] = now;
      add(e, "attestations", { id: o.id, kind, path: entityPath(c, kind, o.id, ix), lastAt: o.ownerAttestedAt || null });
    }
  }
  let messages = 0;
  for (const [email, x] of perEmail) {
    messages += await notifyI18n([email], "Alassio Data Catalog", "stewardship_reminder", { reviews: x.reviews, attestations: x.attestations }, { tableId: x.reviews[0]?.id || null });
  }
  /* forget entries of objects that no longer exist */
  const live = new Set([...(c.tables || []), ...(c.schemas || []), ...(c.databases || []), ...(c.domains || [])].map((o) => o.id));
  for (const k of Object.keys(reminded)) if (!live.has(k.split(":")[1])) delete reminded[k];
  await setSetting("stewardship.reminded", reminded, SYSTEM);
  return { reviews, attestations, messages };
};


/* registered as task "stewardship-reminders" by server.js (v1.70) */
export const STEWARDSHIP_REMINDER_TASK = { description: "Review / ownership-attestation reminders to the responsible people", schedule: "daily", run: async (user, body) => sendStewardshipReminders({ force: !!body?.force }),
  /* v1.73 (F-S9, server/tasks.js scheduler); v1.74: once per local calendar day (server/schedule.js) */
  due: daily, actor: SYSTEM,
  logLine: (r) => (r.messages ? `Stewardship reminders: ${r.messages} message(s) (${r.reviews} reviews, ${r.attestations} attestations)` : null) };
