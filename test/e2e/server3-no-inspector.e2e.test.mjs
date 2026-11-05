/* E2E: INSPECTOR_URL="" — the Databricks edition without the Python inspector (v1.60, Option A+B). Runs its own
   server on a separate port (3989 = E2E_PORT_BASE + 9) against a freshly reset test database and bootstraps its own
   admin. v1.73 (F-T6): no longer depends on the admin created by another file or on alphabetical file order. */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { requireDb, resetDb, bootServer, portOf, client, bootstrapAdmin, ADMIN } from "./helpers.mjs";

let srv, c;
const req = (...a) => c.req(...a);

describe("E2E without inspector", { skip: requireDb() }, () => {
  before(async () => {
    await resetDb();
    const port = portOf("noInspector");
    srv = await bootServer({ INSPECTOR_URL: "", CONNECTORS_ALLOW_PRIVATE: "1", DATA_DIR: "/tmp/e2e-nodata-noinspector", APP_URL: `http://127.0.0.1:${port}` }, { port, label: "no-inspector server" });
    c = client(srv.base);
  });
  after(() => srv?.stop());

  test("without INSPECTOR_URL: capabilities say so, inspector-only modes answer 503, native connectors keep working", async () => {
    const b = await req("/auth/bootstrap-needed");
    assert.equal(b.json.needed, true, "fresh database: the first admin is created here");
    await bootstrapAdmin(c, ADMIN);
    const caps = await req("/api/source-import/capabilities");
    assert.equal(caps.status, 200); assert.equal(caps.json.inspector, false); assert.equal(caps.json.inspectorReachable, false); assert.deepEqual(caps.json.inspectorModes, ["duckdb", "lakefiles", "sqlalchemy", "jdbc"]);
    let r = await req("/api/source-import/inspect", { method: "POST", body: { mode: "duckdb", path: "/x.duckdb" } });
    assert.equal(r.status, 503); assert.equal(r.json.code, "inspector_not_configured"); assert.match(r.json.error, /not configured on this installation/);
    r = await req("/api/source-import/inspect", { method: "POST", body: { mode: "sqlalchemy", url: "postgresql://x" } });
    assert.equal(r.status, 503); assert.equal(r.json.code, "inspector_not_configured");
    r = await req("/api/source-import/inspect", { method: "POST", body: { mode: "kafka", url: "http://127.0.0.1:1" } });
    assert.equal(r.status, 502, "native connector ran in Node and reported the unreachable registry"); assert.match(r.json.error, /ECONNREFUSED/);
    r = await req("/api/source-import/inspect", { method: "POST", body: { mode: "powerbi" } });
    assert.equal(r.status, 400);
    const h = await (await fetch(srv.base + "/healthz")).json();
    assert.equal(h.ok, true);
  });
});
