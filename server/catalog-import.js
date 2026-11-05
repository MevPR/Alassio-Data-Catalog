/* Server-side application of imports that used to be computed in the browser (v1.66, PLAN.md "frontend → backend"):
   generic source loads (importExternal), bundles (Power BI / dbt / data contracts: importBundle) and one-off Unity
   Catalog imports (runSync with a transient profile, as a job with progress). The mutation runs on the lite document
   plus the attributes of the tables it can touch; the result is saved through applyChanges (delta, audited), so the
   browser never holds a PAT or a bundle and the Databricks edition works with the app's own identity. */
import { assembleLite, attributesOfTables, applyChanges } from "./catalog-store.js";
import { changesBetween } from "../catalog-diff.js";
import { importExternal, importBundle } from "../src/lib/catalog-ops.js";
import { parseDbt } from "../src/lib/dbt-import.js";
import { parseContracts } from "../src/lib/odcs-import.js";
import { runSync } from "./uc-sync.js";
import { listUnityCatalogs } from "./unity-client.js";
import { saveProfile, PROFILE_DEFAULT, assertWorkspaceHost } from "./sync-profiles.js";
import { newJob, setPhase, finishJob } from "./jobs.js";

/* attributes of every table in the databases a payload names (any hub) — so existing columns are recognised */
const attributesForDatabases = async (prev, names) => {
  const dbIds = new Set(prev.databases.filter((d) => names.has(d.name)).map((d) => d.id));
  const scIds = new Set(prev.schemas.filter((s) => dbIds.has(s.databaseId)).map((s) => s.id));
  return attributesOfTables(prev.tables.filter((t) => scIds.has(t.schemaId)).map((t) => t.id));
};

/* runs `mutate(next)` on the lite document (+ attributes of `dbNames`) and saves the difference as one audited delta */
export const applyImport = async (user, { name, dbNames, mutate }) => {
  const { catalog: prev } = await assembleLite();
  if (!prev) throw Object.assign(new Error("The catalog is not initialised"), { status: 503 });
  prev.attributes = await attributesForDatabases(prev, new Set(dbNames));
  const next = structuredClone(prev);
  const info = mutate(next) || {};
  const changes = changesBetween(prev, next);
  if (!changes.length) return { applied: 0, version: null, ...info };
  const r = await applyChanges({ ...user, name: `${user.name} · ${name}` }, changes, { authorize: false });   /* refusals throw with their status */
  return { applied: changes.length, version: r.version ?? null, ...info };
};

const counts = (databases) => ({ databases: databases.length, schemas: databases.reduce((n, d) => n + (d.schemas || []).length, 0),
  tables: databases.reduce((n, d) => n + (d.schemas || []).reduce((m, s) => m + (s.tables || []).length, 0), 0),
  attributes: databases.reduce((n, d) => n + (d.schemas || []).reduce((m, s) => m + (s.tables || []).reduce((k, t) => k + (t.columns || []).length, 0), 0), 0) });

/* generic source system → SOURCE hub */
export const applyExternal = (user, { dbName, sourceType, schemasPayload = [], country = "GLOBAL", sourceRef = null }) =>
  applyImport(user, { name: `Load source ${sourceType} ${dbName}`, dbNames: [dbName], mutate: (s) => { importExternal(s, { dbName, sourceType, schemasPayload, country, sourceRef }); return { counts: { ...counts([{ name: dbName, schemas: schemasPayload }]), databases: 1 } }; } });

/* bundle (several databases + lineage) → a hub of choice */
export const applyBundle = (user, { hubId = "source", country = "GLOBAL", layer = "", sourceType, databases = [], lineage = [], sourceRef = null }) =>
  applyImport(user, { name: `Load ${sourceType} bundle`, dbNames: databases.map((d) => d.name), mutate: (s) => { const r = importBundle(s, { hubId, country, layer, sourceType, databases, lineage, sourceRef }); return { counts: { ...counts(databases), lineage: r.edges } }; } });

