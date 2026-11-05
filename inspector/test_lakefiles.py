"""Offline test of the lake files mode against real files (v1.55): python3 inspector/test_lakefiles.py

Local Parquet + CSV via DuckDB; skipped when the duckdb module is not installed. (Until v1.72 this lived in
test_connectors.py next to the OData / Schema Registry / Power BI checks, which went with the Python copies of
those connectors.)"""
import tempfile
import unittest

import testsupport
from connectors import lakefiles


@unittest.skipUnless(testsupport.have("duckdb"), "duckdb not installed")
class LakeFiles(unittest.TestCase):
    def test_parquet_and_csv(self):
        import duckdb
        d = tempfile.mkdtemp()
        duckdb.sql(f"COPY (SELECT 1 AS id, 'a' AS name) TO '{d}/claims.parquet'")
        with open(f"{d}/policies.csv", "w") as f:
            f.write("pid,amount\n1,2.5\n")
        schemas, skipped = lakefiles.inspect_lakefiles([f"{d}/claims.parquet", f"{d}/policies.csv", f"{d}/nothing/*.parquet"], "auto", "bronze")
        tb = {t["name"]: t for t in schemas[0]["tables"]}
        self.assertEqual(schemas[0]["name"], "bronze")
        self.assertEqual(set(tb), {"claims", "policies"})
        self.assertEqual(tb["claims"]["type"], "FILE")
        self.assertEqual(tb["policies"]["columns"][1]["type_text"], "DOUBLE")
        self.assertEqual(list(tb["claims"]["columns"][0]), ["name", "type_text", "nullable", "comment", "isPK"])   # key order unchanged by common.column()
        self.assertEqual(len(skipped), 1)


class Names(unittest.TestCase):
    def test_table_name_and_format(self):
        self.assertEqual(lakefiles._lake_table_name("s3://b/lake/policies/year=2024/*.parquet"), "policies")
        self.assertEqual(lakefiles._lake_format("abfss://c@a.dfs.core.windows.net/silver/customer.delta/", "auto"), "delta")


if __name__ == "__main__":
    testsupport.main()
