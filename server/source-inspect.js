/* Generic source inspection (v1.73, F-S7 — moved out of routes/source-import.js): which modes exist, whether the
   optional Python inspector is configured and reachable (health cached for 30 s), and one inspection run.
   v1.60: the pure-HTTPS connectors (OData/SuccessFactors, Kafka Schema Registry, Power BI, Informatica) run natively in
   Node (server/connectors) — always, since v1.73; only DuckDB, lake files, SQLAlchemy and JDBC are forwarded to the inspector.
   INSPECTOR_URL empty / "off" → the inspector-only modes answer 503 and the UI hides them (Databricks edition). */
import { INSPECTOR_URL } from "./config.js";
import { sysAudit } from "./audit.js";
import { NATIVE_MODES, INSPECTOR_MODES, inspectNative } from "./connectors/index.js";

export const INSPECT_MODES = [...INSPECTOR_MODES, ...NATIVE_MODES];
/* the Power BI scanner polls an asynchronous scan — allow it more time than a database introspection */
const TIMEOUT_MS = { powerbi: 280000, informatica: 170000 };
export const inspectorConfigured = () => !!INSPECTOR_URL && !["off", "none", "0", "false"].includes(String(INSPECTOR_URL).toLowerCase());

/* the audit label of a source load (renamed from sourceLabel in v1.73 — src/lib/model.js has an unrelated sourceLabel) */
export const inspectSourceLabel = (b) => b.mode === "jdbc" ? `jdbc ${String(b.url).split(":").slice(0, 2).join(":")}`
  : b.mode === "duckdb" ? `duckdb ${String(b.path || "")}`
  : b.mode === "lakefiles" ? `lake files ${(Array.isArray(b.paths) ? b.paths : String(b.paths || "").split("\n")).filter(Boolean).slice(0, 2).join(", ")}`
  : b.mode === "sqlalchemy" ? String(b.url).split("://")[0]
  : b.mode === "powerbi" ? `powerbi ${String(b.workspaces || "all workspaces")}`
  : `${b.mode} ${String(b.url || b.apiHost || "")}`;

/* inspector reachability, cached for 30 s (the capabilities endpoint is polled by the UI when the dialog opens) */
let healthCache = { at: 0, ok: false };
export async function inspectorAvailable({ force = false } = {}) {
  if (!inspectorConfigured()) return false;
  if (!force && Date.now() - healthCache.at < 30000) return healthCache.ok;
  let ok;
  try { const r = await fetch(`${INSPECTOR_URL}/health`, { signal: AbortSignal.timeout(2500) }); ok = r.ok; } catch { ok = false; }
  healthCache = { at: Date.now(), ok };
  return ok;
}

/* what the import dialog may offer */
export const inspectCapabilities = async ({ force = false } = {}) => {
  const configured = inspectorConfigured();
  return { native: NATIVE_MODES, inspectorModes: INSPECTOR_MODES, inspector: configured, inspectorReachable: configured ? await inspectorAvailable({ force }) : false };
};

/* one inspection. Refusals throw with `status` (400 unknown mode, 503 inspector not configured, 502 unreachable; the
   native connectors throw ConnectorError with theirs). The inspector's own answer is passed through verbatim — its
   HTTP status included — so the result is { status, body }. Successful loads are audited. */
export const inspectSource = async (b, user) => {
  if (!INSPECT_MODES.includes(b.mode)) throw Object.assign(new Error(`mode must be one of ${INSPECT_MODES.join(", ")}`), { status: 400 });
  if (!INSPECTOR_MODES.includes(b.mode)) {   /* v1.73: the HTTPS connectors always run natively (the SOURCE_IMPORT_VIA_INSPECTOR escape hatch is gone with the inspector's Python copies) */
    const out = await inspectNative(b);
    await sysAudit(user, "system", "imported", `source load via ${inspectSourceLabel(b)}`);
    return { status: 200, body: out };
  }
  if (!inspectorConfigured()) throw Object.assign(new Error(`This source type needs the source inspector service, which is not configured on this installation (INSPECTOR_URL). Available without it: ${NATIVE_MODES.join(", ")}, dbt, ODCS, CSV and Unity Catalog.`), { status: 503, code: "inspector_not_configured" });
  let up;
  try {
    up = await fetch(`${INSPECTOR_URL}/inspect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b), signal: AbortSignal.timeout(TIMEOUT_MS[b.mode] || 110000) });
  } catch {
    healthCache = { at: Date.now(), ok: false };
    throw Object.assign(new Error("The source inspector service is not reachable — check: systemctl status datahub-catalog-inspector"), { status: 502 });
  }
  const j = await up.json().catch(() => ({ error: "Invalid inspector response" }));
  if (up.ok) await sysAudit(user, "system", "imported", `source load via ${inspectSourceLabel(b)}`);
  return { status: up.status, body: j };
};
