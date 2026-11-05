/* v1.74 (F-T1 of the third review): may the E2E suite drop every table of this database? Pure, unit-tested in
   test/unit/e2e-db-guard.test.js. The name must contain "test" or "e2e" as a word of its own (separated by "_" or "-",
   optionally followed by digits: datahub_catalog_test, e2e_cortex, cortex-test2) — the former substring match also
   accepted catalog_latest, attestation_prod or contest. The host must be loopback unless E2E_ALLOW_REMOTE_DB=1.
   E2E_ALLOW_DB_RESET=1 still overrides the name rule (not the host rule). Returns null or the refusal text. */
const TEST_NAME = /(^|[_-])(test|e2e)\d*([_-]|$)/i;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", ""]);
export const resetRefusal = ({ database, host } = {}, env = {}) => {
  const h = String(host ?? "").trim().toLowerCase();
  if (!LOOPBACK.has(h) && !h.startsWith("127.") && !h.startsWith("/") && env.E2E_ALLOW_REMOTE_DB !== "1")
    return `refusing to reset database "${database}" on host "${host}": the E2E suite drops every table and only runs against a local database (set E2E_ALLOW_REMOTE_DB=1 for a dedicated remote test server)`;
  if (!TEST_NAME.test(String(database || "")) && env.E2E_ALLOW_DB_RESET !== "1")
    return `refusing to reset database "${database}": the E2E suite drops every table — use a dedicated database whose name contains "test" or "e2e" as a separate word, e.g. datahub_catalog_test (or set E2E_ALLOW_DB_RESET=1)`;
  return null;
};
