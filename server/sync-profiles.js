/* Unity Catalog sync profiles (v1.70 — moved out of uc-sync.js so that uc-sync.js and uc-writeback.js both depend on
   this module instead of on each other): the profile store (setting sync.profiles, secrets sealed with SECRETS_KEY),
   validation on save, run / write-back bookkeeping, and the Databricks access helpers (bearer token, workspace-host
   allow-list). No catalog logic here. */
import { hourly, dailyAt } from "./schedule.js";
import crypto from "crypto";
import { sealSecret, openSecret } from "./crypto.js";
import { getSetting, setSetting } from "./settings.js";
import { databricksToken, databricksHost } from "./databricks-auth.js";
import { systemActor } from "./config.js";

export const SYSTEM = systemActor("Unity Catalog sync");
export const MASK = "••••••••";
export const PROFILE_DEFAULT = { name: "", host: "", catalog: "", hubId: "central", country: "GLOBAL", layer: "", mode: "report", schedule: "manual", time: "03:00", deleteMissing: false, lineage: false, updateTypes: true,
  /* v1.66: one SQL warehouse per profile — governance tags on import (importTags) and tags / column comments on write-back */
  warehouseId: "", importTags: true,
  auth: { type: "pat", token: "", clientId: "", clientSecret: "" }, enabled: true, lastRun: null,
  /* v1.64: server-side write-back of catalog metadata to Unity Catalog after each run (see uc-writeback-run.js) */
  writeBack: { enabled: false, comments: true, roles: true, columns: true, owner: false, warehouseId: "" }, lastWriteBack: null };
export const WRITEBACK_DEFAULT = PROFILE_DEFAULT.writeBack;

/* ── profiles (setting sync.profiles) ── */
const openAuth = (a = {}) => ({ ...PROFILE_DEFAULT.auth, ...a, token: openSecret(a.token || ""), clientSecret: openSecret(a.clientSecret || "") });
const sealAuth = (a = {}) => ({ ...a, token: sealSecret(a.token || ""), clientSecret: sealSecret(a.clientSecret || "") });
export const syncProfiles = async () => ((await getSetting("sync.profiles", [])) || []).map((p) => ({ ...PROFILE_DEFAULT, ...p, warehouseId: p.warehouseId || p.writeBack?.warehouseId || "", auth: openAuth(p.auth), writeBack: { ...WRITEBACK_DEFAULT, ...(p.writeBack || {}) } }));
/* v1.66.1: secrets are sealed with SECRETS_KEY before they reach the settings table (and therefore the SQL backups) */
const storeProfiles = (list, by) => setSetting("sync.profiles", list.map((p) => ({ ...p, auth: sealAuth(p.auth) })), by);
/* the warehouse a profile uses for SQL (tags): the profile's own, or the legacy writeBack.warehouseId of v1.64 */
export const warehouseOf = (p) => p.warehouseId || p.writeBack?.warehouseId || "";
export const publicProfile = (p) => ({ ...p, auth: { type: p.auth.type, token: p.auth.token ? MASK : "", clientId: p.auth.clientId || "", clientSecret: p.auth.clientSecret ? MASK : "", hasToken: !!p.auth.token, hasSecret: !!p.auth.clientSecret } });
export const saveProfile = async (body, by) => {
  const all = await syncProfiles();
  const cur = all.find((p) => p.id === body?.id) || { ...PROFILE_DEFAULT, id: crypto.randomUUID(), auth: { ...PROFILE_DEFAULT.auth } };
  const b = body || {};
  const next = { ...cur,
    name: String(b.name ?? cur.name).trim().slice(0, 120), host: String(b.host ?? cur.host).trim().replace(/^https:\/\//, "").replace(/\/$/, ""), catalog: String(b.catalog ?? cur.catalog).trim(),
    hubId: String(b.hubId ?? cur.hubId), country: String((b.country ?? cur.country) || "GLOBAL").toUpperCase().slice(0, 16), layer: ["", "bronze", "silver", "gold", "other"].includes(b.layer) ? b.layer : cur.layer,
    mode: b.mode === undefined ? cur.mode : (b.mode === "apply" ? "apply" : "report"), schedule: ["manual", "hourly", "daily"].includes(b.schedule) ? b.schedule : cur.schedule, time: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.time)) ? b.time : cur.time,
    deleteMissing: !!(b.deleteMissing ?? cur.deleteMissing), lineage: !!(b.lineage ?? cur.lineage), updateTypes: b.updateTypes === undefined ? cur.updateTypes : !!b.updateTypes, enabled: b.enabled === undefined ? cur.enabled : !!b.enabled,
    warehouseId: b.warehouseId === undefined ? (b.writeBack?.warehouseId !== undefined ? String(b.writeBack.warehouseId).trim().slice(0, 64) : cur.warehouseId) : String(b.warehouseId).trim().slice(0, 64), importTags: b.importTags === undefined ? cur.importTags : !!b.importTags,
    auth: { type: ["pat", "sp", "app"].includes(b.auth?.type) ? b.auth.type : cur.auth.type,
      token: b.auth?.token && b.auth.token !== MASK ? String(b.auth.token) : cur.auth.token,
      clientId: b.auth?.clientId !== undefined ? String(b.auth.clientId).trim() : cur.auth.clientId,
      clientSecret: b.auth?.clientSecret && b.auth.clientSecret !== MASK ? String(b.auth.clientSecret) : cur.auth.clientSecret },
    writeBack: b.writeBack === undefined ? cur.writeBack : { enabled: !!b.writeBack.enabled, comments: b.writeBack.comments === undefined ? cur.writeBack.comments : !!b.writeBack.comments, roles: b.writeBack.roles === undefined ? cur.writeBack.roles : !!b.writeBack.roles,
      columns: b.writeBack.columns === undefined ? cur.writeBack.columns : !!b.writeBack.columns, owner: b.writeBack.owner === undefined ? cur.writeBack.owner : !!b.writeBack.owner, warehouseId: b.writeBack.warehouseId === undefined ? cur.writeBack.warehouseId : String(b.writeBack.warehouseId).trim().slice(0, 64) } };
  if (!next.name || !next.catalog) throw Object.assign(new Error("Name and catalog are required"), { status: 400 });
  if (next.auth.type !== "app" && !next.host) throw Object.assign(new Error("Workspace host is required"), { status: 400 });
  if (next.auth.type !== "app") assertWorkspaceHost(next.host);
  /* v1.66.1: a changed host never reuses the secrets stored for the old one */
  if (all.some((p) => p.id === next.id) && cur.host && next.host !== cur.host) { if (!(b.auth?.token && b.auth.token !== MASK)) next.auth.token = ""; if (!(b.auth?.clientSecret && b.auth.clientSecret !== MASK)) next.auth.clientSecret = ""; }
  if (next.auth.type === "pat" && !next.auth.token) throw Object.assign(new Error("A personal access token is required for token authentication"), { status: 400 });
  if (next.auth.type === "sp" && (!next.auth.clientId || !next.auth.clientSecret)) throw Object.assign(new Error("Client ID and secret are required for a service principal"), { status: 400 });
  const list = all.some((p) => p.id === next.id) ? all.map((p) => (p.id === next.id ? next : p)) : [...all, next];
  await storeProfiles(list, by);
  return next;
};
export const deleteProfile = async (id, by) => { const all = await syncProfiles(); await storeProfiles(all.filter((p) => p.id !== id), by); return all.length !== all.filter((p) => p.id !== id).length; };
export const recordRun = async (id, lastRun) => { const all = await syncProfiles(); await storeProfiles(all.map((p) => (p.id === id ? { ...p, lastRun } : p)), SYSTEM); };
export const recordWriteBack = async (id, lastWriteBack) => { const all = await syncProfiles(); await storeProfiles(all.map((p) => (p.id === id ? { ...p, lastWriteBack } : p)), SYSTEM); };

