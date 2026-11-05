/* Databricks service-principal OAuth (client credentials) shared by the Lakebase credential provider, the Volume
   storage provider and the Unity Catalog sync. Databricks Apps inject DATABRICKS_HOST, DATABRICKS_CLIENT_ID and
   DATABRICKS_CLIENT_SECRET; elsewhere set them by hand. Tokens are cached until a minute before expiry. */
export const databricksHost = (host = process.env.DATABRICKS_HOST) => String(host || "").replace(/\/$/, "").replace(/^(?!https?:\/\/)/, "https://");
const cache = new Map();   /* host|id → { token, until } */
export const databricksToken = async ({ host = process.env.DATABRICKS_HOST, clientId = process.env.DATABRICKS_CLIENT_ID, clientSecret = process.env.DATABRICKS_CLIENT_SECRET, scope = "all-apis" } = {}) => {
  const h = databricksHost(host);
  if (!h || !clientId || !clientSecret) throw new Error("Databricks service principal needs DATABRICKS_HOST, DATABRICKS_CLIENT_ID and DATABRICKS_CLIENT_SECRET");
  const key = `${h}|${clientId}|${scope}`;
  const hit = cache.get(key); if (hit && hit.until > Date.now()) return hit.token;
  const r = await fetch(`${h}/oidc/v1/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` },
    body: new URLSearchParams({ grant_type: "client_credentials", scope }).toString() });
  if (!r.ok) throw new Error(`Databricks token endpoint: HTTP ${r.status}`);
  const j = await r.json();
  cache.set(key, { token: j.access_token, until: Date.now() + Math.max(60, Number(j.expires_in || 3600) - 60) * 1000 });
  return j.access_token;
};
/* a bearer for API calls: a static PAT/token when given, otherwise the service principal */
export const databricksBearer = async (opts = {}) => opts.token || process.env.DATABRICKS_TOKEN || databricksToken(opts);
