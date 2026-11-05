"""
Connector registry of the source inspector (v1.70).

Each /inspect mode lives in its own module of this package and is registered
here as a `Mode`:

  * validate(body) → an error text (answered as HTTP 400 by app.py) or None
  * run(body)      → the response payload {"schemas": [...], "skipped": [...]}

app.py looks the mode up in MODES, validates, runs, and applies the shared
"No tables found" 404 and the driver / RuntimeError → 502 handling. The order
of MODES is the order of the "mode must be …" error text.

v1.73: the Python copies of the pure-HTTPS connectors (OData/SuccessFactors,
Kafka Schema Registry, Power BI, Informatica) are gone — server/connectors/
(Node) is their only implementation since the v1.60 ports. The inspector keeps
the modes that need native drivers or a JVM. With the Power BI bundle gone every
mode answers the table-shaped payload, so app.py no longer guesses the response
shape (F-I8).
"""
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional

from . import duckdb_db, jdbc_db, lakefiles, sqlalchemy_db


@dataclass(frozen=True)
class Mode:
    """One /inspect mode: `validate` returns an error text or None, `run` returns {"schemas", "skipped"}."""
    validate: Callable[[dict], Optional[str]]
    run: Callable[[dict], Dict[str, Any]]


MODES: Dict[str, Mode] = {
    "duckdb": Mode(validate=duckdb_db.validate, run=duckdb_db.run),
    "lakefiles": Mode(validate=lakefiles.validate, run=lakefiles.run),
    "sqlalchemy": Mode(validate=sqlalchemy_db.validate, run=sqlalchemy_db.run),
    "jdbc": Mode(validate=jdbc_db.validate, run=jdbc_db.run),
}


def unknown_mode_message():
    """The 400 text for an unknown mode, built from the registry keys: "mode must be 'a', 'b' or 'c'"."""
    keys = [f"'{k}'" for k in MODES]
    return "mode must be " + ", ".join(keys[:-1]) + " or " + keys[-1]
