"""
Helpers shared by several inspector connectors (v1.70).
"""


# ── output records (v1.73, F-I3) ────────────────────────────────────────────
# Every mode returns the same shapes; building them here keeps the key order and the defaults in one place
# (the server's import and the offline tests read these dicts).

def column(name, type_text, nullable=True, comment="", is_pk=False):
    """One attribute: {"name", "type_text", "nullable", "comment", "isPK"}."""
    return {"name": name, "type_text": type_text, "nullable": nullable, "comment": comment, "isPK": is_pk}


def table(name, type_, comment, columns):
    """One table / view / file: {"name", "type", "comment", "columns"}."""
    return {"name": name, "type": type_, "comment": comment, "columns": columns}


def schema(name, tables, comment=""):
    """One schema: {"name", "comment", "tables"}."""
    return {"name": name, "comment": comment, "tables": tables}


# Schemas that never hold business tables — skipped by the sqlalchemy and jdbc modes (see is_system_schema).
SYSTEM_SCHEMAS = {
    "information_schema", "performance_schema", "mysql", "sys",
    "pg_catalog", "pg_toast", "sysibm", "syscat", "sysstat", "sysibmadm",
    "systools", "syspublic", "sys_bic", "_sys_bi", "_sys_repo", "_sys_statistics",
}

# Prefixes of the engine-managed schemas the sqlalchemy and jdbc modes skip ("sys*" covers DB2's SYS*,
# SQL Server's sys, HANA's SYS / _SYS_* is in the set above). DuckDB keeps its own, shorter list in
# duckdb_db.py: a DuckDB file has no "sys*" catalog schemas, so a user schema named e.g. "system_data"
# must stay visible there.
_SYSTEM_SCHEMA_PREFIXES = ("sys", "information_schema")


def is_system_schema(name):
    """True for an engine-managed schema that never holds business tables (sqlalchemy and jdbc modes, v1.71).
    Unifies the two filters the modes carried until v1.70: the SYSTEM_SCHEMAS set plus the sys* / information_schema* prefixes."""
    n = (name or "").lower()
    return n in SYSTEM_SCHEMAS or n.startswith(_SYSTEM_SCHEMA_PREFIXES)


# ── request checks (v1.74, F-I1 of the third review) ────────────────────────
# A caller mistake must answer 400 in every mode — a number where text belongs used to crash inside validate/run
# ({"mode": "sqlalchemy", "url": 5} → 502 "AttributeError…").

def text_problem(body, *keys):
    """The first of `keys` that is present but not a string, as an error text; None when all are absent or strings."""
    for k in keys:
        v = body.get(k)
        if v is not None and not isinstance(v, str):
            return f"{k} must be a string"
    return None


# ── SQL text helpers (v1.71, F-I5) ──────────────────────────────────────────
# Values go into DuckDB as bound parameters wherever the statement accepts one (WHERE … = ?, CREATE SECRET
# options). These two cover the rest — identifiers (INSTALL / LOAD <extension>) and the few places where a
# literal has to be part of the statement text — and are the only way text may be spliced into SQL here.

def sql_quote(value):
    """A SQL string literal for `value`: single quotes, embedded quotes doubled ('O''Brien')."""
    return "'" + str(value).replace("'", "''") + "'"


def sql_ident(name):
    """A quoted SQL identifier for `name`: double quotes, embedded double quotes doubled ("my""ext")."""
    return '"' + str(name).replace('"', '""') + '"'
