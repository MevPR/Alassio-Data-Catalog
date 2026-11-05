"""
Lake files mode of the source inspector (v1.70): Parquet / CSV / JSON / Delta /
Iceberg files or globs on local disk, S3 or Azure, read with DuckDB (v1.55).
`duckdb` is imported lazily.

v1.71: the input checks (paths, format, credentials) answer 400 from
validate() (F-I2); the CREATE SECRET statements are built by the pure
secret_statement() with every credential bound as a parameter (F-I5).
"""
import re

from .common import column, schema, sql_ident, table


LAKE_EXT = {"parquet": "read_parquet", "csv": "read_csv_auto", "json": "read_json_auto", "delta": "delta_scan", "iceberg": "iceberg_scan"}
LAKE_FORMATS = ("auto", *LAKE_EXT)
_REMOTE_SCHEMES = ("s3://", "s3a://", "gs://", "http://", "https://", "az://", "abfs://", "abfss://", "azure://")
_AZURE_SCHEMES = ("az://", "abfs://", "abfss://", "azure://")
_S3_SCHEMES = ("s3://", "s3a://")


def _lake_format(path, fmt):
    if fmt and fmt != "auto":
        return fmt
    p = path.lower().rstrip("/")
    if p.endswith(("_delta_log", ".delta")) or "/_delta_log" in p:
        return "delta"
    if p.endswith(".iceberg") or "/metadata/" in p and p.endswith(".json"):
        return "iceberg"
    for ext in ("parquet", "csv", "json", "jsonl", "ndjson", "tsv"):
        if p.endswith("." + ext) or p.endswith("." + ext + ".gz") or ("*." + ext) in p or p.endswith("." + ext + "/"):
            return {"jsonl": "json", "ndjson": "json", "tsv": "csv"}.get(ext, ext)
    return "parquet"


def _lake_table_name(path):
    """Table name from a path or glob: the last segment that is not a wildcard, without extension / hive suffixes."""
    segs = [x for x in re.split(r"[\\/]+", path.strip()) if x]
    for seg in reversed(segs):
        if any(ch in seg for ch in "*?[") or seg.startswith("_"):
            continue
        name = seg
        while True:
            stripped = re.sub(r"\.(parquet|csv|tsv|json|jsonl|ndjson|gz|zst|snappy|delta|iceberg)$", "", name, flags=re.I)
            if stripped == name:
                break
            name = stripped
        if "=" in name:
            continue   # hive partition dir (year=2024) — use the parent
        if name and "://" not in name:
            return re.sub(r"[^\w.-]+", "_", name) or "files"
    return "files"


_PATHS_REQUIRED = "At least one file path, glob or URL is required (e.g. s3://bucket/bronze/claims/*.parquet)"


def _path_list(paths):
    """The stripped, non-empty entries of `paths` (a list, or one string with a path per line)."""
    if isinstance(paths, str):
        paths = paths.splitlines()
    if not isinstance(paths, (list, tuple)):
        return []
    return [p.strip() for p in paths if isinstance(p, str) and p.strip()]


def secret_statement(kind, creds):
    """The DuckDB `CREATE SECRET` for the `kind` ("s3" or "azure") credentials in `creds`, as (sql, params),
    or None when nothing in `creds` applies. Pure: every credential is a bound parameter, nothing from the
    request reaches the statement text (v1.71, F-I5). DuckDB accepts `?` for every secret option value;
    the only literals are the fixed TYPE / PROVIDER / URL_STYLE keywords."""
    creds = creds or {}
    if kind == "azure":
        if creds.get("azureConnectionString"):
            return "CREATE SECRET az (TYPE azure, CONNECTION_STRING ?)", [creds["azureConnectionString"]]
        if creds.get("azureAccount"):
            if creds.get("azureSas"):
                return "CREATE SECRET az (TYPE azure, CONNECTION_STRING ?)", [f"AccountName={creds['azureAccount']};SharedAccessSignature={creds['azureSas'].lstrip('?')}"]
            if creds.get("azureKey"):
                return "CREATE SECRET az (TYPE azure, CONNECTION_STRING ?)", [f"DefaultEndpointsProtocol=https;AccountName={creds['azureAccount']};AccountKey={creds['azureKey']};EndpointSuffix=core.windows.net"]
            return "CREATE SECRET az (TYPE azure, PROVIDER credential_chain, ACCOUNT_NAME ?)", [creds["azureAccount"]]
        return None
    if kind == "s3":
        if not (creds.get("s3Key") or creds.get("s3Endpoint")):
            return None
        parts, params = ["TYPE s3"], []
        if creds.get("s3Key"):
            parts += ["KEY_ID ?", "SECRET ?"]
            params += [creds["s3Key"], creds.get("s3Secret") or ""]
        if creds.get("s3Region"):
            parts.append("REGION ?")
            params.append(creds["s3Region"])
        if creds.get("s3Endpoint"):
            parts += ["ENDPOINT ?", "URL_STYLE 'path'", "USE_SSL ?"]
            params += [re.sub(r"^https?://", "", creds["s3Endpoint"]).rstrip("/"), not creds["s3Endpoint"].startswith("http://")]
        return f"CREATE SECRET s3 ({', '.join(parts)})", params
    raise ValueError(f"unknown secret kind {kind!r}")


