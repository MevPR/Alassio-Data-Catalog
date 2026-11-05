"""
JDBC mode of the source inspector (v1.70): any JDBC driver whose .jar is placed
in JDBC_DRIVER_DIR on the server; introspection uses the standard JDBC
DatabaseMetaData API (requires Java + jaydebeapi, both imported lazily).
"""
import os
import re

from .common import column, is_system_schema, schema, table, text_problem

JDBC_DRIVER_DIR = os.environ.get("JDBC_DRIVER_DIR", "/opt/datahub-catalog/jdbc-drivers")


def jar_problem(jar):
    """(error text | None, absolute jar path). v1.74 (F-I1): checked in validate — a wrong or missing jar is the
    caller's mistake (400), it used to surface from run() as 502."""
    jar_name = os.path.basename(jar or "")
    if not jar_name or not re.fullmatch(r"[\w.\-]+\.jar", jar_name):
        return "Provide the file name of a driver .jar located in the server's JDBC driver directory", None
    jar_path = os.path.join(JDBC_DRIVER_DIR, jar_name)
    if not os.path.isfile(jar_path):
        return f"Driver jar not found on the server: {jar_path} — copy it to {JDBC_DRIVER_DIR}/", None
    return None, jar_path


def inspect_jdbc(url, driver_class, jar, user, password, only_schema=None):
    try:
        import jaydebeapi
    except ImportError:
        # kept as a RuntimeError (502) on purpose: the hint names the Java runtime, which a bare "pip install" would not
        raise RuntimeError("JDBC support is not installed on the server (pip install jaydebeapi JPype1, plus a Java runtime)")

    problem, jar_path = jar_problem(jar)
    if problem:
        raise RuntimeError(problem)

    conn = jaydebeapi.connect(driver_class, url, [user or "", password or ""], jar_path)
    try:
        meta = conn.jconn.getMetaData()

        def rows(rs, fields):
            got = []
            while rs.next():
                got.append({f: (rs.getString(f) if rs.getString(f) is not None else "") for f in fields})
            rs.close()
            return got

        tbl_rows = rows(meta.getTables(None, only_schema, "%", ["TABLE", "VIEW"]),
                        ["TABLE_SCHEM", "TABLE_NAME", "TABLE_TYPE", "REMARKS"])
        by_schema = {}
        for t in tbl_rows:
            sc = t["TABLE_SCHEM"] or "default"
            if is_system_schema(sc):   # v1.71: shared filter (common.py)
                continue
            pks = {r["COLUMN_NAME"] for r in rows(meta.getPrimaryKeys(None, t["TABLE_SCHEM"] or None, t["TABLE_NAME"]),
                                                  ["COLUMN_NAME"])}
            cols = []
            for c in rows(meta.getColumns(None, t["TABLE_SCHEM"] or None, t["TABLE_NAME"], "%"),
                          ["COLUMN_NAME", "TYPE_NAME", "IS_NULLABLE", "REMARKS"]):
                cols.append(column(c["COLUMN_NAME"], (c["TYPE_NAME"] or "STRING").upper(), c["IS_NULLABLE"] != "NO",
                                   c["REMARKS"] or "", c["COLUMN_NAME"] in pks))
            by_schema.setdefault(sc, []).append(table(t["TABLE_NAME"], "VIEW" if t["TABLE_TYPE"] == "VIEW" else "TABLE", t["REMARKS"] or "", cols))
        return [schema(sc, sorted(tbs, key=lambda x: x["name"])) for sc, tbs in sorted(by_schema.items())]
    finally:
        conn.close()


# ── /inspect mode ───────────────────────────────────────────────────────────

def validate(body):
    problem = text_problem(body, "url", "driverClass", "jar", "user", "password", "schema")
    if problem:
        return problem
    url = (body.get("url") or "").strip()
    if not url.startswith("jdbc:"):
        return "A JDBC URL is required (jdbc:…)"
    if not body.get("driverClass"):
        return "The JDBC driver class is required (e.g. com.ibm.db2.jcc.DB2Driver)"
    return jar_problem(body.get("jar"))[0]


def run(body):
    url = (body.get("url") or "").strip()
    schemas = inspect_jdbc(url, body["driverClass"], body.get("jar"),
                           body.get("user"), body.get("password"), body.get("schema") or None)
    return {"schemas": schemas, "skipped": []}
