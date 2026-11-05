/* v1.61.1 — Lakebase credential flow for both flavours, against a fake Databricks host */
import { describe, it, expect, vi } from "vitest";

process.env.DB_DRIVER = "postgres";
const { lakebasePassword, resetLakebaseCache } = await import("../../server/db.js");

const fakeHost = (calls, { expireField = "expire_time" } = {}) => vi.fn(async (url, opts) => {
  calls.push({ url, body: opts.body, auth: opts.headers.Authorization });
  if (url.endsWith("/oidc/v1/token")) return { ok: true, status: 200, json: async () => ({ access_token: "ws-token", expires_in: 3600 }) };
  if (url.endsWith("/api/2.0/postgres/credentials")) return { ok: true, status: 200, json: async () => ({ token: "pg-token-autoscaling", [expireField]: new Date(Date.now() + 3600000).toISOString() }) };
  if (url.endsWith("/api/2.0/database/credentials")) return { ok: true, status: 200, json: async () => ({ token: "pg-token-provisioned", expiration_time: new Date(Date.now() + 3600000).toISOString() }) };
  return { ok: false, status: 404, json: async () => ({}) };
});
const base = { DATABRICKS_HOST: "adb-1.azuredatabricks.net", DATABRICKS_CLIENT_ID: "sp-id", DATABRICKS_CLIENT_SECRET: "sp-secret" };

describe("Lakebase password provider", () => {
  it("Autoscaling: OAuth client credentials → POST /api/2.0/postgres/credentials with the endpoint name, cached until shortly before expiry", async () => {
    resetLakebaseCache(); const calls = []; const f = fakeHost(calls);
    const env = { ...base, LAKEBASE_ENDPOINT: "projects/p1/branches/b1/endpoints/e1" };
    expect(await lakebasePassword({ fetchImpl: f, env })).toBe("pg-token-autoscaling");
    expect(calls[0].url).toBe("https://adb-1.azuredatabricks.net/oidc/v1/token"); expect(calls[0].auth).toBe("Basic " + Buffer.from("sp-id:sp-secret").toString("base64")); expect(calls[0].body).toBe("grant_type=client_credentials&scope=all-apis");
    expect(calls[1].url).toBe("https://adb-1.azuredatabricks.net/api/2.0/postgres/credentials"); expect(JSON.parse(calls[1].body)).toEqual({ endpoint: "projects/p1/branches/b1/endpoints/e1" }); expect(calls[1].auth).toBe("Bearer ws-token");
    expect(await lakebasePassword({ fetchImpl: f, env })).toBe("pg-token-autoscaling"); expect(calls).toHaveLength(2);
    expect(await lakebasePassword({ fetchImpl: f, env, now: () => Date.now() + 56 * 60000 })).toBe("pg-token-autoscaling"); expect(calls).toHaveLength(4);
  });
  it("Provisioned: POST /api/2.0/database/credentials with instance_names; missing configuration is reported", async () => {
    resetLakebaseCache(); const calls = []; const f = fakeHost(calls);
    expect(await lakebasePassword({ fetchImpl: f, env: { ...base, LAKEBASE_INSTANCE: "cortex-catalog" } })).toBe("pg-token-provisioned");
    expect(calls[1].url).toMatch(/\/api\/2\.0\/database\/credentials$/); expect(JSON.parse(calls[1].body).instance_names).toEqual(["cortex-catalog"]);
    resetLakebaseCache();
    await expect(lakebasePassword({ fetchImpl: f, env: { ...base } })).rejects.toThrow(/LAKEBASE_ENDPOINT \(Autoscaling\) or LAKEBASE_INSTANCE \(Provisioned\)/);
    await expect(lakebasePassword({ fetchImpl: vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })), env: { ...base, LAKEBASE_ENDPOINT: "x" } })).rejects.toThrow("Databricks token endpoint: HTTP 401");
  });
});
