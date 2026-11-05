# Alassio Data Catalog on Databricks Apps (Azure)

Same repository, no fork: the Databricks edition is `app.yaml` plus the environment variables documented there.
Prepared in v1.59 (dialect-neutral DB layer, identity layer, storage / scheduler / health, streaming, UC sync),
v1.60 (HTTPS connectors native in Node, inspector optional) and v1.61 (this folder, MCP behind the platform sign-in,
Lakebase resource binding, task token header). **Not yet verified against a real workspace** — the points marked
*verify* below are the ones to watch on the first deployment.

## 1. Prerequisites in the workspace

| What | Why |
| --- | --- |
| Lakebase (Postgres): an Autoscaling project with a branch, a compute endpoint and a database (today's default; `LAKEBASE_ENDPOINT`) — or an existing Provisioned instance (`LAKEBASE_INSTANCE`) | catalog storage (`DB_DRIVER=postgres`); the attached database resource injects `PGHOST/PGPORT/PGUSER/PGDATABASE/PGSSLMODE` |
| Unity Catalog volume, e.g. `/Volumes/main/alassio/backups` | backups (`BACKUP_STORAGE=databricks`) |
| Secret scope with `tasks-token` (and `smtp-pass` if mail is used) | `TASKS_TOKEN`, `SMTP_PASS` |
| App resources attached: the database, the volume, the secrets | injects `PGHOST…`, grants the app's service principal access |
| Lakehouse Federation connections for SQL Server / Oracle / Snowflake / Postgres / … | replaces the Python inspector: foreign catalogs are loaded with the UC import or the scheduled UC sync |
| User authorization scope `iam.current-user:read` (app settings) | `AUTH_GROUPS_FROM=databricks` reads the caller's groups via SCIM `/Me` with the forwarded token (*verify*; fall back to a group mapping fed by an `x-forwarded-groups` header if the scope is not available) |

Attaching the database resource creates a Postgres role for the app's service principal with CONNECT and CREATE on the database (it creates the Cortex tables on first start), write
access to the volume and, for the scheduled UC sync with `auth.type = app`, `USE CATALOG` / `USE SCHEMA` /
`SELECT` on the catalogs to be synchronised.

## 2. Deploy

```
git clone https://github.com/MevPR/Alassio-Data-Catalog.git
cd Alassio-Data-Catalog
cp deploy/databricks/app.yaml app.yaml
vim app.yaml
databricks apps create alassio-catalog
databricks sync . /Workspace/Users/<you>/alassio-catalog
databricks apps deploy alassio-catalog --source-code-path /Workspace/Users/<you>/alassio-catalog
```

`databricks sync` honours `.gitignore` (no `node_modules`, `dist`, virtualenvs). During the deployment the platform runs
`npm install` and `npm run build` (the `build` script in `package.json`) and then the `command` from `app.yaml`
(`node server.js`), which listens on `0.0.0.0:$DATABRICKS_APP_PORT`. An app connected to the Git repository can also be
deployed by tag: `databricks apps deploy alassio-catalog --git-tag vX.Y.Z` (then `app.yaml` must be in the repository
root). Check `https://<app-url>/healthz` → `"status":"ready"`. Step-by-step guide:
[`docs/Alassio_Deployment_Guide_Databricks_App.pdf`](../../docs/Alassio_Deployment_Guide_Databricks_App.pdf).

## 3. What changes compared to the Pi

- **Sign-in**: no password screen — the platform authenticates; the first sign-in of an `AUTH_BOOTSTRAP_ADMINS`
  account creates it as admin, everyone else is provisioned with `AUTH_HEADER_DEFAULT_ROLES` or by the group
  mapping (Admin › Agents & SSO › Group mapping). Break-glass passwords, TOTP, invitations and the own OAuth server are
  not used.
- **MCP**: clients authenticate against Databricks (OAuth of the workspace, app URL `https://<app-url>/mcp`); the app
  acts as the forwarded identity — write tools for admins and stewards, read-only otherwise. `MCP_TOKEN` stays unset.
- **Scheduled work**: `SCHEDULER=external`. A Databricks Job (Python-script task `deploy/databricks/run_tasks.py`,
  serverless, hourly) calls the task endpoints with the token in the `X-Tasks-Token` header, because `Authorization`
  is consumed by the platform. Job parameters: `APP_URL`, `SECRET_SCOPE` (default `cortex`); the script reads
  `tasks-token` from that scope and runs `uc-sync`, `stewardship-reminders`, `backup` and `usage-purge`.
  `backup` writes the gzip'd catalog dump to the volume; the SQL dump is skipped (no `pg_dump` in the app runtime).
- **Unity Catalog import (v1.66)**: Import › Unity Catalog runs on the server — pick a sync profile or choose
  *App identity* for a one-off import; nothing in the browser talks to Databricks (the former `/databricks` proxy
  is gone), so the app's service principal needs `USE CATALOG` / `USE SCHEMA` / `SELECT` on the catalogs to import
  and, for governance tags, `CAN USE` on the SQL warehouse.
- **Unity Catalog write-back (v1.64)**: a sync profile with *Write catalog metadata back* enabled pushes descriptions,
  tags and properties to UC after each `uc-sync` run (or via the `uc-writeback` task / `POST
  /admin/sync/profiles/:id/writeback`). With the app's own identity the service principal needs `USE CATALOG`,
  `USE SCHEMA` and `MODIFY` (or ownership) on the target objects and `CAN USE` on the SQL warehouse whose ID is set
  in the profile; without a warehouse ID the SQL-only changes (column comments, table properties, tags) are counted
  as skipped and only comments and catalog properties are written.
- **Sources**: no Python inspector (`INSPECTOR_URL=""`) — the Load-source dialog offers OData/SuccessFactors, Kafka
  Schema Registry, Power BI, Informatica, dbt, ODCS and CSV; databases are registered in Unity Catalog (Lakehouse
  Federation) and loaded with the UC import or a sync profile. Egress to those APIs follows the workspace network
  policy (*verify*).
- **Files**: `DATA_DIR=/tmp/cortex` holds upload temp files only; nothing on the app's disk is persistent.
- **Mail**: SMTP egress is not guaranteed (*verify*); without it, notifications stay in the in-app inbox.

## 4. Local dry run of the configuration

The E2E suite covers the edition's switches without a workspace: `DB_DRIVER=postgres` (CI), `AUTH_MODE=header`
with MCP as the forwarded identity (`test/e2e/server2-header-auth.e2e.test.mjs`), `INSPECTOR_URL=""`
(`test/e2e/server3-no-inspector.e2e.test.mjs`), the `X-Tasks-Token` header (`test/e2e/ops.e2e.test.mjs`),
storage providers and both Lakebase credential flows — Autoscaling `/api/2.0/postgres/credentials` and Provisioned `/api/2.0/database/credentials` (`test/unit/lakebase.test.js`).