def _credentials_problem(creds):
    """The caller-side problem with the `credentials` object (error text) or None (v1.71, F-I2)."""
    if creds is None:
        return None
    if not isinstance(creds, dict):
        return "credentials must be an object (azureConnectionString, azureAccount + azureSas / azureKey, or s3Key + s3Secret)"
    for key, value in creds.items():
        if value is not None and not isinstance(value, str):
            return f"credentials.{key} must be a string"
    if (creds.get("azureSas") or creds.get("azureKey")) and not creds.get("azureAccount") and not creds.get("azureConnectionString"):
        return "The Azure SAS token / account key needs the storage account name (azureAccount)"
    if creds.get("s3Secret") and not creds.get("s3Key"):
        return "The S3 secret access key needs the access key ID (s3Key)"
    return None


def inspect_lakefiles(paths, fmt="auto", schema_name="files", creds=None):
    import duckdb

    creds = creds or {}
    plist = _path_list(paths)
    if not plist:
        raise RuntimeError(_PATHS_REQUIRED)   # direct callers; the /inspect route rejects this in validate() first
    con = duckdb.connect(":memory:")
    try:
        loaded = set()

        def ext(name):
            if name in loaded:
                return
            try:
                con.execute(f"INSTALL {sql_ident(name)}; LOAD {sql_ident(name)};")
            except Exception as e:
                raise RuntimeError(f"DuckDB extension '{name}' could not be loaded on the inspector host ({e}) — the host needs internet access once to install it")
            loaded.add(name)

        remote = any(p.startswith(_REMOTE_SCHEMES) for p in plist)
        if remote:
            ext("httpfs")
        if any(p.startswith(_AZURE_SCHEMES) for p in plist):
            ext("azure")
            secret = secret_statement("azure", creds)
            if secret:
                con.execute(*secret)
        if any(p.startswith(_S3_SCHEMES) for p in plist):
            secret = secret_statement("s3", creds)
            if secret:
                con.execute(*secret)
        tables, skipped = [], []
        for path in plist:
            f = _lake_format(path, fmt)
            if f in ("delta", "iceberg"):
                ext(f)
            fn = LAKE_EXT.get(f, "read_parquet")
            src = path.replace("s3a://", "s3://")
            try:
                rows = con.execute(f"DESCRIBE SELECT * FROM {fn}(?)", [src]).fetchall()
            except Exception as e:
                skipped.append(f"{path}: {str(e).splitlines()[0][:160]}")
                continue
            cols = [column(r[0], str(r[1]).upper(), str(r[2]).upper() != "NO") for r in rows]
            name = _lake_table_name(path)
            base = name
            n = 2
            while any(t["name"] == name for t in tables):
                name = f"{base}_{n}"
                n += 1
            tables.append(table(name, "FILE", f"{f.upper()} · {path}", cols))
        if not tables:
            raise RuntimeError("No readable files: " + "; ".join(skipped)[:600])
        return [schema(schema_name or "files", tables)], skipped
    finally:
        con.close()


# ── /inspect mode ───────────────────────────────────────────────────────────

def validate(body):
    """Caller mistakes answer 400 (v1.71, F-I2): no paths, an unknown format, an inconsistent credentials object."""
    if not _path_list(body.get("paths")):
        return _PATHS_REQUIRED
    fmt = body.get("format")
    if fmt and fmt not in LAKE_FORMATS:
        return "format must be " + ", ".join(f"'{f}'" for f in LAKE_FORMATS[:-1]) + f" or '{LAKE_FORMATS[-1]}'"
    only = body.get("schema")
    if only is not None and not isinstance(only, str):
        return "schema must be a string (the schema name the files are listed under in the catalog)"
    return _credentials_problem(body.get("credentials"))


def run(body):
    schemas, skipped = inspect_lakefiles(_path_list(body.get("paths")), body.get("format") or "auto", (body.get("schema") or "files").strip(), body.get("credentials") or {})
    return {"schemas": schemas, "skipped": skipped}
