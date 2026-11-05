/* v1.74 (F-T1): the guard in front of the destructive E2E database reset */
import { describe, it, expect } from "vitest";
import { resetRefusal } from "../e2e/db-guard.mjs";

describe("resetRefusal", () => {
  it("accepts dedicated local test databases", () => {
    for (const database of ["datahub_catalog_test", "e2e_cortex", "cortex-test2", "test", "E2E", "catalog_e2e_pg"])
      for (const host of ["localhost", "127.0.0.1", "::1", "", undefined, "127.0.1.1", "/var/run/postgresql"])
        expect(resetRefusal({ database, host }, {}), `${database}@${host}`).toBeNull();
  });
  it("refuses names that merely contain the letters (the former substring match accepted them)", () => {
    for (const database of ["datahub_catalog", "catalog_latest", "attestation_prod", "contest", "testing_prod", "e2ex"])
      expect(resetRefusal({ database, host: "localhost" }, {}), database).toMatch(/refusing to reset database/);
    expect(resetRefusal({ database: "catalog_latest", host: "localhost" }, { E2E_ALLOW_DB_RESET: "1" })).toBeNull();
  });
  it("refuses remote hosts unless explicitly allowed — the name override does not lift it", () => {
    expect(resetRefusal({ database: "datahub_catalog_test", host: "db.prod.internal" }, {})).toMatch(/only runs against a local database/);
    expect(resetRefusal({ database: "datahub_catalog_test", host: "10.0.0.5" }, { E2E_ALLOW_DB_RESET: "1" })).toMatch(/local database/);
    expect(resetRefusal({ database: "datahub_catalog_test", host: "ci-db" }, { E2E_ALLOW_REMOTE_DB: "1" })).toBeNull();
  });
});
