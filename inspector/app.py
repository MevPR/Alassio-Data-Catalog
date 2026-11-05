"""
Alassio Data Catalog — source inspector service (v1.7).

Introspects source systems and returns their metadata (schemas, tables,
views, columns, data types, nullability, primary keys, comments) in the
catalog's import format.

Modes (one module per family in the `connectors` package, registered in
connectors.MODES — v1.70):
  * duckdb     — a DuckDB database file on this host, read with the native
                 duckdb module (read-only by default; comments and PKs included).
                 → connectors/duckdb_db.py
  * sqlalchemy — any database with an installed SQLAlchemy dialect
                 (MySQL/MariaDB and PostgreSQL out of the box; DB2,
                 SAP HANA etc. after installing the optional dialects).
                 → connectors/sqlalchemy_db.py
  * jdbc       — any JDBC driver: the .jar is placed in JDBC_DRIVER_DIR
                 on the server, introspection uses the standard JDBC
                 DatabaseMetaData API (requires Java + jaydebeapi).
                 → connectors/jdbc_db.py
  * lakefiles  — Parquet / CSV / JSON / Delta / Iceberg files or globs on
                 local disk, S3 or Azure, read with DuckDB (v1.55).
                 → connectors/lakefiles.py

The pure-HTTPS sources (OData / SuccessFactors, Kafka Schema Registry, Power BI,
Informatica) are served by the catalog server itself (server/connectors/, Node)
since v1.73 removed their Python copies.

This module keeps Flask, /health and the /inspect route: look the mode up in
connectors.MODES, validate (400), run, apply the shared "No tables found" 404
and the driver / RuntimeError → 502 handlers.

Binds to 127.0.0.1 only. Credentials are used per request and never stored.
"""
import os

# `connectors` sits next to this file: `python app.py` (systemd: /opt/datahub-catalog/inspector/venv/bin/python
# /opt/datahub-catalog/inspector/app.py) puts the script's directory on sys.path, so no path setup is needed (v1.73).
from flask import Flask, request, jsonify

from connectors import MODES, unknown_mode_message

app = Flask(__name__)

PORT = int(os.environ.get("INSPECTOR_PORT", "3001"))


def _err(msg, code=400):
    return jsonify({"error": msg}), code


# ── API ─────────────────────────────────────────────────────────────────────

@app.post("/inspect")
def inspect_route():
    body = request.get_json(silent=True) or {}
    name = body.get("mode")
    mode = MODES.get(name) if isinstance(name, str) else None   # a non-string mode is "unknown", not a lookup error
    try:
        if mode is None:
            return _err(unknown_mode_message())
        problem = mode.validate(body)
        if problem:
            return _err(problem)
        payload = mode.run(body)
        schemas, skipped = payload["schemas"], payload.get("skipped") or []
        total = sum(len(s["tables"]) for s in schemas)
        if total == 0:
            return _err("No tables found — check database/schema name and the user's read permissions", 404)
        return jsonify({"schemas": schemas, **({"skipped": skipped} if skipped else {})})
    except ModuleNotFoundError as e:
        return _err(f"Missing driver on the server: {e.name} — install it in the inspector's virtualenv (pip install {e.name})", 502)
    except RuntimeError as e:
        return _err(str(e), 502)
    except Exception as e:
        return _err(f"{type(e).__name__}: {e}", 502)


@app.get("/health")
def health():
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=PORT)
