# Alassio Data Catalog — Technical reference

Detailed notes on individual subsystems. For installation see the deployment guides in this folder; for an overview see the [README](../README.md).

## Databricks edition

- **Packaging**: `deploy/databricks/app.yaml` carries the whole edition as environment (`DB_DRIVER=postgres`,
  `DB_PASSWORD_PROVIDER=databricks`, `AUTH_MODE=header`, `AUTH_GROUPS_FROM=databricks`, `INSPECTOR_URL=""`,
  `BACKUP_STORAGE=databricks`, `SCHEDULER=external`, …); `deploy/databricks/README.md` lists the workspace prerequisites
  (Lakebase instance, UC volume, secrets, Lakehouse Federation connections, user-authorization scope), the deploy
  commands and the Databricks Job that triggers the scheduled tasks.
- **MCP behind the platform sign-in**: in header mode a `/mcp` request without a recognised bearer acts as the forwarded
  identity — admins and stewards write, everyone else reads; a caller the group mapping denies gets 401; the audit log
  shows the human. `MCP_TOKEN`, agent keys and OAuth tokens keep working where they are used (the Pi).
- **Tasks**: `TASKS_TOKEN` is also accepted in the `X-Tasks-Token` header, because the platform consumes `Authorization`.
- **Lakebase**: `DB_HOST/PORT/USER/NAME` fall back to `PGHOST/PGPORT/PGUSER/PGDATABASE` (injected by an attached database
  resource); `PGSSLMODE=require` enables SSL when `DB_SSL` is unset.
- **Still to verify on a real workspace**: the Lakebase credential endpoint and token rotation, the scope that lets the
  app read the caller's groups, SMTP and API egress. Nothing changes on the Pi.

## Native connectors and the optional inspector

- **Native connectors** live in `server/connectors/`: `odata.js` (OData v2/v4 `$metadata`, SuccessFactors),
  `schema-registry.js` (Avro / JSON Schema / Protobuf), `powerbi.js` (admin Scanner API incl. the Entra client-credentials
  token), `informatica.js` (Catalog Search API), a tiny namespace-aware EDMX parser (`xml.js`) and an `http.js` transport
  on `node:http(s)` that honours *Skip TLS certificate verification* per request. No new npm dependency. Output shapes,
  filters and error texts are identical to the Python inspector; the Python fixtures of `inspector/test_connectors.py`
  are mirrored in `test/unit/connectors-native.test.js`.
- **Routing**: `POST /api/source-import/inspect` runs `odata`, `successfactors`, `kafka`, `powerbi` and `informatica`
  in-process and forwards `duckdb`, `lakefiles`, `sqlalchemy` and `jdbc` to the inspector (`INSPECTOR_URL`, default
  `http://127.0.0.1:3001`). `SOURCE_IMPORT_VIA_INSPECTOR=1` keeps the old routing for the HTTPS modes as an escape hatch.
- **Optional inspector**: `INSPECTOR_URL=""` (or `off`) declares an installation without the Python service. Inspector-only
  modes then answer `503 { code: "inspector_not_configured" }`. `GET /api/source-import/capabilities` returns
  `{ native, inspectorModes, inspector, inspectorReachable }` (health cached 30 s, `?refresh=1` forces a check); the
  dialog hides the DuckDB / lake files / SQL dialect / SQLAlchemy URL / JDBC entries when `inspector` is `false` and shows
  a notice: register databases as foreign catalogs in Unity Catalog (Lakehouse Federation) and load them with the UC
  import or the scheduled UC sync. With an inspector that is configured but down, a warning appears when such a type is
  selected. CSV import/export, dbt, ODCS, Unity Catalog and MCP are unaffected.
- **Databricks edition**: no fork — the same repository, configured with `INSPECTOR_URL=""`, `DB_DRIVER=postgres`,
  `AUTH_MODE=header` and the other v1.59 switches (`deploy/databricks/app.yaml` follows when the migration is scheduled).
  The Pi installation keeps its inspector; nothing changes there.
- **Tests**: 173 unit/component tests; E2E adds native OData + Schema Registry through the route against fake servers
  and a third server started with `INSPECTOR_URL=""` (`test/e2e/server3-no-inspector.e2e.test.mjs`); 30 E2E tests on
  MariaDB and PostgreSQL.

## Database engines, identity, operations, streaming and Unity Catalog sync

