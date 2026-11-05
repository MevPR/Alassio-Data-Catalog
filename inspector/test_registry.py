"""Offline test of the /inspect mode registry (v1.70): python3 inspector/test_registry.py

Checks that every mode in connectors.MODES has a validate and a run callable, the per-mode validation texts and the
unknown-mode text, that the duckdb and lakefiles modes reject caller mistakes in validate() (400 since v1.71, F-I2),
the HTTP status codes through Flask's test client where Flask is installed, and that app.py imports cleanly (with a
stand-in flask module where Flask is missing). v1.73: four modes — the HTTPS connectors live in server/connectors/."""
import pathlib
import tempfile
import unittest
from unittest import mock

import testsupport
from connectors import MODES, Mode, jdbc_db, unknown_mode_message

HERE = pathlib.Path(__file__).resolve().parent
V = {k: m.validate for k, m in MODES.items()}
DUCK_REQUIRED = "A DuckDB file path is required (e.g. /data/warehouse.duckdb)"
LAKE_REQUIRED = "At least one file path, glob or URL is required (e.g. s3://bucket/bronze/claims/*.parquet)"


class Shape(unittest.TestCase):
    def test_modes(self):
        self.assertEqual(list(MODES), ["duckdb", "lakefiles", "sqlalchemy", "jdbc"])
        for name, mode in MODES.items():
            self.assertTrue(isinstance(mode, Mode) and callable(mode.validate) and callable(mode.run), name)

    def test_unknown_mode_text(self):
        self.assertEqual(unknown_mode_message(), "mode must be 'duckdb', 'lakefiles', 'sqlalchemy' or 'jdbc'")


class Validation(unittest.TestCase):
    def test_sqlalchemy_and_jdbc(self):
        self.assertEqual(V["sqlalchemy"]({}), "A SQLAlchemy connection URL is required (e.g. mysql+pymysql://user:pass@host/db)")
        self.assertEqual(V["sqlalchemy"]({"url": "host/db"}), V["sqlalchemy"]({"url": "  "}))
        self.assertIsNone(V["sqlalchemy"]({"url": "mysql+pymysql://u:p@h/db"}))
        self.assertEqual(V["jdbc"]({"url": "mysql://x"}), "A JDBC URL is required (jdbc:…)")
        self.assertEqual(V["jdbc"]({"url": "jdbc:db2://h/db"}), "The JDBC driver class is required (e.g. com.ibm.db2.jcc.DB2Driver)")
        jar_dir = tempfile.mkdtemp()
        pathlib.Path(jar_dir, "db2jcc4.jar").write_bytes(b"")
        with mock.patch.object(jdbc_db, "JDBC_DRIVER_DIR", jar_dir):
            ok = {"url": " jdbc:db2://h/db ", "driverClass": "com.ibm.db2.jcc.DB2Driver", "jar": "db2jcc4.jar"}
            self.assertIsNone(V["jdbc"](ok))
            # v1.74 (F-I1): the jar is checked in validate (400) — it used to fail in run() with 502
            self.assertEqual(V["jdbc"]({**ok, "jar": None}), "Provide the file name of a driver .jar located in the server's JDBC driver directory")
            self.assertEqual(V["jdbc"]({**ok, "jar": "../../etc/passwd"}), "Provide the file name of a driver .jar located in the server's JDBC driver directory")
            self.assertTrue(V["jdbc"]({**ok, "jar": "missing.jar"}).startswith("Driver jar not found on the server:"))

    def test_non_string_input_is_a_caller_mistake(self):   # v1.74 (F-I1): was 502 "AttributeError…"
        self.assertEqual(V["sqlalchemy"]({"url": 5}), "url must be a string")
        self.assertEqual(V["sqlalchemy"]({"url": "sqlite://", "schema": ["a"]}), "schema must be a string")
        for key in ("url", "driverClass", "jar", "user", "password", "schema"):
            self.assertEqual(V["jdbc"]({"url": "jdbc:x://h", "driverClass": "D", "jar": "d.jar", key: 1}), f"{key} must be a string", key)

    def test_duckdb(self):   # caller mistakes are validate() texts since v1.71 (F-I2: 400, not RuntimeError → 502)
        self.assertEqual(V["duckdb"]({}), DUCK_REQUIRED)
        self.assertEqual(V["duckdb"]({"path": "  "}), DUCK_REQUIRED)
        self.assertEqual(V["duckdb"]({"path": ["x"]}), DUCK_REQUIRED)
        self.assertEqual(V["duckdb"]({"path": "/nonexistent/dir/warehouse.duckdb"}), "DuckDB file not found on the inspector host: /nonexistent/dir/warehouse.duckdb")
        self.assertIsNone(V["duckdb"]({"path": ":memory:"}))
        self.assertIsNone(V["duckdb"]({"path": str(HERE / "app.py")}))   # existence is all validate checks
        self.assertTrue(V["duckdb"]({"path": ":memory:", "schema": 7}).startswith("schema must be a string"))

    def test_lakefiles(self):
        for body in ({}, {"paths": []}, {"paths": [" ", ""]}, {"paths": "\n  \n"}, {"paths": 42}):
            self.assertEqual(V["lakefiles"](body), LAKE_REQUIRED, body)
        self.assertIsNone(V["lakefiles"]({"paths": ["/lake/a.parquet"]}))
        self.assertIsNone(V["lakefiles"]({"paths": "/lake/a.parquet\n/lake/b.csv", "format": "auto", "schema": "bronze", "credentials": {}}))
        self.assertEqual(V["lakefiles"]({"paths": ["/x"], "format": "orc"}), "format must be 'auto', 'parquet', 'csv', 'json', 'delta' or 'iceberg'")
        self.assertTrue(V["lakefiles"]({"paths": ["/x"], "schema": 3}).startswith("schema must be a string"))
        self.assertTrue(V["lakefiles"]({"paths": ["/x"], "credentials": "s3"}).startswith("credentials must be an object"))
        self.assertEqual(V["lakefiles"]({"paths": ["/x"], "credentials": {"s3Key": 1}}), "credentials.s3Key must be a string")
        self.assertEqual(V["lakefiles"]({"paths": ["/x"], "credentials": {"azureSas": "?sv=1"}}), "The Azure SAS token / account key needs the storage account name (azureAccount)")
        self.assertEqual(V["lakefiles"]({"paths": ["/x"], "credentials": {"s3Secret": "s"}}), "The S3 secret access key needs the access key ID (s3Key)")
        self.assertIsNone(V["lakefiles"]({"paths": ["s3://b/x"], "credentials": {"s3Key": "k", "s3Secret": "s", "s3Region": "", "s3Endpoint": ""}}))
        self.assertIsNone(V["lakefiles"]({"paths": ["az://c/x"], "credentials": {"azureAccount": "acc", "azureSas": "?sv=1", "azureKey": ""}}))

    def test_run_refuses_unusable_input(self):
        """The direct entry points still refuse unusable input themselves (RuntimeError); a missing driver is ModuleNotFoundError."""
        for name, body, text in (("lakefiles", {"paths": []}, "At least one file path"), ("duckdb", {"path": ""}, "A DuckDB file path is required")):
            with self.subTest(name):
                try:
                    MODES[name].run(body)
                    self.fail(f"{name}: expected RuntimeError")
                except RuntimeError as e:
                    self.assertIn(text, str(e))
                except ModuleNotFoundError as e:
                    self.assertEqual(e.name, "duckdb")   # driver not installed here — app.py turns this into the 'Missing driver' 502


