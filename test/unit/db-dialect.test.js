import { describe, it, expect } from "vitest";

/* the dialect layer under DB_DRIVER=postgres: no connection is opened until the first query */
process.env.DB_DRIVER = "postgres";
/* v1.61: a Lakebase resource attached to a Databricks App injects PG* variables — they are the fallback for DB_* */
delete process.env.DB_HOST; delete process.env.DB_PORT; delete process.env.DB_USER; delete process.env.DB_NAME;
process.env.PGHOST = "instance-abc.database.azuredatabricks.net"; process.env.PGPORT = "5432"; process.env.PGUSER = "sp-cortex"; process.env.PGDATABASE = "datahub_catalog"; process.env.PGSSLMODE = "require";
const { toPgPlaceholders, translateCreateTable, sql, isPostgres, DRIVER, DB } = await import("../../server/db.js");

describe("connection settings", () => {
  it("falls back to the PG* variables injected by a Databricks database resource", () => {
    expect(DB).toMatchObject({ host: "instance-abc.database.azuredatabricks.net", port: 5432, user: "sp-cortex", database: "datahub_catalog" });
  });
});

describe("placeholder rewriting", () => {
  it("numbers ? outside of quotes and comments", () => {
    expect(isPostgres).toBe(true); expect(DRIVER).toBe("postgres");
    expect(toPgPlaceholders("SELECT * FROM t WHERE a = ? AND b = ?")).toBe("SELECT * FROM t WHERE a = $1 AND b = $2");
    expect(toPgPlaceholders("SELECT 'what?' AS q, \"col?\" FROM t WHERE x = ? -- really?\n AND y = ?")).toBe("SELECT 'what?' AS q, \"col?\" FROM t WHERE x = $1 -- really?\n AND y = $2");
    expect(toPgPlaceholders("SELECT 'it''s ?' , ?")).toBe("SELECT 'it''s ?' , $1");
    expect(toPgPlaceholders("INSERT INTO t VALUES (?,?),(?,?)")).toBe("INSERT INTO t VALUES ($1,$2),($3,$4)");
  });
});

describe("DDL translation", () => {
  it("maps MariaDB types, strips the charset and moves inline indexes out", () => {
    const out = translateCreateTable(`CREATE TABLE IF NOT EXISTS cat_tables (
      id VARCHAR(64) PRIMARY KEY, schema_id VARCHAR(64) NULL, name VARCHAR(512) NULL, seq INT NOT NULL DEFAULT 0,
      data JSON NOT NULL, search_text TEXT NULL, updated_at BIGINT NOT NULL,
      INDEX (schema_id), INDEX (name(191)), FULLTEXT (search_text)) CHARACTER SET utf8mb4`);
    expect(out).toHaveLength(4);
    expect(out[0]).toMatch(/^CREATE TABLE IF NOT EXISTS cat_tables \(/);
    expect(out[0]).toContain("data JSONB NOT NULL");
    expect(out[0]).toContain("search_tsv tsvector GENERATED ALWAYS AS");
    expect(out[0]).not.toMatch(/INDEX|FULLTEXT|CHARACTER SET|\(191\)/);
    expect(out).toContain("CREATE INDEX IF NOT EXISTS cat_tables_schema_id_idx ON cat_tables (schema_id)");
    expect(out).toContain("CREATE INDEX IF NOT EXISTS cat_tables_name_idx ON cat_tables (name)");
    expect(out.some((s) => /USING GIN \(search_tsv\)/.test(s))).toBe(true);
    const ev = translateCreateTable("CREATE TABLE IF NOT EXISTS usage_events (id BIGINT AUTO_INCREMENT PRIMARY KEY, ts BIGINT NOT NULL, stars TINYINT NOT NULL, data LONGBLOB, note MEDIUMTEXT, INDEX (kind, term)) CHARACTER SET utf8mb4");
    expect(ev[0]).toBe("CREATE TABLE IF NOT EXISTS usage_events (id BIGSERIAL PRIMARY KEY, ts BIGINT NOT NULL, stars SMALLINT NOT NULL, data BYTEA, note TEXT)");
    expect(ev[1]).toBe("CREATE INDEX IF NOT EXISTS usage_events_kind_term_idx ON usage_events (kind, term)");
    expect(translateCreateTable("ALTER TABLE x ADD COLUMN y INT")).toEqual(["ALTER TABLE x ADD COLUMN y INT"]);
  });
});

describe("dialect helpers (postgres)", () => {
  it("builds upserts, ignores, casts and search queries", () => {
    expect(sql.upsert("settings", ["k", "v", "ts"], 1, ["k"])).toBe("INSERT INTO settings (k,v,ts) VALUES (?,?,?) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, ts = EXCLUDED.ts");
    expect(sql.upsert("t", ["id", "a", "seq"], 2, ["id"], ["a"])).toBe("INSERT INTO t (id,a,seq) VALUES (?,?,?),(?,?,?) ON CONFLICT (id) DO UPDATE SET a = EXCLUDED.a");
    expect(sql.insertIgnore("users", ["id", "name"])).toBe("INSERT INTO users (id,name) VALUES (?,?) ON CONFLICT DO NOTHING");
    expect(sql.like).toBe("ILIKE"); expect(sql.int()).toBe("?::int"); expect(sql.text()).toBe("?::text");
    expect(sql.jsonContains("scope_json")).toBe("(scope_json::jsonb @> to_jsonb(?::text))");
    expect(sql.jsonSetText("data", "error")).toContain("jsonb_set(");
    const s = sql.search("cat_tables", "fct_cla +ims*", 20);
    expect(s.params).toEqual(["fct_cla:* & ims:*", "fct_cla:* & ims:*", 20]);
    expect(s.sql).toMatch(/search_tsv @@ to_tsquery\('simple', \?\)/);
    expect(sql.search("cat_tables", "  ", 20)).toBeNull();
  });
});