- **Database engine**: `DB_DRIVER=mariadb` (default) or `DB_DRIVER=postgres`. The code keeps one SQL dialect; the
  adapter rewrites placeholders, shapes results and translates the DDL (types, inline indexes, FULLTEXT → `tsvector`
  + GIN, `pg_trgm`). Search, upserts, JSON helpers and SQL backups (`pg_dump`) have per-engine implementations behind
  `sql.*` helpers in `server/db.js`. Lakebase: `DB_PASSWORD_PROVIDER=databricks` fetches the service principal's
  credential per connection (`DATABRICKS_HOST`, `DATABRICKS_CLIENT_ID`, `DATABRICKS_CLIENT_SECRET`,
  `LAKEBASE_INSTANCE`); `DB_SSL=1` for TLS. Moving between engines: dump export → restore on the new engine.
- **Identity**: Admin › Users gains *Enforce SSO* (password sign-in only for break-glass accounts) and the
  *Group → role mapping* panel (rules group → roles, roles follow groups, unmatched → default roles or denied).
  Entra delivers groups through the `groups` claim and app roles. `AUTH_MODE=header` trusts an authenticating proxy
  (`x-forwarded-email`, `x-forwarded-preferred-username`, `x-forwarded-groups`, `x-forwarded-access-token`; names via
  `AUTH_HEADER_*`), protected by `AUTH_HEADER_SECRET`; `AUTH_GROUPS_FROM=databricks` resolves groups through SCIM;
  `AUTH_BOOTSTRAP_ADMINS` become admins; `GET /auth/identity` describes the mode. MCP keys and tokens are unaffected.
