"""Offline test of the shared connector helpers (v1.71): python3 inspector/test_common.py

Covers connectors/common.py (sql_quote, sql_ident, is_system_schema and, since v1.73, the column/table/schema record
builders), the pure CREATE SECRET builder of the lake files mode and the parameterised catalog queries of the DuckDB
mode (F-I5: no SQL by string interpolation). Needs no DuckDB; when the duckdb module is installed it also introspects
a real file whose name contains a quote."""
import os
import pathlib
import tempfile
import unittest

import testsupport
from connectors import duckdb_db, lakefiles
from connectors.common import SYSTEM_SCHEMAS, column, is_system_schema, schema, sql_ident, sql_quote, table


class Records(unittest.TestCase):
    def test_builders_keep_the_import_shape(self):   # v1.73 (F-I3): one place for the key order and defaults
        c = column("id", "BIGINT")
        self.assertEqual(c, {"name": "id", "type_text": "BIGINT", "nullable": True, "comment": "", "isPK": False})
        self.assertEqual(list(c), ["name", "type_text", "nullable", "comment", "isPK"])
        self.assertEqual(column("id", "BIGINT", False, "Key", True), {"name": "id", "type_text": "BIGINT", "nullable": False, "comment": "Key", "isPK": True})
        t = table("claims", "TABLE", "", [c])
        self.assertEqual(list(t), ["name", "type", "comment", "columns"])
        self.assertEqual(schema("main", [t]), {"name": "main", "comment": "", "tables": [t]})
        self.assertEqual(list(schema("main", [])), ["name", "comment", "tables"])


class Helpers(unittest.TestCase):
    def test_sql_quote_and_ident(self):
        # sql_quote / sql_ident
        assert sql_quote("abc") == "'abc'" and sql_quote("") == "''"
        assert sql_quote("O'Brien") == "'O''Brien'" and sql_quote("'; DROP TABLE t; --") == "'''; DROP TABLE t; --'"
        assert sql_quote("a\\b") == "'a\\b'", sql_quote("a\\b")   # backslashes are not escape characters in DuckDB string literals
        assert sql_quote(42) == "'42'"
        assert sql_ident("httpfs") == '"httpfs"' and sql_ident('my"ext') == '"my""ext"' and sql_ident("a; drop") == '"a; drop"'

    def test_is_system_schema(self):
        # is_system_schema: exactly the union of the two per-mode filters it replaced
        old_sqlalchemy = lambda s: s.lower() in SYSTEM_SCHEMAS or s.lower().startswith("sys")  # noqa: E731
        old_jdbc = lambda s: s.lower() in SYSTEM_SCHEMAS or s.lower().startswith(("sys", "information_schema"))  # noqa: E731
        for name in list(SYSTEM_SCHEMAS) + ["SYS", "SYSCAT", "SYSIBM", "sys_x", "System", "systemtables", "INFORMATION_SCHEMA", "pg_catalog", "PG_TOAST",
                                             "sales", "Claims", "main", "dbo", "public", "bronze", "analysis", "my_sys", "xsys", "info", ""]:
            assert is_system_schema(name) == old_jdbc(name), name
            if not name.lower().startswith("information_schema") or name.lower() == "information_schema":
                assert is_system_schema(name) == old_sqlalchemy(name), name
        assert is_system_schema(None) is False
        # the one hypothetical delta: a schema that merely starts with "information_schema" — jdbc already skipped it, sqlalchemy now does too
        assert is_system_schema("information_schema_backup") and not old_sqlalchemy("information_schema_backup")
        # DuckDB keeps its own short list on purpose: a user schema "system_data" must stay visible there
        assert "system_data" not in duckdb_db.DUCKDB_SYSTEM_SCHEMAS and duckdb_db.DUCKDB_SYSTEM_SCHEMAS == {"information_schema", "pg_catalog"}

    def test_lakefiles_secret_statement(self):
        # lakefiles.secret_statement: credentials never reach the statement text
        sql, params = lakefiles.secret_statement("s3", {"s3Key": "AKIA'X", "s3Secret": "se'cret;--", "s3Region": "eu-central-1"})
        assert sql == "CREATE SECRET s3 (TYPE s3, KEY_ID ?, SECRET ?, REGION ?)", sql
        assert params == ["AKIA'X", "se'cret;--", "eu-central-1"], params
        assert "'" not in sql.replace("'path'", "") and "AKIA" not in sql
        sql, params = lakefiles.secret_statement("s3", {"s3Key": "k", "s3Endpoint": "http://minio.local:9000/"})
        assert sql == "CREATE SECRET s3 (TYPE s3, KEY_ID ?, SECRET ?, ENDPOINT ?, URL_STYLE 'path', USE_SSL ?)", sql
        assert params == ["k", "", "minio.local:9000", False], params
        sql, params = lakefiles.secret_statement("s3", {"s3Endpoint": "https://s3.example.com"})
        assert sql == "CREATE SECRET s3 (TYPE s3, ENDPOINT ?, URL_STYLE 'path', USE_SSL ?)" and params == ["s3.example.com", True]
        assert sql.count("?") == len(params)
        assert lakefiles.secret_statement("s3", {}) is None and lakefiles.secret_statement("s3", {"s3Region": "eu-central-1"}) is None
        assert lakefiles.secret_statement("s3", None) is None
        # Azure: the four variants the v1.55 code answered, unchanged
        assert lakefiles.secret_statement("azure", {"azureConnectionString": "DefaultEndpointsProtocol=https;AccountName=a;AccountKey=k'"}) == \
            ("CREATE SECRET az (TYPE azure, CONNECTION_STRING ?)", ["DefaultEndpointsProtocol=https;AccountName=a;AccountKey=k'"])
        assert lakefiles.secret_statement("azure", {"azureAccount": "acc", "azureSas": "?sv=1&sig=a'b"}) == \
            ("CREATE SECRET az (TYPE azure, CONNECTION_STRING ?)", ["AccountName=acc;SharedAccessSignature=sv=1&sig=a'b"])
        assert lakefiles.secret_statement("azure", {"azureAccount": "acc", "azureKey": "K"}) == \
            ("CREATE SECRET az (TYPE azure, CONNECTION_STRING ?)", ["DefaultEndpointsProtocol=https;AccountName=acc;AccountKey=K;EndpointSuffix=core.windows.net"])
        assert lakefiles.secret_statement("azure", {"azureAccount": "acc"}) == ("CREATE SECRET az (TYPE azure, PROVIDER credential_chain, ACCOUNT_NAME ?)", ["acc"])
        assert lakefiles.secret_statement("azure", {}) is None
        with self.assertRaises(ValueError):
            lakefiles.secret_statement("gcs", {})
        assert lakefiles.LAKE_FORMATS == ("auto", "parquet", "csv", "json", "delta", "iceberg")
        assert lakefiles._path_list(" /a \n\n/b") == ["/a", "/b"] and lakefiles._path_list(["/a", "", None, 3]) == ["/a"] and lakefiles._path_list(None) == []

    def test_duckdb_parameterised(self):
        # duckdb_db: the catalog statements take the database name as a bound parameter only
        for stmt in (*duckdb_db._OBJECTS_SQL, *duckdb_db._COLUMNS_SQL, duckdb_db._PKS_SQL):
            assert "database_name = ?" in stmt and "{" not in stmt and "format(" not in stmt, stmt
        assert duckdb_db._path_problem("")[0] == "A DuckDB file path is required (e.g. /data/warehouse.duckdb)"
        assert duckdb_db._path_problem(":memory:") == (None, ":memory:")
        assert duckdb_db._path_problem("/nonexistent/x.duckdb")[0] == "DuckDB file not found on the inspector host: /nonexistent/x.duckdb"
        src = pathlib.Path(duckdb_db.__file__).read_text() + pathlib.Path(lakefiles.__file__).read_text()
        assert '.replace("?"' not in src and "KEY_ID '" not in src and "REGION '" not in src and "ENDPOINT '{" not in src and "= '{" not in src, \
            "SQL by string interpolation crept back in"


