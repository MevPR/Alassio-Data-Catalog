"""
SQLAlchemy mode of the source inspector (v1.70): any database with an installed
SQLAlchemy dialect (MySQL/MariaDB and PostgreSQL out of the box; DB2, SAP HANA
etc. after installing the optional dialects). `sqlalchemy` is imported lazily so
a missing dialect surfaces as the "Missing driver on the server" 502.
"""
from .common import text_problem, column, is_system_schema, schema, table


def inspect_sqlalchemy(url, only_schema=None):
    from sqlalchemy import create_engine, inspect

    engine = create_engine(url, pool_pre_ping=True)
    try:
        insp = inspect(engine)
        default_db = getattr(engine.url, "database", None)

        if only_schema:
            schemas = [only_schema]
        else:
            try:
                schemas = insp.get_schema_names()
            except Exception:
                schemas = [None]
            schemas = [s for s in schemas if s and not is_system_schema(s)]   # v1.71: shared filter (common.py)
            # MySQL/MariaDB: schema == database → restrict to the URL's database
            if engine.dialect.name in ("mysql", "mariadb") and default_db:
                schemas = [default_db]
            if not schemas:
                schemas = [default_db] if default_db else [None]

        out = []
        skipped = []
        for sc in schemas:
            tables = []
            names = [(n, "TABLE") for n in insp.get_table_names(schema=sc)]
            try:
                names += [(n, "VIEW") for n in insp.get_view_names(schema=sc)]
            except Exception:
                pass
            for name, ttype in sorted(names):
                try:
                    comment = ""
                    try:
                        comment = (insp.get_table_comment(name, schema=sc) or {}).get("text") or ""
                    except Exception:
                        pass
                    try:
                        pk = set((insp.get_pk_constraint(name, schema=sc) or {}).get("constrained_columns") or [])
                    except Exception:
                        pk = set()
                    cols = []
                    for c in insp.get_columns(name, schema=sc):
                        cols.append(column(c["name"], str(c.get("type", "")).upper() or "STRING", bool(c.get("nullable", True)),
                                           c.get("comment") or "", c["name"] in pk))
                    tables.append(table(name, ttype, comment, cols))
                except Exception as e:
                    # e.g. missing SHOW VIEW privilege on a single view — skip it, keep the rest
                    skipped.append(f"{sc}.{name}: {type(e).__name__}")
            out.append(schema(sc or default_db or "default", tables))
        return out, skipped
    finally:
        engine.dispose()


# ── /inspect mode: validate(body) → error text | None, run(body) → payload ──

def validate(body):
    problem = text_problem(body, "url", "schema")
    if problem:
        return problem
    url = (body.get("url") or "").strip()
    if not url or "://" not in url:
        return "A SQLAlchemy connection URL is required (e.g. mysql+pymysql://user:pass@host/db)"
    return None


def run(body):
    url = (body.get("url") or "").strip()
    schemas, skipped = inspect_sqlalchemy(url, body.get("schema") or None)
    return {"schemas": schemas, "skipped": skipped}