class App(unittest.TestCase):
    def test_imports_and_uses_the_registry(self):
        app = testsupport.import_app()
        self.assertIs(app.MODES, MODES)
        self.assertTrue(callable(app.inspect_route) and callable(app.health))

    @unittest.skipUnless(testsupport.have("flask"), "flask not installed")
    def test_http_status_codes(self):
        client = testsupport.import_app().app.test_client()

        def post(body):
            r = client.post("/inspect", json=body)
            return r.status_code, (r.get_json() or {}).get("error")
        self.assertEqual(post({"mode": "duckdb"}), (400, DUCK_REQUIRED))
        self.assertEqual(post({"mode": "duckdb", "path": "/nonexistent/dir/warehouse.duckdb"}), (400, "DuckDB file not found on the inspector host: /nonexistent/dir/warehouse.duckdb"))
        self.assertEqual(post({"mode": "lakefiles"}), (400, LAKE_REQUIRED))
        self.assertEqual(post({"mode": "lakefiles", "paths": []}), (400, LAKE_REQUIRED))
        self.assertEqual(post({"mode": "lakefiles", "paths": ["/x"], "format": "orc"})[0], 400)
        self.assertEqual(post({"mode": "nope"}), (400, unknown_mode_message()))
        self.assertEqual(post({}), (400, unknown_mode_message()))
        self.assertEqual(post({"mode": 3})[0], 400)
        self.assertEqual(post({"mode": "odata", "url": "https://h/svc"}), (400, unknown_mode_message()))   # v1.73: served by the Node server only
        self.assertEqual(post({"mode": "sqlalchemy"}), (400, "A SQLAlchemy connection URL is required (e.g. mysql+pymysql://user:pass@host/db)"))
        self.assertEqual(client.get("/health").get_json(), {"ok": True})


if __name__ == "__main__":
    testsupport.main()
