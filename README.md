# Alassio Data Catalog

**A data catalog for data governance with an integrated data marketplace — run it as a Databricks App or standalone on your own server.**

Alassio describes which data exists, where it lives, who is responsible for it and how it fits together — technically
(databases, tables, columns, lineage) and in business terms (definitions, glossary, data products). On top of the
catalog, an integrated marketplace lets people request access to data products and design new ones in a guided,
multi-stage workflow. AI agents read and maintain the catalog through a built-in Model Context Protocol (MCP) server,
with the same permissions and audit trail as people.

| | |
| --- | --- |
| **Data governance** | owners, stewards and business process owners on every level, certification, review cycles, ownership attestation, PII flags, field-level audit trail |
| **Data marketplace** | access requests for data products, a three-phase data product design workflow, status overview of every planned and finished product |
| **Runs anywhere** | the same code as a **Databricks App** (Lakebase, platform sign-in, Unity Catalog volume) or **standalone** on Ubuntu (MariaDB/PostgreSQL, nginx) |
| **Unity Catalog native** | import, scheduled synchronisation with drift reports, write-back with preview — each user writes back their own changes |
| **AI-ready** | MCP server with 41 tools and the whole catalog as an Open Knowledge Format bundle |

---

## Contents

- [Deployment options](#deployment-options)
- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Get started](#get-started)
- [Documentation](#documentation)
- [Configuration](#configuration)
- [Development](#development)
- [Repository layout](#repository-layout)
- [What's new](#whats-new)

---

## Deployment options

Alassio is one code base. Whether it runs inside Databricks or on a server of your own is decided by configuration
alone — there is no fork and no separate build.

| | **Databricks App** | **Standalone (Ubuntu)** |
| --- | --- | --- |
| Hosting, TLS | Databricks Apps platform | nginx + Let's Encrypt |
| Storage | Databricks **Lakebase** (PostgreSQL), credentials from the app's service principal | **MariaDB** (default) or **PostgreSQL** |
| Sign-in | Databricks identity forwarded by the platform; roles from Databricks groups | passwords + TOTP 2FA, optional **Microsoft Entra ID** SSO with group → role mapping |
| Source systems | native API connectors; databases through **Lakehouse Federation** and the Unity Catalog import | native API connectors **plus** the optional Python inspector (DuckDB, data lake files, SQLAlchemy, JDBC) |
| Backups | Unity Catalog **volume** | local directory, S3-compatible bucket or Azure Blob |
| Scheduled work | a Databricks **job** calls the task endpoints | built-in scheduler |
| MCP clients | sign in to Databricks and act as themselves | agent keys, OAuth 2.1 (as the user) or a static token |
| Configuration | `app.yaml` ([template](deploy/databricks/app.yaml)) | systemd unit ([template](deploy/datahub-catalog-proxy.service)) |

Choose **Databricks App** when your data platform is Databricks and you want the catalog next to Unity Catalog with no
infrastructure of its own. Choose **standalone** when you need it outside Databricks, want password or Entra ID sign-in,
or need the Python inspector for on-premises databases and files.

> The Databricks edition is covered by automated tests (PostgreSQL, proxy sign-in, operation without the inspector,
> task token, both Lakebase credential flows) but has not yet been run in a real workspace. The
> [deployment guide](docs/Alassio_Deployment_Guide_Databricks_App.pdf) marks the points to verify on the first deployment.

---

## Features

**Catalog and search**
- Hierarchy *data hub type → data hub → database → schema → table → attribute*, with data domains, people, lineage and glossary
- Technical metadata (types, constraints, sensitivity, PII) and business metadata (definitions, business terms, tags) on separate tabs
- Relevance-ranked full-text search with facets (object type, hub, medallion layer, sensitivity)
- Dashboard with KPIs and governance coverage; lazy loading for catalogs with hundreds of thousands of attributes

**Data governance and stewardship**
- Responsibilities inherited downwards (BPO → domain → database → schema → table) and overridable on every level
- Certify, deprecate with successor, review cycles (90/180/365 days), ownership attestation, reminders
- Field-level audit trail with version history and one-click restore
- Eight roles from Admin and Data Steward to Guest and Agent; roles from identity-provider groups

**Integrated marketplace**
- Access requests for data products (gold-layer schemas) with decision and notification
- Data product design across three phases — sourcing, refinement, development & test / sign-off — with return, withdrawal and file attachments
- *Discover Data Products*: every finished and planned data product with phase, status and whose feedback is awaited
- Personal dashboard with everything waiting for your action; in-app inbox and e-mail in the recipient's language

**Lineage, glossary and collaboration**
- Table lineage with column mapping; full feeding chain of a data product
- Glossary with definitions, linked catalog objects, URLs and file attachments
- Discussion per table, questions to steward and owner, star ratings, usage statistics

**Unity Catalog and Databricks**
- Import of catalogs incl. lineage and governance tags
- Scheduled synchronisation: *report only* (drift notifications) or *apply*
- Write-back of descriptions, tags and properties with a preview; every user writes back their own changes

**Imports, exports and connectors**
- CSV import/export (one row per attribute, background jobs for very large files), dbt projects, ODCS data contracts
- Native connectors: OData v2/v4 incl. SAP SuccessFactors, Kafka Schema Registry, Power BI, Informatica
- Optional inspector (standalone): DuckDB, Parquet/CSV/JSON/Delta/Iceberg files (local, S3, Azure), MySQL/MariaDB, PostgreSQL, SQL Server, Oracle, Snowflake, SAP HANA, DB2, generic JDBC
- Open Knowledge Format export, full dump and restore

**AI agents (MCP)**
- Streamable HTTP MCP server at `/mcp` with 41 tools (read, search, lineage, audit, maintenance, glossary, stewardship, discussion)
- The catalog as OKF resources (`okf://index.md`) for progressive reading
- Same rules as the UI, rate limits per credential, every agent change audited

**Operations and security**
- Daily backups with restore drill; health check `/healthz`; background job list; tasks callable by external schedulers
- scrypt passwords, TOTP, hashed session and invitation tokens, CSRF protection, Content-Security-Policy, encrypted stored secrets, SSRF guards
- UI, help and handbook in English, German, Polish, Spanish, French and Italian; accessible and usable on mobile

---

## Architecture

```
  Browser (React UI)        AI agents / MCP clients        Identity provider
          │  HTTPS                    │  HTTPS · JSON-RPC        (Entra ID / Databricks)
          ▼                           ▼                                │
 ┌──────────────────────────────────────────────────────────────────────┴──┐
 │   nginx (standalone)  ·  Databricks Apps platform (Databricks App)       │
 └───────────────────────────────────┬─────────────────────────────────────┘
                                     ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │  Application server · Node.js / Express 5                                 │
 │  identity · catalog · workflows · import/export · Unity Catalog ·         │
 │  MCP + OAuth · operations (jobs, scheduler, backups, health)              │
 └──────┬──────────────────┬───────────────────┬─────────────────┬──────────┘
        │ SQL              │ HTTP (optional)   │ HTTPS           │ HTTPS / SMTP
        ▼                  ▼                   ▼                 ▼
  MariaDB · PostgreSQL   Source inspector    Databricks /       OData, Kafka SR,
  · Lakebase             (Python / Flask)    Unity Catalog      Power BI, Informatica,
                                                                SMTP, backup storage
```

- **UI** — React 19 single-page app built with Vite. It talks only to its own server; Databricks, source systems and
  mail servers are reached from the server.
- **Application server** — one Node.js process (Express 5) organised into domain modules (`server/`), thin routes
  (`server/routes/`) and the MCP server (`mcp.js`, `mcp/tools/`). Lint rules enforce the layering.
- **Database layer** — one SQL dialect in the code, translated for PostgreSQL (DDL, tsvector full-text search, upserts);
  tables are created and migrated at start-up.
- **Source inspector** — optional Python service for sources that need native drivers; not used on Databricks.

Details, data model and security: [Architecture and Features (PDF)](docs/Alassio_Architecture_and_Features.pdf).

---

## Prerequisites

**Standalone (Ubuntu)**
- Ubuntu 22.04 LTS or later, x86_64 or ARM64; 2 CPU cores, 4 GB RAM, 10 GB disk
- Node.js 24 LTS (at least 22.12)
- MariaDB 10.6+ or PostgreSQL 14+
- nginx; a DNS name for HTTPS (recommended)
- Optional: Python 3.10+ for the source inspector, Java for JDBC sources, SMTP for e-mail

**Databricks App**
- A Databricks workspace with Databricks Apps enabled (configuration targets Azure Databricks)
- A Lakebase database (Autoscaling project or Provisioned instance)
- A Unity Catalog volume for backups and a secret scope for the task token
- Databricks CLI on your workstation
- Optional: Lakehouse Federation connections for external databases, a SQL warehouse for governance tags and write-back

**For development**
- Node.js 22.12+, MariaDB or PostgreSQL for the end-to-end tests, Python 3.10+ for the inspector tests

---

## Get started

### Try it locally (5 minutes)

Needs Node.js 22.12+ and a local MariaDB.

```
git clone https://github.com/MevPR/Alassio-Data-Catalog.git
cd Alassio-Data-Catalog
sudo mysql -e "CREATE DATABASE datahub_catalog CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER 'datahub'@'localhost' IDENTIFIED BY 'change-me';"
sudo mysql -e "GRANT ALL PRIVILEGES ON datahub_catalog.* TO 'datahub'@'localhost';"
npm install
npm run build
DB_USER=datahub DB_PASSWORD=change-me INSPECTOR_URL= npm run proxy
```

Open <http://127.0.0.1:3000>. On the first visit the catalog asks you to create the administrator account. The tables
are created automatically; `INSPECTOR_URL=` (empty) runs without the optional Python inspector.

### Run it standalone on Ubuntu

Follow the [Deployment Guide · Ubuntu](docs/Alassio_Deployment_Guide_Ubuntu.pdf). In short: install Node.js 24 and
MariaDB, build the UI into `/var/www/datahub-catalog`, install the server to `/opt/datahub-catalog`, configure and
start the systemd unit from [`deploy/`](deploy/), put nginx with the shipped
[site template](deploy/nginx-datahub-catalog.conf) in front, add HTTPS — then sign in and create the administrator.

### Run it as a Databricks App

Follow the [Deployment Guide · Databricks App](docs/Alassio_Deployment_Guide_Databricks_App.pdf). In short:

```
git clone https://github.com/MevPR/Alassio-Data-Catalog.git
cd Alassio-Data-Catalog
cp deploy/databricks/app.yaml app.yaml
vim app.yaml
databricks apps create alassio-catalog
databricks sync . /Workspace/Users/<you>/alassio-catalog
databricks apps deploy alassio-catalog --source-code-path /Workspace/Users/<you>/alassio-catalog
```

Before deploying, attach the Lakebase database, the backup volume and the secret to the app and set
`LAKEBASE_ENDPOINT`, `AUTH_BOOTSTRAP_ADMINS`, `APP_URL` and `DATABRICKS_VOLUME_PATH` in `app.yaml`. The platform runs
`npm install` and `npm run build` itself. A Databricks job running
[`deploy/databricks/run_tasks.py`](deploy/databricks/run_tasks.py) hourly takes over synchronisation, reminders and
backups. More in [`deploy/databricks/README.md`](deploy/databricks/README.md).

### Connect an AI agent

```
curl -s https://<host>/mcp -H "Authorization: Bearer <agent-key>" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Create the agent key under *Admin › Users › Invite Agent*, or let MCP clients sign in with OAuth 2.1 as yourself.

---

## Documentation

| Document | Content |
| --- | --- |
| [Deployment Guide · Ubuntu](docs/Alassio_Deployment_Guide_Ubuntu.pdf) | step-by-step standalone installation, updates, backups, troubleshooting |
| [Deployment Guide · Databricks App](docs/Alassio_Deployment_Guide_Databricks_App.pdf) | Lakebase, app resources, `app.yaml`, deployment, scheduled job, Unity Catalog permissions |
| [Architecture and Features](docs/Alassio_Architecture_and_Features.pdf) | system architecture, components, data model, roles, features, workflow, security |
| [Technical reference](docs/REFERENCE.md) | notes on the Databricks edition, connectors, database engines, identity, OAuth, backups, stewardship, security headers |
| In-app help and handbook | the *i* icon in the app; a printable handbook in six languages |

The guides are generated from [`docs/guides/`](docs/guides/) (`python3 docs/guides/ubuntu_en.py <version> <file.pdf>`).

---

## Configuration

Standalone installations are configured through `Environment=` lines in the systemd unit, Databricks Apps through
`app.yaml`. The most important variables:

| Variable | Purpose |
| --- | --- |
| `APP_URL` | public URL (links in e-mails, OAuth issuer for MCP clients) |
| `DB_DRIVER` | `mariadb` (default) or `postgres` |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | database connection |
| `DB_PASSWORD_PROVIDER`, `LAKEBASE_ENDPOINT` / `LAKEBASE_INSTANCE` | Lakebase credentials through the app's service principal |
| `AUTH_MODE` | `local` (default) or `header` (sign-in by the platform or a proxy) |
| `AUTH_BOOTSTRAP_ADMINS`, `AUTH_GROUPS_FROM` | first admins and group source in header mode |
| `SECRETS_KEY` | encrypts stored Databricks and Entra secrets |
| `INSPECTOR_URL` | URL of the Python inspector; empty to run without it |
| `BACKUP_STORAGE` | `local`, `s3`, `azure` or `databricks` |
| `SCHEDULER`, `TASKS_TOKEN` | `external` to let a cron job or Databricks job run the tasks |
| `MCP_TOKEN` | optional static bearer token for MCP clients |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | e-mail |

Every variable is documented in [`deploy/datahub-catalog-proxy.service`](deploy/datahub-catalog-proxy.service) and
[`deploy/databricks/app.yaml`](deploy/databricks/app.yaml).

---

## Development

```
npm install
npm run lint
npm test
npm run test:e2e
npm run test:inspector
```

- `npm test` runs the unit and component tests (Vitest; unit in Node, components in jsdom).
- `npm run test:e2e` starts the server against a real database; set `DB_USER`, `DB_PASSWORD` and `DB_NAME` (the name
  must contain `test` or `e2e` — the suite resets it), and `DB_DRIVER=postgres` for PostgreSQL.
- `npm run dev` serves the UI with Vite; `npm run proxy` starts the server.
- GitHub Actions runs lint, tests, build, inspector tests and the end-to-end suite on MariaDB and PostgreSQL for
  Node.js 22, 24 and 26.

---

## Repository layout

```
server.js, mcp.js        composition roots of the server and the MCP server
server/                  domain modules (auth, catalog, workflows, Unity Catalog, backups, …) and routes/
mcp/                     MCP tools, schemas and views
src/                     React UI: views/, components/, hooks/, lib/ (pure logic), help and translations
inspector/               optional Python source inspector (Flask) with connectors/
deploy/                  systemd units, nginx template, databricks/ (app.yaml, job script)
docs/                    deployment guides, architecture PDF, technical reference, guide and workflow generators
public/docs/             BPMN models and process PDFs served by the app under /docs
test/                    unit/, components/, e2e/
```

---

## What's new

### v1.79.7

Prepared for a public repository: example host names and paths, the agent-key placeholder and the MCP tool examples
are neutral; no personal name in documentation or PDF metadata. The neutrality test now also covers the README,
PLAN.md, `docs/` and the metadata of the shipped PDFs.

### v1.79.6

New README describing the solution, deployment options, features, prerequisites, architecture and getting started.
The deployment guides (Ubuntu, Databricks App) and the architecture and features document are shipped as PDFs in
[`docs/`](docs/); the former reference sections moved to [`docs/REFERENCE.md`](docs/REFERENCE.md). The Databricks
deployment notes now reflect that the platform builds the app itself.

### v1.79.5

Initial Release