@unittest.skipUnless(testsupport.have("duckdb"), "duckdb not installed")
class RealDuckDB(unittest.TestCase):
    def test_file_name_with_a_quote(self):   # a file name with a quote used to break the query (v1.70)
        import duckdb
        d = tempfile.mkdtemp()
        f = os.path.join(d, "o'brien.duckdb")
        con = duckdb.connect(f)
        con.execute("CREATE SCHEMA system_data; CREATE TABLE system_data.claims (id INTEGER PRIMARY KEY, amount DOUBLE); CREATE VIEW main.v AS SELECT 1 AS one")
        try:
            con.execute("COMMENT ON TABLE system_data.claims IS 'Claims'; COMMENT ON COLUMN system_data.claims.id IS 'Key'")
        except Exception:
            pass   # DuckDB < 0.10
        con.close()
        schemas = duckdb_db.inspect_duckdb(f)
        by = {s["name"]: {t["name"]: t for t in s["tables"]} for s in schemas}
        assert set(by) == {"main", "system_data"}, by   # "system_data" is a user schema in DuckDB — not filtered there
        claims = by["system_data"]["claims"]
        assert claims["type"] == "TABLE" and claims["columns"][0]["isPK"] and not claims["columns"][0]["nullable"] and claims["columns"][1]["type_text"] == "DOUBLE"
        assert list(claims) == ["name", "type", "comment", "columns"] and list(claims["columns"][0]) == ["name", "type_text", "nullable", "comment", "isPK"]
        assert by["main"]["v"]["type"] == "VIEW" and by["main"]["v"]["columns"][0]["name"] == "one"
        assert [s["name"] for s in duckdb_db.inspect_duckdb(f, only_schema="main")] == ["main"]
        assert duckdb_db.run({"path": f, "schema": "system_data"})["schemas"][0]["tables"][0]["name"] == "claims"


if __name__ == "__main__":
    testsupport.main()
