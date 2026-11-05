/* Power BI admin Scanner API — ported from inspector/app.py (v1.60, Option B).
   Workspaces → databases, datasets → schemas, dataset tables → tables with columns and measures, reports → tables of
   type REPORT in schema "Reports" with lineage dataset table → report. Needs a service principal allowed to use the
   admin read-only APIs and the tenant setting "Enhance admin APIs responses with detailed metadata". */
import { request as httpRequest, ConnectorError } from "./http.js";

export const PBI_API = "https://api.powerbi.com/v1.0/myorg";
const lower = (s) => String(s || "").toLowerCase();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function pbiToken({ tenantId, clientId, clientSecret, tlsVerify = true }, transport = httpRequest) {
  const r = await transport(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST", form: { grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope: "https://analysis.windows.net/powerbi/api/.default" }, tlsVerify, timeoutMs: 60000,
  });
  if (!r.ok) throw new ConnectorError(`Entra token request failed (HTTP ${r.status})`);
  return r.json().access_token;
}

export async function inspectPowerBi({ tenantId, clientId, clientSecret, token, workspaces: workspaceFilter, includeReports = true, tlsVerify = true } = {}, { transport = httpRequest, sleep = wait } = {}) {
  const tok = token || await pbiToken({ tenantId, clientId, clientSecret, tlsVerify }, transport);
  const common = { bearer: tok, tlsVerify, timeoutMs: 120000 };
  const get = async (path) => {
    const r = await transport(`${PBI_API}/${path}`, common);
    if (r.status === 401 || r.status === 403) throw new ConnectorError(`Power BI refused the request (HTTP ${r.status}) — the principal needs 'Tenant.Read.All' via the admin API tenant setting`);
    if (!r.ok) throw new ConnectorError(`Power BI API ${path.split("?")[0]}: HTTP ${r.status}`);
    return r.json();
  };
  let groups = (await get("admin/groups?$top=5000&$filter=state%20eq%20'Active'")).value || [];
  groups = groups.filter((g) => (g.type || "Workspace") === "Workspace");
  const wanted = String(workspaceFilter || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (wanted.length) groups = groups.filter((g) => wanted.includes(lower(g.name)) || wanted.includes(lower(g.id)) || wanted.some((w) => w.endsWith("*") && lower(g.name).startsWith(w.replace(/\*+$/, ""))));
  if (!groups.length) throw new ConnectorError("No workspaces found" + (wanted.length ? ` matching '${workspaceFilter}'` : " (is the principal allowed to call the admin APIs?)"));

  const scanned = [];
  const ids = groups.map((g) => g.id);
  for (let i = 0; i < ids.length; i += 100) {
    const r = await transport(`${PBI_API}/admin/workspaces/getInfo?datasetSchema=true&datasetExpressions=false&lineage=true&datasourceDetails=true`, { ...common, method: "POST", json: { workspaces: ids.slice(i, i + 100) } });
    if (!r.ok) throw new ConnectorError(`Scanner API getInfo failed: HTTP ${r.status}`);
    const scanId = r.json().id;
    let done = false;
    for (let k = 0; k < 120; k++) {
      const st = await get(`admin/workspaces/scanStatus/${scanId}`);
      if (st.status === "Succeeded") { done = true; break; }
      if (st.status === "Failed" || st.status === "Error") throw new ConnectorError(`Scanner API scan failed: ${JSON.stringify(st)}`);
      await sleep(2000);
    }
    if (!done) throw new ConnectorError("Scanner API scan did not finish in time");
    scanned.push(...((await get(`admin/workspaces/scanResult/${scanId}`)).workspaces || []));
  }

  const databases = []; const lineage = [];
  for (const ws of scanned) {
    const wsName = ws.name || ws.id;
    const schemas = []; const dsById = new Map();
    for (const ds of ws.datasets || []) {
      const tables = [];
      for (const t of ds.tables || []) {
        const cols = (t.columns || []).filter((c) => !c.isHidden).map((c) => ({ name: c.name, type_text: String(c.dataType || "STRING").toUpperCase(), nullable: true, isPK: false, comment: c.description || "" }));
        for (const m of t.measures || []) cols.push({ name: m.name, type_text: "MEASURE", nullable: true, isPK: false, comment: (m.description || "") + (m.expression ? ` [${String(m.expression).slice(0, 200)}]` : "") });
        const src = (t.source || []).filter((x) => x.expression).map((x) => String(x.expression).slice(0, 160)).join("; ");
        let comment = t.description || "";
        if (src) comment = (comment ? comment + " " : "") + `Source: ${src}`;
        tables.push({ name: t.name, type: "TABLE", comment, columns: cols });
      }
      const up = (ds.upstreamDatasources || ds.datasourceUsages || []).filter((u) => u && typeof u === "object" && u.datasourceType)
        .map((u) => `${u.datasourceType}:${(u.connectionDetails || {}).server || (u.connectionDetails || {}).url || ""}`).join(", ");
      const comment = (ds.description || "") + (up ? ` Data sources: ${up}` : "");
      schemas.push({ name: ds.name || ds.id, comment: comment.trim(), tables });
      dsById.set(ds.id, ds);
    }
    if (includeReports && (ws.reports || []).length) {
      const repTables = [];
      for (const rep of ws.reports || []) {
        const ds = dsById.get(rep.datasetId);
        let cm = rep.description || "";
        if (ds) cm = (cm ? cm + " " : "") + `Dataset: ${ds.name}`;
        else if (rep.datasetWorkspaceId) cm = (cm ? cm + " " : "") + `Dataset in another workspace (${rep.datasetId})`;
        repTables.push({ name: rep.name, type: "REPORT", comment: cm.trim(), columns: [] });
        if (ds) for (const t of ds.tables || []) lineage.push([`${wsName}.${ds.name}.${t.name}`, `${wsName}.Reports.${rep.name}`]);
      }
      if (repTables.length) schemas.push({ name: "Reports", comment: "Power BI reports of this workspace (lineage: dataset tables → report)", tables: repTables });
    }
    if (schemas.length) databases.push({ name: wsName, comment: `Power BI workspace ${wsName}` + (ws.description ? ` (${ws.description})` : ""), schemas, layerHint: "reports gold" });
  }
  if (!databases.length) throw new ConnectorError("The scanned workspaces contain no datasets or reports");
  return { databases, lineage };
}
