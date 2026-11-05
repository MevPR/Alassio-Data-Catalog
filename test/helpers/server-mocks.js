/* v1.72 (F-T1) — one shape for the mocked database module (eight unit tests had four different shapes).
   Usage, keeping vi.mock's hoisting intact:
     vi.mock("../../server/db.js", async () => (await import("../helpers/server-mocks.js")).mockDb());
     vi.mock("../../server/db.js", async () => (await import("../helpers/server-mocks.js")).mockDb((sql, params) => rows));
   The optional handler receives every query and returns its rows (default: no rows). */
import { vi } from "vitest";

export const mockDb = (handler = async () => []) => ({
  q: vi.fn(async (sql, params = []) => handler(sql, params)),
  pool: {}, sql: {}, DRIVER: "mariadb", isPostgres: false,
  closeDb: vi.fn(async () => {}),
});