/* ── Databricks access ── */
export const bearerFor = async (p) => {
  if (p.auth.type === "pat") return p.auth.token;
  if (p.auth.type === "sp") return databricksToken({ host: p.host, clientId: p.auth.clientId, clientSecret: p.auth.clientSecret });
  return databricksToken();   /* the app's own service principal (Databricks Apps) */
};
/* v1.66.1 (security review): a profile may only point at a Databricks workspace — otherwise an admin could send the app's
   own service-principal token or another admin's stored PAT to an arbitrary host. Allowed: the known Databricks domains,
   DATABRICKS_HOST itself and the hosts listed in DATABRICKS_ALLOWED_HOSTS (comma-separated, e.g. a test double). */
const DBX_DOMAINS = /\.(azuredatabricks\.net|cloud\.databricks\.com|gcp\.databricks\.com|databricks\.azure\.us|databricks\.azure\.cn)$/i;
const hostnameOf = (h) => { try { return new URL(databricksHost(h)).host.toLowerCase(); } catch { return ""; } };
export const workspaceHostAllowed = (host) => {
  const h = hostnameOf(host); if (!h) return false;
  const bare = h.replace(/:\d+$/, "");
  if (DBX_DOMAINS.test(bare)) return true;
  if (process.env.DATABRICKS_HOST && h === hostnameOf(process.env.DATABRICKS_HOST)) return true;
  return String(process.env.DATABRICKS_ALLOWED_HOSTS || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean).some((x) => x === h || x === bare);
};
export const assertWorkspaceHost = (host) => { if (!workspaceHostAllowed(host)) throw Object.assign(new Error("Workspace host is not a Databricks workspace (allowed: *.azuredatabricks.net, *.cloud.databricks.com, *.gcp.databricks.com, DATABRICKS_HOST, DATABRICKS_ALLOWED_HOSTS)"), { status: 400 }); };
/* the app's own identity always talks to its own workspace — a profile host never redirects that token elsewhere */
export const hostOf = (p) => { const h = p.auth.type === "app" ? process.env.DATABRICKS_HOST : p.host; assertWorkspaceHost(h); return databricksHost(h); };

/* the profiles the scheduler should run now (hourly, or daily at their time; never manual or disabled ones) */
export const dueProfiles = (profiles, now = new Date()) => profiles.filter((p) => {
  if (!p.enabled || p.schedule === "manual") return false;
  const last = p.lastRun?.at || 0;
  return p.schedule === "hourly" ? hourly(now, last) : dailyAt(p.time, now, last);   /* v1.74: the shared rules of server/schedule.js */
});
/* the human-readable schedule of the profiles, for the task list ("manual" when no profile runs on its own) */
export const profileSchedules = (profiles) => {
  const on = profiles.filter((p) => p.enabled && p.schedule !== "manual");
  return on.length ? on.map((p) => `${p.name}: ${p.schedule === "daily" ? `daily ${p.time}` : "hourly"}`).join(", ") : "manual";
};