/* dbt manifest (+ catalog.json) or ODCS contracts, parsed on the server (texts arrive as strings) */
export const parseBundle = (args) => { try { return parseBundleRaw(args); } catch (e) { if (e.status) throw e; throw Object.assign(new Error(`Could not read the file: ${e.message}`), { status: 400 }); } };
const parseBundleRaw = ({ kind, manifest, catalog = null, contracts = [], fileName = "" }) => {
  if (kind === "dbt") {
    const r = parseDbt(JSON.parse(manifest), catalog ? JSON.parse(catalog) : null);
    return { databases: r.databases || [], lineage: r.lineage || [], sourceType: "dbt", sourceRef: { kind: "dbt", project: r.project || undefined, file: fileName, withCatalog: !!catalog, dbtVersion: r.dbtVersion || undefined } };
  }
  if (kind === "odcs") {
    const r = parseContracts(contracts);
    return { databases: r.databases || [], lineage: r.lineage || [], sourceType: "Data contract", sourceRef: { kind: "odcs", file: contracts.length === 1 ? fileName : `${contracts.length} contracts`, contract: r.contracts?.[0] } };
  }
  throw Object.assign(new Error("Unknown bundle kind"), { status: 400 });
};

/* ── one-off Unity Catalog import as a job ── */
const AUTH_TYPES = new Set(["pat", "sp", "app"]);
const cleanAuth = (a = {}) => ({ type: AUTH_TYPES.has(a.type) ? a.type : "pat", token: String(a.token || ""), clientId: String(a.clientId || "").trim(), clientSecret: String(a.clientSecret || "") });
const transientProfile = (body, saved) => ({ ...PROFILE_DEFAULT, ...(saved || {}), ...(saved ? {} : { host: String(body.host || "").trim().replace(/^https:\/\//, "").replace(/\/$/, ""), auth: cleanAuth(body.auth), warehouseId: String(body.warehouseId || "").trim().slice(0, 64) }),
  catalog: String(body.catalog || saved?.catalog || "").trim(), hubId: String(body.hubId || saved?.hubId || "central"), country: String(body.country || saved?.country || "GLOBAL").toUpperCase().slice(0, 16),
  layer: ["", "bronze", "silver", "gold", "other"].includes(body.layer) ? body.layer : (saved?.layer || ""), lineage: body.lineage === undefined ? !!saved?.lineage : !!body.lineage,
  importTags: body.importTags === undefined ? (saved ? saved.importTags !== false : true) : !!body.importTags, mode: "apply", deleteMissing: false, updateTypes: true, schedule: "manual", id: undefined, name: saved?.name || body.catalog || "" });

export const unityCatalogs = async (body, saved) => { const p = transientProfile(body, saved); if (p.auth.type !== "app") assertWorkspaceHost(p.host); return listUnityCatalogs(p); };

export const startUnityImport = (user, body, saved, { fetchImpl = fetch } = {}) => {
  const p = transientProfile(body, saved);
  if (!p.catalog) throw Object.assign(new Error("Catalog name is required"), { status: 400 });
  if (p.auth.type !== "app" && !p.host) throw Object.assign(new Error("Workspace host is required"), { status: 400 });
  if (p.auth.type !== "app") assertWorkspaceHost(p.host);
  const job = newJob("unity", user, `${p.host || "app"} · ${p.catalog}`);
  setPhase(job, "fetching");
  (async () => {
    try {
      const res = await runSync(p, user, { fetchImpl, onPhase: (ph) => setPhase(job, ph), onProgress: (pr) => { job.rowsRead = pr.tables; job.counts = { schemas: pr.schemas, tables: pr.tables }; } });
      if (!res.ok) throw new Error(res.error || "import failed");
      job.counts = { schemas: res.counts.newSchemas, tables: res.counts.newTables, attributes: res.counts.newColumns, total: res.applied || 0, tags: res.tags };
      job.version = res.version; job.result = res;
      if (body.saveProfile?.name && !saved) {   /* keep the connection as a manual sync profile */
        try { const prof = await saveProfile({ ...p, id: undefined, name: String(body.saveProfile.name).slice(0, 120), enabled: true }, user); job.profileId = prof.id; } catch (e) { job.warnings.push(`Profile not saved: ${e.message}`); }
      }
      finishJob(job, "done");
    } catch (e) { finishJob(job, "error", e.message); }
  })();
  return job;
};