- **Operations**: `BACKUP_STORAGE=local|s3|azure|databricks` (`S3_BUCKET`, `S3_REGION`, `S3_PREFIX`, `S3_ENDPOINT`,
  `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; `AZURE_CONTAINER_SAS_URL`, `AZURE_PREFIX`; `DATABRICKS_VOLUME_PATH`).
  `GET /healthz` for monitors (503 when the database is down). `GET /admin/tasks`,
  `POST /admin/tasks/<backup|stewardship-reminders|usage-purge|uc-sync>/run` with an admin session or
  `Authorization: Bearer $TASKS_TOKEN`; `SCHEDULER=external` turns the in-process timers off. SIGTERM shuts down
  gracefully within 15 s. `PORT` falls back to `DATABRICKS_APP_PORT`, `HOST`/`BIND_ALL=1` binds 0.0.0.0.
- **Streaming**: dump export, backups, CSV export and OKF export never assemble the full document any more
  (400k attributes: dump at 221 MB RSS peak); the CSV import merges in chunks of `IMPORT_CHUNK_ROWS` (100,000) rows
  ending at table boundaries, one transaction and audit summary per chunk.
- **Scheduled Unity Catalog sync**: Admin › Backups & jobs › *Scheduled synchronisation* — profiles with workspace,
  catalog, target hub / data hub / layer, authentication (PAT, service principal, app identity), schedule (manual,
  hourly, daily), mode *report* (notify only) or *apply* (import new objects, update column types, optionally delete
  missing objects, lineage). Drift (new/removed schemas, tables, columns, type changes) is recorded on the profile
  and sent to the effective stewards and owners in their language — admins when nobody is responsible. API under
  `/admin/sync/profiles`; task `uc-sync` for external schedulers.
- **nginx**: the proxy location becomes `location ~ ^/(auth|api|admin|databricks|mcp|oauth|\.well-known|healthz)(/|$)`.

## Collaboration and OAuth 2.1 for MCP clients

- **Discussion**: every table has a Discussion tab; data products show the discussion under their table cards. Any
  signed-in user posts comments, asks questions and answers them (one reply level, 4000 characters). A question
  notifies the effective data steward and owner (accounts matched by e-mail) in-app and by e-mail in their language;
  an answer notifies the asker. The asker, stewards and admins resolve (or reopen) a question. Authors and admins
  edit / delete entries.
- **Ratings**: 1–5 stars, one vote per person, click the same star again to withdraw; average and count next to the
  table name and on data products.
- **Usage**: the UI reports views (one per person and object per ten minutes), search terms and exports. Tables show
  views 30 / 90 days, distinct viewers, exports and last viewed on the Governance and Discussion tabs; the dashboard's
  Usage panel lists the most viewed tables, top search terms and best rated tables for 7–365 days. Admins trim old
  events with `POST /admin/usage/purge {"keepDays": 400}`.
- **My Dashboard › Questions**: questions to answer (you are steward or owner; admins additionally see unanswered
  ones) and your own open questions; a click opens the Discussion tab.
- **MCP**: `get_table` includes `rating`, `openQuestions` and `usage`; tools `get_discussion`, `list_open_questions`,
  `add_comment` (write scope).
- **OAuth 2.1**: MCP clients discover `/.well-known/oauth-protected-resource` and
  `/.well-known/oauth-authorization-server`, register at `POST /oauth/register` (RFC 7591), send the user to
  `GET /oauth/authorize` (PKCE S256 mandatory; without a session the browser goes through the sign-in and back), the
  user consents on a server-rendered page, the client exchanges the code at `POST /oauth/token` and refreshes with
  rotating refresh tokens; `POST /oauth/revoke` (RFC 7009). Access tokens live 1 h, refresh tokens 30 d
  (`OAUTH_ACCESS_TTL_S`, `OAUTH_REFRESH_TTL_D`); a token acts as the consenting person — audit entries carry that
  name — and `catalog:write` is granted only to Admins and Data Stewards. `APP_URL` is the issuer and must be the
  public https origin. 401 responses of `/mcp` carry `WWW-Authenticate: Bearer resource_metadata="…"`.
- **Connected apps**: key icon › Connected MCP applications (own connections, Disconnect); Admin › Users lists every
  user's connections and the limits. `GET /oauth/apps[?all=1]`, `DELETE /oauth/apps/:clientId[?userId=]`.
- **Rate limits** per credential (OAuth token, agent key, static token): `MCP_RATE_PER_MIN` (300) requests and
  `MCP_WRITE_RATE_PER_MIN` (60) write calls per sliding minute; over the limit HTTP 429 with a JSON-RPC error,
  `Retry-After`, `X-RateLimit-Limit` / `X-RateLimit-Remaining`.
- **nginx**: the proxy location becomes `location ~ ^/(auth|api|admin|databricks|mcp|oauth|\.well-known)(/|$)`.
- **Client setup (e.g. Claude Desktop / claude.ai connectors)**: URL `https://<host>/mcp`, no token — the client
  registers itself and opens the consent page. Agent keys and `MCP_TOKEN` keep working as before.

## Languages, accessibility and mobile

- **Languages**: EN, DE, PL, ES, FR, IT — switch with the selector next to Sign out or on the sign-in screen; the
  choice is stored with the account and decides the language of notifications (in-app and e-mail). Adding a language:
  `LANGS`/`LOCALE` in `src/i18n.jsx`, a dictionary `src/i18n-<lang>.js` (keys are the English strings), a help file
  `src/help-<lang>.js`, `UI_LANGS` in `server/config.js`, templates in `server/i18n.js`.
- **Notifications**: `notifyI18n(emails, from, key, params)` renders one message per recipient (`server/i18n.js`);
  message keys: describe_attrs_steward, assign_steward_owner, name_owner_admin, design_submitted, design_refine,
  access_request, access_decided, design_status, stewardship_reminder. Workflow status texts are localised too.
- **Accessibility**: dialogs are `role=dialog` + `aria-modal` with focus trap and Escape; menus support arrow keys;
  cards/rows react to Enter and Space; a skip link jumps to `#main-content`; toasts are announced via a live region;
  `<html lang>` follows the UI language. Screen-reader and keyboard walkthroughs are part of the component tests.
- **Mobile**: below 760 px the tree is a drawer (☰), top-bar buttons show icons only (titles keep the labels), grids
  stack, tables scroll horizontally, dialogs fill the width; coarse pointers get ≥ 40 px targets.

## Backups & jobs

- **Schedule**: Admin › Backups & jobs — daily time (server local time), number of automatic backups to keep, SQL
  dump on/off. "Back up now" writes a manual backup (never deleted by retention).
- **What a backup is**: `cortex-backup-YYYYMMDD-HHMMSS.json.gz` — the catalog dump (restorable via Admin › Restore or
  from the page) — and, when `mysqldump`/`mariadb-dump` is installed, `…sql.gz` with the whole database. Files live in
  `BACKUP_DIR` (default `<DATA_DIR>/backups`); the `backups` table holds the metadata. Copy the directory off the
  machine (rsync/rclone) — the app does not do that itself.
- **Restore drill** ("Verify"): re-reads the file, checks format and referential integrity, compares record counts
  with the live catalog (drift), checks the SQL dump ends with "Dump completed". Stored on the backup and audited.
- **Restore** replays the backup through the normal restore job (audited, counts shown). **Download** gives you the
  JSON or SQL file. Restoring the SQL dump is done outside the app: `zcat file.sql.gz | mysql datahub_catalog`.
- **Jobs**: the page lists imports, restores and backups with status, duration and result. Jobs are mirrored to
  the `jobs` table once a second; after a restart a job that was running shows as "interrupted".

## Stewardship

- **Certification** (table › Governance tab, owner/steward/admin): Endorse marks a table as trusted and reviewed;
  Deprecate… asks for an optional successor and a reason — the table shows a red notice with the successor link,
  cards and the dashboard show the badge. Remove clears it.
- **Reviews**: set a review cycle (90/180/365 days) and mark the table as reviewed; the status (pending, due soon,
  overdue, reviewed) is shown in the header and on My Dashboard › Stewardship tasks.
- **Ownership attestation**: owners confirm ownership on tables, schemas, databases and domains where they are set
  explicitly; the interval (default 180 days) is the policy on the Governance Overview (admins). Only the owner may
  attest — the server enforces it.
- **Reminders**: once a day (hourly check) due reviews go to steward and owner, due attestations to the owner, as
  in-app messages (and e-mail with SMTP), at most every 7 days per object. Admins can "Send reminders now".
- **MCP**: `certify_table`, `review_table`, `list_stewardship_tasks`; `get_table` includes certification, review and
  owner_attested_at.
- **Data**: `certStatus`, `certifiedBy/At`, `certNote`, `successorId`, `reviewCycleDays`, `lastReviewedAt/By/Note`,
  `ownerAttestedAt/By` are ordinary fields of the records — audited, restorable, part of dumps.

## Connectors: prerequisites and mapping

| Source | Prerequisite | Mapping |
|---|---|---|
| SQL Server / Azure SQL | `pip install pymssql` in the inspector venv | schemas → schemas, tables/views, comments via SQLAlchemy |
| Oracle | `pip install oracledb` (thin mode, no client) | service name; schema = owning user |
| Snowflake | `pip install snowflake-sqlalchemy` | account identifier (no host/port), database, optional warehouse/role; COMMENTs |
| Data lake files | none (DuckDB extensions httpfs/azure/delta/iceberg install on first use — internet once) | each path/glob → table of type FILE; credentials: Azure connection string / account + SAS or key, S3 key + secret (+ region, endpoint) |
| OData (S/4HANA, Gateway, any) | service URL, Basic or bearer, optional sap-client | EDM namespace → schema, entity type → table, keys → PK, sap:label / Core.Description → descriptions |
| Kafka Schema Registry | registry URL, optional API key/secret | subject → topic table (type TOPIC); Avro/JSON Schema/Protobuf fields → attributes, `-key` schema → `key.*` PKs |
| Power BI | service principal allowed for read-only admin APIs + "detailed metadata" tenant setting, or a pasted token | workspace → database, dataset → schema, tables + measures → attributes, reports → schema "Reports" (type REPORT) with lineage |
| dbt | `target/manifest.json` (+ `catalog.json`) from `dbt docs generate` | models/seeds/snapshots/sources → tables, columns (+ types from catalog), tests → nullability/keys, depends_on → lineage |
| ODCS data contracts | YAML/JSON files (v3 or v2) | first server → database/schema, schema objects → tables, properties → attributes (classification → sensitivity, businessName → business term) |

Bundle imports (Power BI, dbt, ODCS) offer a hub picker: SOURCE (layer Other) or any data hub type with a medallion
layer (or guessed per database). Lineage keys are `database.schema.table`; keys outside the bundle are resolved
against the existing catalog, so a dbt project can add lineage to tables imported from Unity Catalog.

Install the optional drivers on the Pi:

```
sudo /opt/datahub-catalog/inspector/venv/bin/pip install pymssql oracledb snowflake-sqlalchemy
sudo systemctl restart datahub-catalog-inspector
```

Power BI scans of large tenants can exceed nginx's 120 s API timeout — add the inspect route to the long-transfer
location in `/etc/nginx/sites-available/datahub-catalog`:
`location ~ ^/(api/import/csv|api/export/(csv|okf)|api/source-import/inspect|admin/dump)$ {`.

## CSRF and security headers

- After login the server sets two cookies: `dhc_session` (httpOnly) and `dhc_csrf` (readable; HMAC of the
  session token). POST/PUT/PATCH/DELETE requests that carry the session cookie must repeat `dhc_csrf` in the
  `X-CSRF-Token` header (fetch/XHR) or in a `_csrf` form field (urlencoded form posts such as the export
  downloads). Otherwise the answer is `403 {"code":"csrf"}`. Requests whose `Origin`/`Referer` host differs from
  the request host are rejected as well. Login, bootstrap, GET/HEAD/OPTIONS and `/mcp` (bearer keys) need no token.
- The UI handles this transparently (`src/lib/csrf.js` wraps `window.fetch`; uploads and form downloads add the
  token themselves) and retries once after refreshing the token, so a login in another tab does not break the page.
- The HMAC secret is generated once and stored in the settings table (`security.csrfSecret`); `CSRF_SECRET` in the
  environment overrides it. Rotating the secret invalidates every open tab's token — they recover on the next request.
- Response headers (`server/security.js`; nginx repeats them for the static files): CSP `default-src 'self';
  script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data:
  https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; form-action
  'self'; base-uri 'self'; object-src 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(),
  payment=()`, `Strict-Transport-Security` when the request came over https (`X-Forwarded-Proto`) or
  `COOKIE_SECURE=1`. When you add an external resource (a CDN script, an image host) extend the CSP in both places.
