"""
DuckDB mode of the source inspector (v1.70): a DuckDB database file on this
host, read with the native duckdb module (read-only by default; comments and
primary keys included). `duckdb` is imported lazily.

v1.71: the file-path checks answer 400 from validate() (F-I2); the catalog
queries bind the database name as a parameter instead of splicing it into
the statement text (F-I5).
"""
import os

from .common import column, schema, table


DUCKDB_SYSTEM_SCHEMAS = {"information_schema", "pg_catalog"}

# Catalog queries, in a (with comments, without comments) pair each: the comment columns exist since
# DuckDB 0.10 — the second statement is the fallback on older builds. `?` is the database name.
_OBJECTS_SQL = (
    "SELECT schema_name, table_name, 'TABLE', coalesce(comment, '') FROM duckdb_tables() WHERE database_name = ? AND NOT internal "
    "UNION ALL SELECT schema_name, view_name, 'VIEW', coalesce(comment, '') FROM duckdb_views() WHERE database_name = ? AND NOT internal",
    "SELECT schema_name, table_name, 'TABLE', '' FROM duckdb_tables() WHERE database_name = ? AND NOT internal "
    "UNION ALL SELECT schema_name, view_name, 'VIEW', '' FROM duckdb_views() WHERE database_name = ? AND NOT internal",
)
_COLUMNS_SQL = (
    "SELECT schema_name, table_name, column_name, data_type, is_nullable, coalesce(comment, ''), column_index FROM duckdb_columns() "
    "WHERE database_name = ? AND NOT internal ORDER BY column_index",
    "SELECT schema_name, table_name, column_name, data_type, is_nullable, '', column_index FROM duckdb_columns() "
    "WHERE database_name = ? AND NOT internal ORDER BY column_index",
)
_PKS_SQL = "SELECT schema_name, table_name, constraint_column_names FROM duckdb_constraints() WHERE database_name = ? AND constraint_type = 'PRIMARY KEY'"


def _path_problem(path):
    """The caller-side problem with a DuckDB `path` (error text) or None, plus the normalised path.
    Checked without opening DuckDB, so validate() can answer it as 400 (v1.71)."""
    p = os.path.expanduser((path if isinstance(path, str) else "").strip())
    if not p:
        return "A DuckDB file path is required (e.g. /data/warehouse.duckdb)", p
    if p != ":memory:" and not os.path.isfile(p):
        return f"DuckDB file not found on the inspector host: {p}", p
    return None, p


def inspect_duckdb(path, only_schema=None, read_only=True):
    """Introspects a DuckDB database file with the native duckdb module (no SQLAlchemy dialect needed).
    Tables and views incl. COMMENT ON texts, columns with types/nullability/comments, primary keys."""
    import duckdb

    problem, p = _path_problem(path)
    if problem:
        raise RuntimeError(problem)   # direct callers; the /inspect route rejects these in validate() first
    con = duckdb.connect(p, read_only=bool(read_only) and p != ":memory:")
    try:
        db = con.execute("SELECT current_database()").fetchone()[0]

        def q(sql, fallback_sql=None):
            params = [db] * sql.count("?")
            try:
                return con.execute(sql, params).fetchall()
            except Exception:
                if fallback_sql is None:
                    raise
                return con.execute(fallback_sql, [db] * fallback_sql.count("?")).fetchall()

        objs = q(*_OBJECTS_SQL)
        cols = q(*_COLUMNS_SQL)
        try:
            pks = q(_PKS_SQL)
        except Exception:
            pks = []

        pk_of = {}
        for sc, tb, names in pks:
            pk_of.setdefault((sc, tb), set()).update(names or [])
        cols_of = {}
        for sc, tb, cn, dt, nullable, comment, _idx in cols:
            cols_of.setdefault((sc, tb), []).append(column(cn, str(dt).upper() or "STRING", bool(nullable), comment or "",
                                                           cn in pk_of.get((sc, tb), set())))
        by_schema = {}
        for sc, tb, ttype, comment in sorted(objs):
            if sc.lower() in DUCKDB_SYSTEM_SCHEMAS:
                continue
            if only_schema and sc != only_schema:
                continue
            by_schema.setdefault(sc, []).append(table(tb, ttype, comment or "", cols_of.get((sc, tb), [])))
        return [schema(sc, tbs) for sc, tbs in sorted(by_schema.items())]
    finally:
        con.close()


# ── /inspect mode: validate(body) → error text | None, run(body) → payload ──

def validate(body):
    """Caller mistakes answer 400 (v1.71, F-I2): a missing path, or a file that is not on the inspector host."""
    problem, _p = _path_problem(body.get("path"))
    if problem:
        return problem
    only = body.get("schema")
    if only is not None and not isinstance(only, str):
        return "schema must be a string (the name of one schema to restrict the import to)"
    return None


def run(body):
    schemas = inspect_duckdb(body.get("path"), body.get("schema") or None, body.get("readOnly", True))
    return {"schemas": schemas, "skipped": []}
