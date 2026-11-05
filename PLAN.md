# PLAN.md — Alassio Data Catalog (formerly Data Hub Data Catalog)

Enterprise data catalog for technical and business metadata
Current release: **v1.79.7** (November 2026) · Release notes are kept outside the repository (delivered next to the zip)

---

## 1. Purpose & vision

A self-hosted web catalog that gives every role — admins, data stewards, guests —
one place to find, understand, govern and request data across the group:

- **Find**: ranked full-text search, dashboard KPIs, lineage across the medallion
  layers, data products as first-class citizens.
- **Understand**: business definitions, ownership/stewardship (inherited from hubs
  and domains), country assignment, sensitivity per attribute.
- **Govern**: roles, 2FA, field-level audit trail with restore, optimistic locking
  for concurrent editing, metadata-only write-back to Unity Catalog.
- **Connect**: live metadata loaders (Unity Catalog, DuckDB files, SQLAlchemy sources,
  JDBC, Informatica, SAP SuccessFactors) and an MCP interface so AI agents can work with the catalog.

## 2. Architecture

| Component | Tech | Location / port | Purpose |
| --- | --- | --- | --- |
| UI | React 18 + Vite — `src/App.jsx` (composition root) + `src/views` (pages), `src/components` (dialogs, secondary screens), `src/hooks` (session, catalog store, polling), `src/lib` (pure catalog logic) | `/var/www/datahub-catalog` via nginx :80/:443 | Catalog UI, dashboard, assistant, admin views |
| App server | Node 24 LTS (≥ 22.12) / Express 5 — `server.js` (composition root) + `server/*.js` (db with dialect adapters, auth + identity, audit, catalog store, design workflow, mail, storage, backup, uc-sync) + `server/routes/*.js` (one router per API area incl. ops, sync) | `/opt/datahub-catalog`, 127.0.0.1:3000 | Auth (scrypt + TOTP), sessions, catalog storage, audit, Databricks proxy, source-import proxy |
| MCP server | `mcp.js` (protocol) + `mcp/` (lookups, schema, views, tools/*) + `okf.js` + `catalog-diff.js` + `permissions.js` (imported by server.js) | `POST /mcp` (same process) | 30 tools for AI agents + OKF resources (okf://…); bearer auth via `MCP_TOKEN` |
| Source inspector (optional since v1.60) | Python 3 / Flask + SQLAlchemy — `inspector/app.py` | `/opt/datahub-catalog/inspector`, 127.0.0.1:3001 (`INSPECTOR_URL`; empty = none) | Live introspection that needs native drivers or a JVM: DuckDB files (read-only), lake files, SQLAlchemy dialects, generic JDBC (jars in `/opt/datahub-catalog/jdbc-drivers`). The HTTPS connectors (OData/SuccessFactors, Kafka Schema Registry, Power BI, Informatica) run in `server/connectors/*` of the app server |
| Storage | MariaDB ≥10.6 (default) or PostgreSQL ≥14 / Databricks Lakebase via `DB_DRIVER=postgres` (v1.59) | 127.0.0.1:3306, db `datahub_catalog` | users, sessions, invites, relational catalog (cat_* tables, one row per object, FULLTEXT) + catalog_meta (version, optimistic locking), audit, glossary_files, marketplace_requests, messages; catalog_doc kept as pre-1.14 backup |
| Reverse proxy | nginx | :80/:443 | Static UI + proxies `^/(auth|api|admin|databricks|mcp|oauth|\.well-known|healthz)` |

### Code structure (since v1.50)

```
src/
  App.jsx                composition root: state, hooks, actions → CatalogContext
  catalog-context.jsx    useCatalog() — everything the views need (lookups, permissions, navigation, actions)
  toast-context.jsx      useToast() — flash(key, vars), confirm(), prompt() + the toast and the confirm dialog (v1.70)
  hooks/                 use-session, use-catalog-store (load / debounced delta save / lazy attributes), use-unread, use-server-search, use-navigation, use-structure-actions, use-import-export, use-stewardship, use-glossary-actions (v1.69)
  lib/                   pure, unit-tested logic: model.js, lookups.js, search.js, catalog-ops.js (all mutations), csv-export.js, download.js, api.js, design-workflow.js, roles.js, format.js (v1.68), source-types.js, auth-screens.js (v1.70), navigation.js (v1.71)
  views/                 pages: topbar, tree, home, hub-views, db-schema-views, table-view, governance-view, lineage-view, search-view, main (view switch), modals (dialog host), shared (Crumb, GovLine, ProjectTags)
  components/            dialogs and secondary screens (marketplace, glossary, admin, auth, source-import, sync, …)
  i18n.jsx, i18n-dict*.js (per-release dictionaries, v1.62 = translation audit), help-content.js (feature texts ×6), help-chapters.js (chapters + role guides ×6), styles.js
server.js                composition root: middleware order, routers, MCP registration, start-up
server/
  config.js              env + role model      db.js  pool, schema init, JSON-store migration
  crypto.js              scrypt, tokens, TOTP  auth.js sessions, guards, login rate limiting
  audit.js               audit rows + queries  catalog-store.js  assemble / search / write / delta apply
  catalog-tables.js      relational layout     design-workflow.js  DESIGN_ACTIONS, STATUS_TEXT, tag sync
  mail.js                messages + SMTP       settings.js, agent-keys.js, users.js (account repository, v1.70)
  tasks.js               scheduled-task registry + runner (v1.70)   dump.js, sso.js, sync-profiles.js, password-reset.js (v1.70: ex route-resident logic)
  marketplace.js         marketplace use cases (v1.69): create / decide / authorise / apply design actions / delete; route is parse → call → respond
  catalog-import.js      server-side imports (external loads, bundles, dbt/ODCS parsing, one-off UC import job)   catalog-migrate.js  document upgrade + seed at start-up
  jobs.js, upload.js     background job registry (import / restore) and streamed uploads to temp files
  connectors/            native source connectors (v1.60): http.js transport, xml.js EDMX parser, odata.js (+ SuccessFactors), schema-registry.js, powerbi.js, informatica.js, index.js (NATIVE_MODES, inspectNative)
  routes/                auth, sso, admin-users, agent-keys, catalog, source-import, import (CSV jobs), export (streamed CSV/OKF), dump (export + restore job), glossary-files, messages, marketplace
mcp.js, okf.js, catalog-diff.js, csv-import.js, csv-export.js, permissions.js, uc-writeback.js   shared by the UI build and the server
mcp/                   MCP tool groups (tools/*.js), lookups.js, schema.js, views.js (v1.69)
inspector/app.py         Python source inspector: Flask + /inspect dispatch over connectors/MODES (v1.70)
inspector/connectors/    one module per mode (duckdb_db, lakefiles, sqlalchemy_db, jdbc_db, odata, schema_registry, powerbi, informatica) + registry
```

systemd units: `datahub-catalog-proxy` (app server), `datahub-catalog-inspector` (optional). Databricks Apps: `deploy/databricks/app.yaml` (v1.61).
Target host: Ubuntu 22.04/24.04; the reference server is a small **ARM64** board —
note: `ibm_db`/`ibm-db-sa` do not build on aarch64, DB2 therefore connects via the
JDBC path (`db2jcc4.jar` from Maven Central).

## 3. Data model

Hierarchy: **Data Hub → Country (ISO / GLOBAL) → Database → Schema → Table → Attribute**
Glossary terms live beside the hierarchy (`catalog.glossary`), link to entities of any level and carry
their own domain, owner and steward (v1.22.0). "My Dashboard" gives every user a personal view of
pending actions, initiated requests, own terms and responsibilities (v1.22.0).
Lineage flow: **SOURCE (hub) → bronze → silver → gold** — SOURCE-hub tables can feed BRONZE tables in any hub.

- Medallion layer (bronze/silver/gold/other) lives on the **database**; tables inherit it.
- Attributes carry sensitivity and an optional classification C1–C4 (v1.24.0), both written to Unity Catalog as column tags.
- Tables and data products carry multi-value "Project", "Use Case" and "Data Product" tags; a design's
  SOURCE-table selection sets and removes them on the server as the selection changes (v1.33.0).
- **Data product** = schema inside a gold-layer database (e.g. `Sales › SALES_DE › GOLD › partners`).
- The data domain can be set on hubs, databases, schemas and tables and inherits downwards
  with overrides (v1.28.0). Ownership/stewardship inherit hub → domain → database → schema → table and can be
  overridden on every level; data hub types have no owner, each data hub has a BPO (v1.39.0). Permissions are people-based
  (account ↔ person by e-mail) and enforced server-side via `permissions.js` (v1.20.0).
  Accounts may hold several roles; the highest role governs (v1.25.0). Admin →
  Governance Overview changes people assignments only (v1.25.0) and shows one box per
  workflow role with the accounts holding it (v1.30.0).
- Sources: `manual`, `csv`, `unity` (lineage locked, write-back allowed), `external`
  (loaded via inspector, no write-back). External loads land in the dedicated **SOURCE** hub.
- Each imported database keeps a `sourceRef` (connection profile without secrets);
  import dialogs offer known sources, UC write-back is bound to the recorded workspace (v1.19.0).
- Client-side migrations (`migrate()` in `src/lib/model.js`) are persisted as a delta right
  after loading, so delta bases always match the stored rows (v1.40.1).
- Since v1.14 the catalog is stored as rows (cat_* tables, JSON payload per object,
  ordered by `seq`) and assembled into the document the UI/MCP consume. Since v1.15
  the UI saves deltas (PATCH, shared `catalog-diff.js`) and conflicts are detected per
  object (row comparison); the whole-catalog version in `catalog_meta` only sequences
  saves. Toolbar: Import, Export, Glossary, Marketplace, Admin (Governance and Audit
  inside Admin). SOURCE-hub databases are always layer "other"; table names are unique
  per schema; glossary terms typed on tables/attributes are auto-created and linked.

## 4. Feature status

### Done (shipped & tested)
- Catalog CRUD for all levels incl. free hub management (v1.0–v1.2)
- Auth: bootstrap flow, scrypt passwords, httpOnly sessions, TOTP 2FA with QR code,
  optional 2FA at signup, roles admin/steward/guest, e-mail invitations (v1.0, v1.3)
- Audit trail with field-level diffs, per-object history, one-click restore (v1.0)
- Search with facets, built-in role-aware help (rewritten for menus, MCP and OKF in
  v1.11.1), selective CSV export (v1.1); CSV import
  with header normalisation and missing-column notice (v1.9.2)
- OKF export: Open Knowledge Format v0.2 bundle (Markdown + YAML frontmatter, linked
  graph, index/log) from the same selection dialog; toolbar reorganised into Import /
  Export / Admin menus; product renamed Cortex Data Catalog (v1.10.0)
- MariaDB storage with auto-migration from the JSON store, optimistic locking (v1.3)
- Country layer, governance dashboard with KPI coverage bars (v1.3–v1.3.2)
- Medallion layer on database level; data-product definition (v1.3.1)
- Unity Catalog: import with pagination + column-detail fallback + governance-tag
  import, lineage import (locked for editing), differential metadata-only write-back
  (comments = description; Sensitivity/Owner/Steward/Domain as UC tags); write-back
  database picker labelled hub.country.database (v1.0–v1.9.1)
- Exports (CSV, OKF) rendered and streamed by the server; dump export streamed, dump restore as a
  streamed upload + background job with progress; write-back fetches attributes per table (v1.52)
- CSV import as a server-side background job with progress dialog; hash-map merge (csv-import.js), multi-row
  INSERTs, one audit summary for bulk imports; large-catalog read paths (lazy document without attribute
  payloads, no ORDER BY filesort, delta saves without full diff, server-side cascade deletes) (v1.51)
- Generic source loader → SOURCE hub: SQLAlchemy presets (MySQL/MariaDB, PostgreSQL,
  DB2, SAP HANA, free URL), generic JDBC, Informatica Catalog Search API (v1.4–v1.5.1),
  SAP SuccessFactors OData (v1.36), DuckDB database files on the server — first entry,
  native driver, read-only, comments + PKs (v1.49)
- Admin account editing (name/e-mail, audited) (v1.3.1)
- Navigation tree collapsed by default, auto-expands to selection (v1.3.3)
- MCP server for AI agents — all catalog actions, no user management (v1.7.0; 35 tools
  as of v1.12.0 incl. export_okf and glossary tools; OKF bundle exposed as MCP resources okf://…)
- Glossary: terms with definition, entity links, external URLs, file attachments in
  MariaDB (attachable at creation), JSON export, MCP tools and OKF concepts; Audit moved
  to Admin menu; toolbar order Import/Export/Glossary/Lineage/Governance/Marketplace/Admin;
  Admin menu admins-only (v1.12.2); Unity Catalog import and write-back admins-only,
  enforced by the Databricks proxy (v1.12.3)
- Marketplace: access requests with purpose, data product designs assigned to a hub with
  a proposed "Data Product" table tag applied to selected SOURCE tables, request list
  with admin approval; key/value table tags in UI, OKF and MCP (v1.13.0)
- Attribute mapping on lineage links (optional column-level lineage), via table
  Lineage tab or clicking arrows in the full-lineage view (v1.9.0)
- Deliverables per version: `datahub-catalog-deploy.zip`, updated `Releases_Notes.txt`,
  README sections; deployment guide PDF (issued at v1.3.3)

### Preview / mock-up (UI exists, backend not yet connected)
- **Cortex guided workflow**: no UI entry point since v1.10.0 (the placeholder button
  was removed); the product itself now carries the Cortex name
- Data product designs run through a server-validated workflow (Project Manager →
  Data Ingestion → Data Product Development → done) with in-app/e-mail notifications
  (v1.21.0); access requests are decided by Admins; the actual entitlement
  provisioning (Entra groups / API keys) is not connected yet

### Backlog — road to an enterprise data catalog (prioritised, September 2026)

**Tier 1 — prerequisites for group-wide operation**
1. **Scalable data model** — *done in three phases*: relational persistence with
   FULLTEXT search text (v1.14.0); delta saves via PATCH with a shared change engine,
   per-object locking, server-side search in the UI (v1.15.0); version-keyed server
   caches for catalog and OKF bundle, FULLTEXT-backed MCP search, render-level
   pagination in tree/cards/attributes, document PUT retired to admin restore
   (v1.16.0); lazy loading of attributes above LAZY_ATTRIBUTES (v1.36.0); lite document
   assembled without attribute payloads, attributes per table, delta saves without a full
   diff, server-side cascade deletes, streamed exports and imports (v1.51–v1.52); phase 4
   (v1.56): no write path builds the full document any more — delta saves, CSV import and
   MCP work on the lite document and load attributes per table (MCP: 149 MB instead of
   1.6 GB RSS at 400,000 attributes), the dump restore diffs collection by collection.
   *Done in v1.59.0:* the last full assembly is gone — dump export, backups, CSV and OKF
   exports stream attributes table by table (400k attributes: dump at 221 MB RSS peak from a
   fresh process), the CSV import merges in chunks (IMPORT_CHUNK_ROWS). *Open:* the MCP OKF
   resource cache still holds the whole bundle in memory (by design: resources are served
   from memory); the in-memory lite document per process.
2. **SSO via Entra ID** — *done in v1.36.0* (OIDC with PKCE, admin-configurable,
   optional auto-provisioning). *Done in v1.59.0:* identity layer (server/identity.js) —
   group → role mapping from Entra groups/app roles or proxy headers, roles follow groups,
   deny unmatched, SSO enforcement with break-glass accounts, AUTH_MODE=header for
   authenticating proxies (Databricks Apps, oauth2-proxy) with shared secret, bootstrap
   admins and Databricks SCIM group lookup. *Open:* SCIM provisioning endpoint (push from
   Entra), per-group visibility (item 3).
3. **Fine-grained permissions** — *done in v1.20.0* for editing rights (people-based
   owners/stewards with inheritance, server-enforced). *Open:* visibility rules
   (e.g. Confidential attributes only for entitled groups).
4. **Operations hardening**: monitoring/alerting, HA/failover plan, central logging,
   secrets from a vault instead of the unit file, penetration test. *Done:* login rate limiting with slowdown (v1.36.0); dump
   export/restore that copes with large catalogs (v1.52.0); CSRF protection (session-
   bound double-submit token, origin check) and security headers — CSP, nosniff,
   frame denial, referrer and permissions policy, HSTS behind TLS — in the Node service
   and the nginx template (v1.54.0); job registry mirrored to MariaDB (history survives
   restarts, interrupted jobs are marked), scheduled backups with retention, full SQL dump
   via mysqldump, restore drills (integrity + drift check) and restore from the server
   (v1.56.0). *Done in v1.59.0:* backup storage providers (local | S3/MinIO | Azure Blob |
   Unity Catalog Volume — covers the off-site copy), GET /healthz readiness endpoint,
   scheduled tasks runnable via POST /admin/tasks/<name>/run (admin or TASKS_TOKEN) with
   SCHEDULER=external for platform schedulers, graceful SIGTERM shutdown (jobs marked
   interrupted, pool closed), configurable bind address/port (DATABRICKS_APP_PORT).
   *Open:* alerting on /healthz (external monitor), HA/failover, central logging,
   vault-based secrets (today: unit-file env + settings table), penetration test; the
   FULLTEXT commit of a bulk import (≈ 40 % of the import time) could be deferred to a
   background rebuild.
5. **Code quality** — *largely done in v1.17.0*: App.jsx split into src/lib, src/styles
   and src/components modules; ESLint; Vitest unit + component tests; node:test E2E
   suite (server + MCP against MariaDB); GitHub Actions CI; *completed in v1.50.0*:
   App.jsx and server.js turned into composition roots over src/views, src/hooks, src/lib
   and server/*, server/routes/*; pure, unit-tested catalog logic; source on GitHub with
   CI on every push (v1.52.0); Node 24 / vite 8 / express 5 / react 19 toolchain (v1.53.0).
   *Open:* marketplace.jsx (600 lines) is the last large component and is split with the
   next workflow feature.

**Tier 2 — automation and workflows**
6. Scheduled synchronisation with change detection — *done in v1.59.0 for Unity Catalog*:
   sync profiles (workspace, catalog, hub, schedule, PAT / service principal / app
   identity), drift detection (new / removed schemas, tables, columns, type changes), modes
   report / apply (optional deletion of missing objects, lineage), localized steward / owner
   notifications, last-run record, task uc-sync for external schedulers. *v1.64:* server-side
   write-back of catalog metadata to UC per profile (after each run or on demand, task
   uc-writeback) — the browser dialog and the server share `uc-writeback.js`. *Open:* the same
   for inspector sources (SQL Server, Oracle, …) and bundles (dbt, Power BI), UC tag
   synchronisation into the catalog (today only via the interactive import), per-schema
   include/exclude filters, drift history beyond the last run.
7. Workflow engine — *largely done in v1.21.0*: three-phase, role-based approval chain (1 Data Sourcing: Business Analyst
   documents the sourcing → data owner approves the data use with a confirming document
   (v1.31.0; approval forwards automatically, decline returns to the analyst, v1.41.0) → Data
   Ingestion confirms ingested tables with a location note; 2 Data Product Refinement: Business
   Analyst refines the data product (v1.34.0);
   Development & Test / Sign-off, reordered in v1.29.0; Advanced design fields and
   mandatory sourcing details at the Data Ingestion Okay, v1.24.0) for data
   product designs, in-app inbox with optional e-mail copies, steward tasks. *Open:*
   Teams notifications, provisioning hooks (Entra groups, API keys), SLAs.
8. Automatic classification: PII detection / sensitivity proposals via rules and
   profiling; GDPR views (record of processing, retention).
9. Data quality: profiling, rules and scores per table; dbt / Great Expectations
   integration.
10. Automatic lineage from SQL parsing, job metadata, OpenLineage. *Partly done:* dbt
    depends_on and Power BI dataset → report lineage arrive with the v1.55 bundle imports.
11. Stewardship processes — *done in v1.56.0*: certification (endorsed / deprecated with
    successor and reason), review cycles with due/overdue tracking, ownership attestation
    with a configurable interval, dashboard tasks, daily reminders, governance KPIs and
    policy, MCP tools. *Open:* certification of schemas / data products as a whole,
    approval workflow for endorsements (four-eyes), attestation of BPOs on data hubs,
    stewardship columns in the CSV export/import.

**Tier 3 — reach and comfort**
12. More asset types (reports, dashboards, APIs, ML models) and connectors. *Done in
    v1.55.0:* SQL Server, Oracle, Snowflake, data lake files (DuckDB over S3/Azure/local),
    generic OData (S/4HANA), Kafka Schema Registry, Power BI (reports as REPORT objects
    with lineage), dbt (manifest/catalog with lineage), ODCS data contracts; table types
    FILE / TOPIC / REPORT. *Open:* BigQuery / Trino templates (work today via SQLAlchemy
    URL), Microsoft Purview, OpenLineage receiver, dataflows / Power BI dataset-to-source
    lineage (M expressions are stored as text only), first-class asset types with their
    own attributes (report pages, API endpoints, ML models) instead of table subtypes.
13. Collaboration — *done in v1.58.0*: Discussion tab on tables (and data products) with
    comments, questions (notify effective steward + owner in their language) and answers
    (notify the asker), resolution by asker / stewards / admins, star ratings (1–5, average
    in the header), usage events (views / searches / exports) with per-object usage lines,
    a dashboard Usage panel (most viewed, top search terms, best rated), My Dashboard ›
    Questions, MCP tools get_discussion / list_open_questions / add_comment and rating +
    open questions + usage in get_table. *Open:* @mentions and subscriptions, comments on
    attributes and glossary terms, usage from MCP reads, CSV/OKF export of ratings.
14. Public REST API with OpenAPI spec, webhooks, catalog snapshots / time travel.
15. i18n — *done in v1.57.0*: six UI languages (EN/DE/PL/ES/FR/IT) incl. help, server
    notifications per recipient language, accessible dialogs/menus/rows, skip link, live
    region, mobile layout with drawer navigation; data contracts (ODCS) since v1.55.
    *Open:* audit-trail entries and MCP tool texts are English by design; automated
    accessibility audit (axe) in CI; right-to-left languages untested; further languages
    are a dictionary + help file each (src/i18n-<lang>.js, src/help-<lang>.js).
16. MCP hardening — per-agent keys with read/write scopes, named agents (v1.35–1.36);
    *done in v1.58.0:* OAuth 2.1 authorization server for MCP clients (RFC 9728 / 8414
    discovery, RFC 7591 dynamic registration, authorization code + PKCE S256, consent page,
    rotating refresh tokens, RFC 7009 revocation, tokens act as the consenting human with
    scope bound to the role, `WWW-Authenticate` on 401, connected-apps self-service and admin
    overview) and per-credential rate limits (sliding minute, requests + write calls, HTTP
    429 with Retry-After). *Open:* token introspection endpoint, resource indicators (RFC
    8707) beyond acceptance, client secret rotation, per-client limits.

17. Dialect-neutral database layer — *done in v1.59.0*: DB_DRIVER=mariadb|postgres behind
    one q()/connection API (placeholder rewriting, result shape, type parsers), DDL written
    once and translated (types, inline indexes, FULLTEXT → tsvector + GIN, pg_trgm), dialect
    helpers (upsert, insertIgnore, like, casts, JSON, search), pg_dump backups, Lakebase
    credential provider (DB_PASSWORD_PROVIDER=databricks), E2E suite on both engines in CI.
    *Open:* migration tooling between engines (today: dump export → restore on the new
    engine), per-engine performance tuning of the tsvector search. Original description —
    before v1.59 the server spoke MariaDB only: mysql2 pool, `?` placeholders, FULLTEXT `MATCH … AGAINST` for the
    table/attribute/glossary search, `ON DUPLICATE KEY UPDATE`, `INSERT IGNORE`, `<=>`,
    `AUTO_INCREMENT`, `LONGBLOB`/`MEDIUMTEXT`, `mysqldump` for SQL backups (~174 query sites,
    all through `server/db.js q()`). Target: `DB_DRIVER=mariadb|postgres` with one adapter per
    driver behind the same `q()`/transaction API (placeholder rewriting, result shape, upsert
    helper, `IS NOT DISTINCT FROM`), DDL in `initDb` per dialect (identity columns, `bytea`,
    `text`), search on Postgres via `tsvector` + GIN and `pg_trgm` for prefix/substring hits,
    SQL backup via `pg_dump`, E2E suite run against both engines in CI. Lakebase adds only a
    pool hook that fetches a fresh OAuth token per new connection (service principal as DB
    user). Estimated 1.5–2 days; no functional change for the MariaDB installation.
    Assessed 2026-09-30 (Databricks Apps, no code change): deployable in principle — Node 22 /
    Express supported, single process on `0.0.0.0:$DATABRICKS_APP_PORT`, 2 vCPU / 6 GB default,
    no persistent disk (UC Volume for backups), 10 MB per file deploy limit (bundle 1.1 MB),
    custom MCP servers explicitly supported at `/mcp` (app name prefix `mcp-`). Blockers beyond
    the database: one process only (inspector would be a second app or dropped in favour of
    Unity Catalog / Lakehouse Federation), Databricks SSO in front of the app (own login, TOTP,
    Entra SSO, invitations and the v1.58 OAuth server give way to header auth via
    `x-forwarded-access-token` / `x-forwarded-email`, MCP clients authenticate against
    Databricks), no anonymous or non-account access, SMTP egress not guaranteed. Item 17 is the
    part that also pays off outside Databricks (any Postgres); the Databricks edition would then
    be a packaging + auth step (`app.yaml`, header auth, Lakebase token rotation).

**Migration preparation block (Databricks Apps) — agreed 2026-10-01, done in v1.59.0**
Order of work if Cortex is to run as a Databricks App one day; every step is also a gain for the
current installation and none of them commits to Databricks:
1. Item 17 — dialect-neutral database layer (Postgres / Lakebase as second engine).
2. Item 2 — identity as a pluggable layer: Entra group → role mapping (admin / steward / pm / ba /
   ingestion / dpd), identity-provider abstraction in `server/auth.js` so that header auth
   (`x-forwarded-email`, `x-forwarded-access-token`) becomes a small adapter; SSO enforcement
   with local passwords as break-glass.
3. From item 4 — storage abstraction for backups and upload temp files (local directory | S3 /
   Azure Blob | UC Volume; covers the off-site backup copy), graceful SIGTERM handling within 15 s
   (running jobs marked interrupted), health endpoint for monitoring, scheduled tasks (backup,
   stewardship reminders) triggerable via API so an external scheduler can run them.
4. From item 1 — streaming per table for the dump export and the whole-catalog OKF bundle, CSV
   import without holding all rows in memory (6 GB is the default app size).
5. Item 6 — scheduled Unity Catalog synchronisation with drift detection (service principal, no
   PAT) and steward notifications.
All five steps shipped in v1.59.0. **Inspector decision (2026-10-05, Azure Databricks): Option A+B,
done in v1.60.0** — (B) the pure-HTTPS connectors (OData/SuccessFactors, Kafka Schema Registry,
Power BI Scanner API, Informatica Catalog API) were ported to Node (`server/connectors/`), so no
second process is needed for them; (A) the Databricks edition runs with `INSPECTOR_URL=""`, the
inspector-only source types (DuckDB, lake files, SQL dialects, JDBC) disappear from the UI and
databases come in through Unity Catalog — register SQL Server / Oracle / Snowflake / Postgres etc.
as foreign catalogs via Lakehouse Federation and load them with the UC import or the scheduled UC
sync. CSV import/export, dbt, ODCS, MCP and everything else are unaffected. The reference server keeps its
inspector. One repository, no fork: the edition is a configuration — **`deploy/databricks/app.yaml` +
README written in v1.61.0** (DB_DRIVER=postgres, DB_PASSWORD_PROVIDER=databricks, AUTH_MODE=header,
AUTH_GROUPS_FROM=databricks, BACKUP_STORAGE=databricks, SCHEDULER=external + a Databricks Job calling
/admin/tasks with X-Tasks-Token, INSPECTOR_URL=""), together with MCP as the forwarded identity and the
PG* resource binding; v1.61.1 adds the Lakebase Autoscaling credential flow (`LAKEBASE_ENDPOINT`,
`/api/2.0/postgres/credentials`), the job script `run_tasks.py` and the 16-page deployment guide PDF in
`deploy/databricks/`. *Open — only verifiable against a real workspace:* Lakebase credential endpoint and
token rotation, the user-authorization scope for AUTH_GROUPS_FROM=databricks, SMTP / API egress; then the
first deploy is configuration only. Not worth doing before a migration: further inspector connectors (Purview
scan, Trino/BigQuery templates), nginx-specific work, mysqldump extensions, further build-out of
the own OAuth server (item 16 rest). Platform-neutral and scheduled on demand: 14 (REST API /
webhooks), 13 rest, 8–10, stewardship rest of 11.

Older open items folded in: Cortex guided workflow, DRD analysis, multi-jar JDBC
(DB2 z/OS), deployment-guide refresh (the PDF dates from v1.3.3 — the release blocks in the
chat and Releases_Notes.txt are the current source), bulk UI operations, backup automation.

## 5. Operating notes

- Runtime and build host: Node.js ≥ 22.12 (`engines`), production on Node 24 LTS; toolchain vite 8 /
  vitest 5 / eslint 10, runtime express 5 / react 19 (v1.53). CI runs the whole suite on Node 22, 24 and 26.

- **Backups**: `mysqldump datahub_catalog > backup.sql` (before any direct SQL edits!).
  Direct SQL changes bypass the audit trail and bump the catalog version (open
  browsers reload on next save).
- **MCP**: endpoint disabled unless `MCP_TOKEN` is set; rotate by changing the env
  var + restart. Agent changes are audited as "MCP Agent".
- **MCP OAuth + rate limits (v1.58)**: `APP_URL` must be the public https origin — it is the OAuth
  issuer and appears in the discovery documents; nginx proxies `/oauth` and `/.well-known`.
  Token lifetimes: `OAUTH_ACCESS_TTL_S` (3600), `OAUTH_REFRESH_TTL_D` (30). Limits per credential:
  `MCP_RATE_PER_MIN` (300) and `MCP_WRITE_RATE_PER_MIN` (60). Tables oauth_clients / oauth_codes /
  oauth_tokens; revoke everything of a client: `UPDATE oauth_tokens SET revoked_ts=UNIX_TIMESTAMP()*1000
  WHERE client_id=…`.
- **Database engine (v1.59)**: `DB_DRIVER=postgres` switches to PostgreSQL / Lakebase (`DB_PORT` 5432, `DB_SSL=1`
  for TLS, `DB_PASSWORD_PROVIDER=databricks` + `LAKEBASE_INSTANCE` for Lakebase credentials). Moving an installation
  between engines: Admin › Dump on the old one, point the service at the new database, Admin › Restore the dump
  (users, catalog, audit are in the dump; sessions and messages are not). Local Postgres for tests: `createdb` +
  `CREATE EXTENSION pg_trgm` (optional).
- **Backup storage (v1.59)**: `BACKUP_STORAGE=local|s3|azure|databricks` with `S3_*`, `AZURE_CONTAINER_SAS_URL`,
  `DATABRICKS_VOLUME_PATH`; remote providers spool through the OS temp directory, so leave a few hundred MB there.
- **Health / tasks / scheduler (v1.59)**: `GET /healthz` (503 when the database is down), `POST /admin/tasks/<name>/run`
  with `Authorization: Bearer $TASKS_TOKEN` from cron or a platform job; `SCHEDULER=external` turns the in-process
  timers off. SIGTERM → graceful stop within 15 s (systemd `TimeoutStopSec` ≥ 20 recommended).
- **Identity (v1.59)**: `AUTH_MODE=header` only behind a proxy that authenticates every request and strips client-set
  `x-forwarded-*` headers; set `AUTH_HEADER_SECRET` and pass it from the proxy. Entra group mapping needs the
  `groups` claim in the app registration (Token configuration → groups claim; object ids unless "sAMAccountName"
  is emitted). SSO enforcement: keep at least one break-glass admin with 2FA.
- **Unity Catalog sync (v1.59)**: credentials live in the settings table (like Entra's client secret); prefer a service
  principal with read-only grants (USE CATALOG, USE SCHEMA, SELECT metadata) over a personal token. Report mode
  first, apply mode once the drift looks right; deleteMissing removes tables and columns (audited, restorable
  via history).
- **Usage events (v1.58)**: table usage_events grows with views/searches/exports; Admin › POST
  /admin/usage/purge {keepDays} trims it (default 400 days).
- **2FA recovery**: `UPDATE users SET totp_enabled=0, totp_secret=NULL WHERE email=…;`
- **Search engines**: excluded by design (X-Robots-Tag header, robots.txt, meta tag).
- **Languages (v1.57)**: a new UI language = `LANGS` + `LOCALE` in src/i18n.jsx, a dictionary file
  (`src/i18n-<lang>.js`, keys = English strings — `node` script in the release notes lists missing
  keys), a help file (`src/help-<lang>.js`), `UI_LANGS` in server/config.js and the templates in
  server/i18n.js (message keys + workflow status texts).
- **Backups (v1.56)**: `BACKUP_DIR` (default `<DATA_DIR>/backups`), schedule and retention in
  Admin › Backups & jobs; SQL dumps need `mysqldump`/`mariadb-dump` on the PATH and use the DB_*
  credentials of the service. A restore drill verifies the file, it does not restore; a real
  restore replaces the catalog (audited). Copy the directory off the reference server regularly.
- **Stewardship (v1.56)**: policy in the settings table (`stewardship.policy`), reminders run
  hourly and once per day; `POST /admin/stewardship/remind` sends them on demand.
- **Databricks edition (v1.61)**: `deploy/databricks/app.yaml` + README are the packaging. In header mode
  `/mcp` without a recognised bearer acts as the forwarded identity (write for admin/steward, read
  otherwise; `forwardedMcpIdentity`); `TASKS_TOKEN` also via `X-Tasks-Token`; `DB_*` fall back to the
  `PG*` variables of an attached Lakebase resource. The reference server is unaffected (AUTH_MODE=local).
- **Translations (v1.62)**: every literal passed to `t()` / `tr()` / `flash()` must exist in all five
  dictionaries — `test/unit/i18n-coverage.test.js` fails CI otherwise. New UI strings go into
  `src/i18n-dict-ext.js` (since v1.79.2 one file instead of one per release), merged in `i18n.jsx`; new help texts into `help-content.js`
  (same section order in all six languages — `help-chapters.js` composes the chapters by index).
- **Write-back ownership (v1.77, owner, 2026-10-27)**: "Beim Write-Back to Unity Catalog soll zuerst eine Vorschau der
  Änderungen angezeigt werden. Die Änderungen gehören der Session des jeweiligen Benutzers. Änderungen anderer Benutzer
  müssen durch die jeweiligen Benutzer zurück in den Unity Catalog geschrieben werden." Implemented as: every operation
  of `buildWriteBackOps` names its sources (`op.src`, records + fields, inherited owners point at the holder);
  `server/writeback-authors.js` attributes each operation to the newest audit entry touching one of those fields
  (`created` counts for all fields); `runWriteBack(…, { scope: "mine" })` writes only `mayWrite` operations (own, or
  unattributed for admins — decided by owner, 2026-10-27) and returns `pending { mine, unattributed, others[], writable }`;
  routes `/api/writeback/*` for every signed-in user, `WriteBackModalC` (preview → confirm → result). Decided to keep:
  the profile's automatic write-back after each sync run and the `uc-writeback` task run with `scope: "all"` as admin
  settings. Limits: changes without a field-level audit entry (bulk imports summarised into one entry, pre-audit data)
  have no author; the UC sync import is authored by the user who ran it.
- **Product name, neutrality and brand colour**: **Alassio Data Catalog** since v1.76.0 (history: Cortex v1.10 → Alassio
  v1.67.1 → Cortex v1.67.2 → Alassio v1.76.0). Since v1.78.0 (owner, 2026-10-28) the product is company-neutral:
  wordmark "COMPANY", default data hub types Finance / HR / Sales (ids finance / hr / sales; icons for the legacy ids
  central / health / pc stay), neutral examples everywhere, brand colour sky blue RAL 5015 `#2271B3` since v1.79.0 (dark `#1A5A8F`, soft `#E4EEF7`; v1.78 indigo)
  with teal accent `#0F766E` (`--accent`, SOURCE layer colour). Tokens in `src/styles.js`, `BRAND` in
  `help-figures.jsx`, the OAuth consent page in `server/oauth.js`, the workflow-PDF generators in `docs/workflows/`
  (`make_wf_pdf.py` overview, `make_bpmn_pdfs.py` BPMN PDFs + files under `public/docs/Alassio_*`; regenerated in v1.79
  on request — only on explicit request). `test/unit/neutral-product.test.js` forbids employer/group names,
  internal system names and the former colours. Technical identifiers are never renamed with the product
  (`/opt/datahub-catalog`, units, zip, `cortex.lang`, `cortex-backup-*`, `cortex-glossary`).
  Do not rename or recolour without an explicit instruction.
- **README**: since v1.79.2 (new repository, owner, 2026-10-31) the README carries no version history — "What's new"
  starts at v1.79.5 "Initial Release" (repository reset again 2026-11-03); since v1.79.6 (owner, 2026-11-04) the
  README is a product README (data governance catalog + integrated marketplace, Databricks App and standalone, Get
  started, features, prerequisites, architecture) — keep it current with every feature change; each new release adds one entry above it; the reference sections follow.
- **npm overrides** (v1.79.5): `minimatch ^11.0.4` (GHSA-g3hv-75wg-m249 via eslint and archiver › readdir-glob);
  drop it when upstream depends on minimatch >= 11.0.1. Never `npm audit fix --force` (it proposes eslint 4).
- **docs/** (v1.79.6): English PDFs `Alassio_Deployment_Guide_Ubuntu.pdf`, `Alassio_Deployment_Guide_Databricks_App.pdf`,
  `Alassio_Architecture_and_Features.pdf`, generated by `docs/guides/*_en.py <version> <pdf>` (reportlab, Liberation
  Sans + DejaVu Sans Mono); `docs/REFERENCE.md` holds the former README reference sections. Regenerate the PDFs when
  deployment steps, configuration or features they describe change.
- **Public repository readiness** (v1.79.7, owner 2026-11-05): no employer names in any spelling (also host names such
  as `*.leanix.net`, Confluence URLs, repository paths), no personal names in texts, placeholders or PDF metadata
  (generators set no author); `test/unit/neutral-product.test.js` scans src, server, mcp, test, inspector, deploy,
  docs, public/docs, README.md, PLAN.md, package.json and the PDF metadata.
- **Release check**: `npm run lint` (0 errors) before every release — CI fails on lint errors (v1.79.1 fixed
  `no-useless-assignment` / `no-regex-spaces` that slipped through v1.77–1.79).
- **Clean Code roadmap (review of 2026-10-22, `Cortex_Code_Quality_Review.md`)** — wave 1 shipped in v1.68.0:
  explicit `mutating` flag on MCP tools (the gate no longer depends on tool names), `changesBetween`/`canon` in
  `catalog-diff.js` (domain never imports `mcp.js`), `ah()` honours `e.status`/`e.code` (no per-route wrappers),
  `src/lib/api.js` as the one JSON client, `src/lib/design-workflow.js` + `src/lib/roles.js` as the one workflow / role
  vocabulary of the UI, helpers `isSourceHub`/`isAgentAccount`/`isLastAdmin`/`fmtBytes…`, `startLoginGc`, tasks
  registered by `server.js`, lint guard `no-restricted-imports` (server → mcp.js / routes, components → workflow
  constants from other components). Wave 2 shipped in v1.69.0: marketplace use cases in `server/marketplace.js`
  (`authorizeDesignAction` / `designActionPayload` pure, `applyDesignAction`, `createRequest`, `decideAccessRequest`,
  `deleteRequest`; the route is parse → call → respond; unit-tested with mocked db/mail/audit), MCP adapter split into
  `mcp.js` (protocol) + `mcp/lookups.js` + `mcp/schema.js` + `mcp/views.js` + `mcp/tools/{read,structure,stewardship,
  collab,attributes,lineage,glossary,okf}.js` (each `(ctx) => [tools]`, identity via `ctx.currentUser()`), App.jsx
  split into `src/hooks/use-navigation.js`, `use-structure-actions.js`, `use-import-export.js`, `use-stewardship.js`,
  `use-glossary-actions.js` with a memoised context and `React.memo(Shell)`. **Rule when adding an MCP tool**: put it
  in the matching `mcp/tools/*.js` group, set `mutating: true` if it calls `mutate()`, and compare tools/list before
  and after. Wave 3 shipped in v1.70.0 (review complete): `server/dump.js`, `server/sso.js`, `server/sync-profiles.js`,
  `server/password-reset.js`, `server/tasks.js` (task table assembled in `server.js` from `*_TASK` objects; lint: routes
  never import routes), `server/users.js` repository (`findUser`/`requireUser`/`findByEmail`/`emailTaken`/`createUser`/
  `emailSet`/`countUsers`), `STATUS_TEXT = STATUS_TEXT_L10N.en` + `count()` in `server/i18n.js`, inspector
  `connectors/` package with `MODES`, `src/lib/source-types.js` registry behind `SourceModalC`, `TwoFactorSetup` +
  `screenFor()` in the sign-in gate, `src/toast-context.jsx` (`useToast()` → `flash(key, vars)`, `confirm()`,
  `prompt()`; no `flash` prop, no `window.confirm`). **Rules from here**: new toasts are dictionary keys with
  `{placeholders}` (never template literals — `i18n-coverage.test.js` enforces it for flash/confirm/prompt); a new
  account query goes into `server/users.js`; a new scheduled task is a `*_TASK` object registered in `server.js`; a
  new inspector mode is a module in `inspector/connectors/` registered in `MODES`; a new source type is one entry in
  `source-types.js`.
- **Second Clean Code review (2026-10-22, `Cortex_Code_Quality_Review_v1.70.md`)** — 53 findings, roadmap waves 4–6.
  **Wave 4 shipped in v1.71.0**: F-F2 `src/lib/navigation.js` (VIEWS, TABLE_TABS, treeKey; `openRef` is the only jump,
  tabs validated), F-F3 Modal focus (`autoFocus`/`data-autofocus`, never the close X; `describedBy`), F-S1 no
  `assembleCatalog()` outside `routes/catalog.js` (lite document + `saveTagDelta`), F-M1 MCP delete/certify/review via
  `catalog-ops.js`, F-M2 `enumT`/`int`/`num({min})` in `mcp/schema.js`, F-M3 `assertUniqueName` on create and rename,
  F-T2/F-T3 behavioural gate test + `mcp-tools`/`mcp-handle` tests, F-F1 `useStableCallbacks` + react-hooks lint,
  F-I2/F-I5 inspector validate contract + bound SQL. **F-I1 decided 2026-10-23: Python copies removed in v1.73.0.**
  **Wave 6 shipped in v1.73.0** (`applyChanges` throws, `source-inspect.js`, `csv-import-job.js`, `user-admin.js`,
  `pendingActionsFor`, `unity-client.js`, `tasks.js` scheduler, MCP `METHODS`/`resolveCredential`, context split into
  data / nav / actions, Marketplace components + `useDesignForm`, one collab request, `tn()` + extended i18n guard, E2E
  feature files). **The second review is complete.** **Rules from here**: navigation literals only via
  `lib/navigation.js`; new MCP enums/limits via the schema builders; never `assembleCatalog()` in a request path
  other than `/api/catalog`; every function put into the context goes through `useStableCallbacks`; network calls only
  via `src/lib/api.js`; role labels only from `ROLES`; component tests use `test/helpers/fetch.js`, unit tests
  `mockDb()`; a re-export "kept for one release" names the release that deletes it; components read
  `useCatalogData()` / `useNav()` / `useActions()` (not `useCatalog()`); counts use `tn([one, other], n)`; each E2E file
  boots its own server via `test/e2e/helpers.mjs` and owns its port; scheduled work is a task with `due()` in `tasks.js`.
- **Third Clean Code review (2026-10-23, `Cortex_Code_Quality_Review_v1.73.md`)** — 33 of 53 old findings resolved,
  18 partly, 2 not; 44 new. **Wave 7 shipped in v1.74.0** (defects and safety nets): F-S1 ESLint guards repaired (one
  `no-restricted-imports` block per file group — a later block had replaced the domain/route guards since v1.72) +
  `test/unit/lint-guards.test.js`; F-M1 MCP `null` arguments = absent (`withoutNulls`), F-M3 max bounds instead of
  silent clamps, `sensitivity` enum, F-M2 `guessLayer`/`uid`/`LAYERS`/`normCountry`/`findOrCreatePerson` from `src/lib`;
  F-F1 Modal remembers its opener before `autoFocus` and calls the current `onClose`; F-S2 `server/schedule.js`
  (local calendar day for every daily rule), F-S3 tick guard, task marked running before the first await, manual runs
  through `runTask` (409 while running), per-profile UC sync guard, `uc-sync` schedule text from the profiles; F-S6
  (part) `runTask` rethrows 4xx caller mistakes; F-S4 write-back groups attributes once; F-S8 agent invariant in
  `user-admin.js`; F-S9 connector sockets resolve through `guardedLookup`; F-I1 jdbc/sqlalchemy `validate` (types,
  jar); F-T1 `test/e2e/db-guard.mjs` (word-boundary name + loopback host); F-F2(a) runtime missing-key check
  (`reportMissingKeys`, `test/components/i18n-runtime.test.jsx`) + `i18n-dict-v174.js`; F-F6 keyboard access for the
  list rows + picker labels. **Wave 8 open** (consistency and coverage: F-S5/S7 one Unity reader that polls
  statements, `server/errors.js`, F-S10, F-S13 + F-T3 tests for `catalog-store`/`source-inspect`/`api.js`/`people.js`,
  F-F2 rest incl. locale-aware formatting, F-F3/F-F4/F-F12, F-F5, F-F8, F-F9, F-M4–M7, F-I2–I5, F-T2/T4/T5/T6).
  **Rules added**: a new ESLint restriction goes into the existing block of its file group (the lint-guard test must
  stay green); daily schedules use `server/schedule.js`; manual runs of scheduled work go through `runTask`; MCP
  limits carry a `max`; screens with keys from variables get a case in `i18n-runtime.test.jsx`; clickable list rows
  use `clickable()`.
- **Dependency hygiene (v1.67.5)**: `npm audit --omit=dev` must stay at 0; dev-tool advisories (vite, vitest,
  source-map-js) are fixed with `npm audit fix` + `npm update` within the semver ranges, then CI + E2E. The Python
  inspector is checked with `pip-audit -r inspector/requirements.txt`. The Node runtime itself is the operator's
  job (NodeSource apt package on the reference server, platform runtime on Databricks Apps) — Node publishes security releases
  for all lines at once; check nodejs.org/en/blog/vulnerability.
- **CI flakiness (v1.67.4)**: GitHub run 39297389316 failed only on Node 24 in `app-root.test.jsx` (search → open
  table) with a 4 s `findByText` timeout while Node 22 passed and Node 26 was cancelled by fail-fast; locally the file
  passes under Node 22 and 24 every time. Component tests render the whole App in jsdom, so on a loaded runner the
  budget must be generous: `testTimeout: 30000`, `retry: 1` only when `CI` is set, explicit 15 s waits in the test,
  `fail-fast: false` in the matrix so the other versions still report. A deterministic failure still fails (twice).
- **Copyright / licence notices**: none since **v1.79.4** (owner, 2026-11-03: "Entferne alle Lizenzbestimmungen und
  Copyrightangaben"). History: introduced v1.67.1, removed v1.67.3, re-added v1.75.0 (LICENSE with evaluation terms,
  NOTICE, header line in every file, COPYRIGHT constant shown in sign-in / help / handbook / footer / healthz / MCP),
  removed again in v1.79.4 — no LICENSE, no NOTICE, no file headers, no guard test, no `author` / `license` in
  `package.json`. Do not re-add without an explicit instruction.
- **Pentest follow-up (v1.67.0)**: session / invitation / password-reset tokens are stored as SHA-256 hashes
  (`tokenHash` in `server/auth.js`; `hashStoredTokens()` migrates legacy rows at start-up, so an upgrade signs nobody
  out) — invitation links therefore exist only in the invite response/e-mail (Admin › Users offers *Renew* and
  *Withdraw*). Password change (`POST /auth/password`, revokes the other sessions), admin-issued reset links
  (`POST /admin/users/:id/reset-password`, table `password_resets`, 24 h, single use), self-service
  `POST /auth/forgot` only with SMTP, `?reset=<token>` screen → `POST /auth/reset-password` (ends every session, keeps
  2FA, no auto sign-in). `server/housekeeping.js` purges expired sessions/invites/resets/OAuth codes and OAuth token
  rows 30 days after expiry or revocation (hourly; task `housekeeping` for SCHEDULER=external). MCP `tools/call`
  arguments are validated against the tool's `inputSchema` (`validateArgs` in `mcp.js`, every schema is closed;
  -32602 on violation). Keep new tool parameters in the schema — undeclared keys are rejected.
- **Security review (v1.66.1)**: `applyChanges` binds records to the change id and checks parent references;
  `authorizeChanges` checks both sides of a move (attribute table, table schema); MCP identity lives in an
  `AsyncLocalStorage` request context (never a shared variable), human-backed MCP credentials (OAuth, forwarded
  identity) go through the same gate as the UI, agent keys stay scope-gated, batches are capped (`MCP_MAX_BATCH`) and
  rate-limited per message, `get_audit` needs admin/steward; Databricks hosts are allow-listed
  (`workspaceHostAllowed`, `DATABRICKS_ALLOWED_HOSTS`, app identity always uses `DATABRICKS_HOST`), a host change drops
  stored secrets; connectors refuse private targets (`CONNECTORS_ALLOW_PRIVATE`), cap bodies, never echo them, and
  `tlsVerify:false` needs `CONNECTOR_ALLOW_INSECURE_TLS`; secrets sealed at rest with `SECRETS_KEY`; scrypt N=2^17
  async with transparent upgrade; TOTP counters stored (`totp_last_counter`); form posts only on routes that verify
  `_csrf`; constant-time secret compares; OAuth redirect schemes tightened, registration throttled; cookies Secure
  behind TLS; anonymous `/healthz` minimal; nginx forwards the client IP. Tests cannot reach loopback targets without
  `CONNECTORS_ALLOW_PRIVATE=1` / `DATABRICKS_ALLOWED_HOSTS` — the E2E runner sets both.
- **Frontend → backend (v1.66)**: nothing in the browser talks to Databricks any more — the `/databricks`
  proxy and the browser write-back dialog are gone. One-off UC imports run as a job
  (`server/catalog-import.js` → `runSync` with a transient profile, `POST /api/import/unity`), generic
  source loads and bundles are applied on the server (`/api/import/external`, `/api/import/bundle[/apply]`;
  dbt/ODCS parsed there), the stored document is upgraded and seeded by the server
  (`server/catalog-migrate.js` at start-up and after a dump restore — the browser never writes a
  migration delta), `/api/stats` computes attribute coverage, `/auth/me` carries role-derived
  `capabilities`. Per-object rights stay in the shared `permissions.js` because they depend on the document.
- **UC write-back (v1.64)**: the diff lives in `uc-writeback.js` (root, shared); the server
  (`server/uc-writeback-run.js`) runs it with a sync profile's credentials. Tags and column comments need the
  profile's `warehouseId` (v1.66; legacy `writeBack.warehouseId` still honoured); without a
  warehouse the SQL-only operations are counted in `skipped` (v1.64.1: `uc.sqlAvailable`,
  `ops.skippedSql`) and only comments and catalog properties are written — the run still succeeds.
  SQL identifiers are backtick-quoted, REST path segments URL-encoded. In the Databricks edition
  the job script's `uc-sync` task triggers the write-back for profiles with `enabled`.
- **SOURCE hub (v1.64.1)**: `SOURCE_HUB` in `model.js`; `seed()` includes it, `migrate()` adds it once
  (`sourceHubInit`); the tree lists it last below `.tree-sep`. Generic source loads still call
  `ensureSourceHub` when it was deleted.
- **Help & handbook (v1.65)**: three layers — `help-content.js` (+ `help-fr.js`, `help-it.js`) holds the section
  texts (same order in all languages), `help-manual.js` adds figures/example/tips per section index plus figure
  labels and handbook UI strings, `help-figures.jsx` draws the SVG figures from those labels; `help-chapters.js`
  merges everything into chapters. `?manual=1&lang=xx` renders `views/manual.jsx` (printable, no sign-in). A new
  section needs: text ×6, optional `MANUAL[lang][idx]` ×6 (the parity test enforces identical structure), and a
  chapter entry in `CHAPTERS`. New figures: component in `FIGURES` + labels in `FIG_LABELS` for every language.
- **i18n guard**: `test/unit/i18n-coverage.test.js` checks every `t()`/`tr()`/`flash()` literal AND flags
  plain JSX text nodes of three or more words (v1.64.1) — new UI text always goes through `t()`.
- **Native connectors (v1.60)**: OData/SuccessFactors, Kafka Schema Registry, Power BI and
  Informatica run in the app server (`server/connectors/`, node:http(s) transport, own EDMX
  parser, no new dependency). `GET /api/source-import/capabilities` tells the UI which modes
  are native and whether an inspector is configured/reachable; `INSPECTOR_URL=""` or `off`
  hides the inspector-only types (503 `inspector_not_configured` on the API). Since v1.73
  `server/connectors/` is the only implementation of these five modes — the Python copies and
  the `SOURCE_IMPORT_VIA_INSPECTOR` escape hatch were removed (owner's decision 2026-10-23);
  the inspector serves duckdb, lakefiles, sqlalchemy and jdbc only. Tests:
  `test/unit/connectors-native.test.js`.
- **Connectors (v1.55)**: optional drivers go into the inspector venv
  (`/opt/datahub-catalog/inspector/venv/bin/pip install pymssql oracledb snowflake-sqlalchemy`);
  lake files need DuckDB extensions (installed on first use, internet once); Power BI needs a
  service principal allowed in the admin portal (read-only admin APIs + detailed metadata);
  dbt and ODCS files are parsed in the browser — nothing is uploaded to the server except the
  resulting delta save. Inspector offline tests: `npm run test:inspector`.
- **Browser security (v1.54)**: CSRF token cookie `dhc_csrf` (readable, session-bound) — API
  clients with a cookie session must send `X-CSRF-Token`; agents use bearer keys and are
  exempt. CSP and the other headers live in `server/security.js` and, for the static files,
  in `deploy/nginx-datahub-catalog.conf` — change both when adding an external resource
  (currently only Google Fonts). `CSRF_SECRET` env overrides the stored secret. Set
  `COOKIE_SECURE=1` in the unit file once the site is served over https only.
- **Known deployment pitfalls**: stale zip extraction (check `grep '"version"' package.json`),
  browser cache (Ctrl+F5), missing `npm install --omit=dev` in `/opt` (mysql2),
  inspector venv path (`/opt/datahub-catalog/inspector/venv`, not a home directory),
  `apt update` before installing Java, nginx location regex must include `mcp`.
- **Git publishing (v1.62.1)**: GitHub's "Block command line pushes that expose my email" rejects
  commits authored with a private address (GH007). On the reference server `git config user.email` must be the
  GitHub noreply address (`<id>+MevPR@users.noreply.github.com`, see github.com/settings/emails);
  an already rejected commit is repaired with `git commit --amend --reset-author --no-edit` and
  `git tag -f vX.Y.Z` before pushing again.

## 6. Conventions

- **Every release updates `PLAN.md`** in the repository and the release notes `Releases_Notes.txt`, which since
  v1.79.5 (owner, 2026-11-03) are no longer part of the repository or the zip — delivered separately.
  The workflow visualisations (`docs/workflows/`: Graphviz plus the BPMN generator
  `bpmnlib.py` / `make_design_bpmn.py`; PDFs and .bpmn files in `public/docs/`, linked from
  the Marketplace) are one-off documents, regenerated only on request.
- Semantic-ish versioning: minor for features (1.4, 1.5, …), patch for fixes/changes.
- Version is bumped in three places: `src/lib/model.js` (`APP_VERSION`), `package.json`,
  `server.js` (`APP_VERSION` — used for the start-up log line and the MCP server info).
- Changes are delivered as the full `datahub-catalog-deploy.zip`; deployments copy
  `dist/*` to the web root and `server.js` + the `server/`, `src/` and `mcp/` directories + `mcp.js` +
  `okf.js` + `catalog-diff.js` + `csv-import.js` + `csv-export.js` + `permissions.js` +
  `package.json` + `package-lock.json` to `/opt` (`npm install --omit=dev` there).
- Source of record: `github.com/MevPR/Alassio-Data-Catalog` since v1.79.2 (owner, 2026-10-31: "für die aktuelle und
  alle zukünftigen Versionen"; v1.52.0–v1.79.1 were pushed to `MevPR/cortex-data-catalog`). Release routine on the
  reference server: unzip the package to `~/release`, `rsync -a --delete` into `~/datahub-catalog`
  (excluding `.git`, `node_modules`, `dist`, `venv`, `inspector/venv`), build and deploy,
  then `git add -A`, `git commit -m "vX.Y.Z"`, `git tag vX.Y.Z`, `git push --tags origin main`;
  GitHub Actions runs lint, tests, build and E2E on Node 22/24/26 for every push.
- Quality gates: `npm run lint`, `npm test` (unit + component incl. a smoke render of every
  dialog/view and of the application root), `npm run test:e2e`
  (server + MCP against MariaDB, needs DB_* env), `npm run ci` = lint + test + build;
  `.github/workflows/ci.yml` runs all of it with a MariaDB service.
