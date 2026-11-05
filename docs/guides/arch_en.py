import sys
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon
from reportlab.lib import colors
from doclib import *

V = sys.argv[1]
OUT = sys.argv[2]


from reportlab.pdfbase.pdfmetrics import stringWidth


def fit(text, font, size, width):
    while size > 5 and stringWidth(text, font, size) > width:
        size -= 0.2
    return size


def node(d, x, y, w, h, title, lines=(), fill=colors.white, stroke=BRAND, tcol=None):
    d.add(Rect(x, y, w, h, rx=5, ry=5, fillColor=fill, strokeColor=stroke, strokeWidth=1))
    d.add(String(x + w / 2, y + h - 13, title, fontName="Sans-Bold", fontSize=fit(title, "Sans-Bold", 8.6, w - 6), fillColor=tcol or BRAND_DARK, textAnchor="middle"))
    size = min([fit(ln, "Sans", 7.1, w - 6) for ln in lines] or [7.1])
    for i, ln in enumerate(lines):
        d.add(String(x + w / 2, y + h - 25 - i * 10, ln, fontName="Sans", fontSize=size, fillColor=INK, textAnchor="middle"))


def arrow(d, x1, y1, x2, y2, label=None, both=False, dx=4, dy=0):
    d.add(Line(x1, y1, x2, y2, strokeColor=MUTED, strokeWidth=0.9))
    import math
    def head(xa, ya, xb, yb):
        a = math.atan2(yb - ya, xb - xa); L = 5
        d.add(Polygon([xb, yb, xb - L * math.cos(a - 0.4), yb - L * math.sin(a - 0.4), xb - L * math.cos(a + 0.4), yb - L * math.sin(a + 0.4)],
                      fillColor=MUTED, strokeColor=MUTED, strokeWidth=0.5))
    head(x1, y1, x2, y2)
    if both:
        head(x2, y2, x1, y1)
    if label:
        d.add(String((x1 + x2) / 2 + dx, (y1 + y2) / 2 + dy, label, fontName="Sans", fontSize=6.6, fillColor=MUTED))


def arch_diagram():
    W, H = WIDTH, 395
    d = Drawing(W, H)
    node(d, 0, 335, 150, 52, "Browser", ["users of all roles", "React UI (single-page app)"], fill=BRAND_SOFT)
    node(d, 170, 335, 150, 52, "AI agents / MCP clients", ["Claude, IDE assistants,", "agent frameworks"], fill=BRAND_SOFT)
    node(d, 340, 335, W - 340, 52, "Identity provider", ["Microsoft Entra ID (OIDC) or", "Databricks platform sign-in"], fill=BRAND_SOFT)
    node(d, 0, 270, W, 40, "nginx (Ubuntu)  ·  Databricks Apps platform", ["TLS, static UI, forwarding of /auth /api /admin /mcp /oauth /.well-known /healthz"], fill=colors.HexColor("#F4F6F8"), stroke=MUTED)
    arrow(d, 75, 335, 75, 312, "HTTPS", dx=4)
    arrow(d, 245, 335, 245, 312, "HTTPS · JSON-RPC", dx=4)
    arrow(d, 420, 335, 420, 312, "OIDC / identity", dx=4)
    d.add(Rect(0, 112, W, 140, rx=6, ry=6, fillColor=colors.white, strokeColor=BRAND, strokeWidth=1.4))
    d.add(String(8, 238, "Application server · Node.js / Express 5  (server.js + server/*, mcp/*)", fontName="Sans-Bold", fontSize=9, fillColor=BRAND_DARK))
    mods = [("Identity", ["sessions, 2FA", "SSO, proxy", "sign-in", "roles, CSRF"]),
            ("Catalog", ["storage", "delta saves", "search", "audit trail"]),
            ("Workflows", ["marketplace", "design workflow", "stewardship", "discussion"]),
            ("Import/Export", ["CSV, dbt, ODCS", "source systems", "CSV, OKF", "dump, restore"]),
            ("Unity Catalog", ["import", "scheduled sync", "drift report", "write-back"]),
            ("MCP, OAuth", ["41 tools", "OKF resources", "OAuth 2.1", "rate limits"]),
            ("Operations", ["jobs", "scheduler", "backups", "health check"])]
    mw = (W - 16 - 6 * 5) / 7
    for i, (t, ls) in enumerate(mods):
        node(d, 8 + i * (mw + 5), 122, mw, 104, t, ls, fill=colors.HexColor("#F7FAFD"), stroke=colors.HexColor("#9DBFDC"))
    arrow(d, W / 2, 270, W / 2, 254)
    bw = (W - 3 * 10) / 4
    node(d, 0, 18, bw, 70, "Database", ["MariaDB · PostgreSQL ·", "Databricks Lakebase", "users, catalog, audit"], fill=colors.HexColor("#EEF7F0"), stroke=colors.HexColor("#5E9C6E"), tcol=colors.HexColor("#2E6B3E"))
    node(d, bw + 10, 18, bw, 70, "Source inspector (optional)", ["Python / Flask", "DuckDB, lake files,", "SQLAlchemy, JDBC"], fill=colors.HexColor("#FBF4E6"), stroke=colors.HexColor("#C99A3C"), tcol=colors.HexColor("#7A5A12"))
    node(d, 2 * (bw + 10), 18, bw, 70, "Databricks / Unity Catalog", ["REST API + SQL warehouse", "import, sync, write-back", "Lakehouse Federation"], fill=colors.HexColor("#F4F6F8"), stroke=MUTED, tcol=INK)
    node(d, 3 * (bw + 10), 18, bw, 70, "External services", ["OData/SuccessFactors, Kafka SR,", "Power BI, Informatica", "SMTP · backup storage"], fill=colors.HexColor("#F4F6F8"), stroke=MUTED, tcol=INK)
    for i, lab in enumerate(["SQL", "HTTP :3001", "HTTPS", "HTTPS / SMTP"]):
        x = i * (bw + 10) + bw / 2
        arrow(d, x, 112, x, 90, lab, dx=4)
    return d


def model_diagram():
    W, H = WIDTH, 128
    d = Drawing(W, H)
    chain = ["Data hub type", "Data hub", "Database", "Schema", "Table", "Attribute"]
    sub = [["Finance, HR,", "Sales, SOURCE"], ["e.g. SALES_DE", "with BPO"], ["medallion", "layer"], ["in gold:", "data product"], ["owner, steward,", "tags"], ["type, sensitivity,", "PII"]]
    bw = (W - 5 * 14) / 6
    for i, (c, s) in enumerate(zip(chain, sub)):
        x = i * (bw + 14)
        node(d, x, 62, bw, 50, c, s, fill=BRAND_SOFT)
        if i:
            arrow(d, x - 14, 89, x - 1, 89)
    side = [("Data domain", "owner, steward"), ("People", "responsibilities"), ("Lineage", "tables and columns"), ("Glossary", "terms, files"), ("Audit trail", "every change")]
    sw = (W - 4 * 12) / 5
    for i, (t, s) in enumerate(side):
        node(d, i * (sw + 12), 4, sw, 42, t, [s], fill=colors.HexColor("#F7F9FB"), stroke=colors.HexColor("#9DBFDC"))
    return d


def workflow_diagram():
    W, H = WIDTH, 92
    d = Drawing(W, H)
    phases = [("Submission", ["Project Manager", "project, use case", "source tables"]),
              ("Phase 1 · Sourcing", ["BA refines", "BPO approves", "ingestion confirms"]),
              ("Phase 2 · Refinement", ["Business Analyst", "completes the", "refinement"]),
              ("Phase 3 · Dev & Test", ["development", "UAT, SIT, release", "sign-off"]),
              ("Done", ["tags on the", "gold schema"])]
    bw = (W - 4 * 14) / 5
    for i, (t, ls) in enumerate(phases):
        x = i * (bw + 14)
        fill = colors.HexColor("#EEF7F0") if i == 4 else BRAND_SOFT
        node(d, x, 14, bw, 66, t, ls, fill=fill)
        if i:
            arrow(d, x - 14, 47, x - 1, 47)
    d.add(String(0, 2, "Every step can be returned with a reason; a design can be withdrawn with a reason until “Done”. Everyone involved is notified.",
                 fontName="Sans", fontSize=6.8, fillColor=MUTED))
    return d


st = []
st += cover("Architecture and Features",
            f"Overview of the Alassio Data Catalog · Version {V}",
            ["The Alassio Data Catalog is a self-hosted enterprise data catalog. It describes which data exists, where it lives, "
             "who is responsible for it and how it connects – technically (databases, tables, columns, lineage) and in business "
             "terms (definitions, glossary, data products). In the marketplace people request access and design new data products "
             "in a multi-stage workflow; AI agents read and maintain the catalog through the Model Context Protocol.",
             "This document is for architects, operators and business owners and describes the structure, data model, security "
             "and features."],
            [[P("<b>Technology</b>", "cell"), P("React 19 / Vite (UI) · Node.js / Express 5 (server) · MariaDB or PostgreSQL / Lakebase · optional Python (inspector)", "cell")],
             [P("<b>Operation</b>", "cell"), P("own Ubuntu server behind nginx or Databricks App – the same code, differing only in configuration", "cell")],
             [P("<b>Languages</b>", "cell"), P("UI, help and notifications in English, German, Polish, Spanish, French and Italian", "cell")],
             [P("<b>Interfaces</b>", "cell"), P("REST API of the UI · MCP server (41 tools, OKF resources) · Unity Catalog · CSV, OKF, dbt, ODCS · source system connectors", "cell")]])

st.append(PageBreak())
st += H1("1 · System architecture")
st.append(arch_diagram())
st.append(Spacer(1, 8))
st.append(P("The UI is a single-page application that talks only to its own server – Databricks, source systems and mail servers "
            "are reached exclusively from the server. The server is a single Node.js process organised internally into domain "
            "modules; routes only handle input and output, the rules live in the modules. An ESLint rule enforces this layering "
            "(routes never import routes, domain modules never import routes, the UI never imports server code)."))
st += H2("Components in detail")
st += table([["Component", "Structure", "Responsibilities"],
             ["UI", "React 19, Vite; one view per page, hooks for flows, pure logic in <code>src/lib</code>; contexts for catalog data, navigation and actions", "navigation of the catalog tree, faceted search, editing, dashboards, marketplace, administration, help and printable handbook; accessible (focus handling, keyboard) and usable on mobile"],
             ["Application server", "Express 5; <code>server.js</code> as composition root, domain modules in <code>server/</code>, routes in <code>server/routes/</code>", "sign-in, permission checks, saving the catalog as deltas, workflows, imports and exports as background jobs, Unity Catalog integration, scheduler"],
             ["MCP server", "<code>mcp.js</code> (protocol) and <code>mcp/tools/*</code>; Streamable HTTP, JSON-RPC 2.0", "41 tools for reading, search, lineage, audit, maintenance, glossary, stewardship and discussion; the catalog as an OKF bundle (resources <code>okf://</code>)"],
             ["Database layer", "<code>server/db.js</code>: one SQL dialect in the code, translated for PostgreSQL (DDL, full-text search via tsvector, upserts)", "MariaDB (default), PostgreSQL or Databricks Lakebase with token sign-in through the service principal"],
             ["Native connectors", "<code>server/connectors/</code> (Node)", "OData v2/v4 incl. SAP SuccessFactors, Kafka Schema Registry (Avro, JSON Schema, Protobuf), Power BI Scanner API, Informatica Catalog API"],
             ["Source inspector", "Python / Flask, mode registry in <code>inspector/connectors/</code>", "DuckDB files, data lake files (Parquet, CSV, JSON, Delta, Iceberg; local, S3, Azure), SQL databases via SQLAlchemy, generic JDBC"]],
            [0.17, 0.38, 0.45])

st += H1("2 · Data model")
st.append(model_diagram())
st.append(Spacer(1, 6))
st.append(P("The catalog is hierarchical: <b>data hub type → data hub → database → schema → table → attribute</b>. "
            "Data hub types group by business segment; the SOURCE type for generic source systems always exists and is listed last in the tree. "
            "Databases carry a medallion layer (bronze, silver, gold) that their tables inherit; schemas in gold databases are "
            "<b>data products</b>. Responsibility is inherited downwards (BPO of the data hub → domain → database → schema → table) "
            "and can be overridden on every level."))
st += table([["Area", "Tables"],
             ["Catalog", "<code>cat_hubs</code>, <code>cat_databases</code>, <code>cat_schemas</code>, <code>cat_tables</code>, <code>cat_attributes</code>, <code>cat_domains</code>, <code>cat_people</code>, <code>cat_lineage</code>, <code>cat_glossary</code>, <code>catalog_meta</code>"],
             ["Users and access", "<code>users</code>, <code>sessions</code>, <code>invites</code>, <code>password_resets</code>, <code>agent_keys</code>, <code>oauth_clients</code>, <code>oauth_codes</code>, <code>oauth_tokens</code>"],
             ["Collaboration", "<code>marketplace_requests</code>, <code>request_files</code>, <code>messages</code>, <code>comments</code>, <code>ratings</code>, <code>usage_events</code>, <code>glossary_files</code>"],
             ["Operations", "<code>audit</code>, <code>jobs</code>, <code>backups</code>, <code>settings</code>"]],
            [0.22, 0.78])
st.append(P("Every change is recorded field by field with user, timestamp and old and new value in the audit trail. This drives the "
            "version history with restore and the attribution of changes to people for the write-back to Unity Catalog. "
            "Above 5,000 attributes the UI loads columns only when a table is opened; exports and KPIs are computed in full on the server."))

st += H1("3 · Roles and permissions")
st += table([["Role", "May"],
             ["Admin", "everything, including user management, SSO, backups, synchronisation and reading source systems"],
             ["Data Steward", "create, change and delete all catalog objects, maintain the glossary, imports, stewardship"],
             ["Project Manager", "design data products and drive them through the workflow, request business descriptions"],
             ["Business Analyst / Req. Engineer", "refine designs, document the sourcing (phases 1 and 2)"],
             ["Data Ingestion", "confirm the ingested tables (phase 1)"],
             ["Development &amp; Test / Sign-off", "develop, test, sign off (phase 3)"],
             ["Guest", "read, request access, discuss, rate"],
             ["Agent", "technical account for MCP with read or write access, without a governance role"]],
            [0.3, 0.7])
st.append(P("A person can hold several roles; the highest applies. Responsibilities count as well: owners and stewards may maintain, "
            "certify and attest the objects in their area. Roles can be derived from identity provider groups (Entra ID, proxy header "
            "or Databricks groups)."))

st += H1("4 · Features")
feat = [
    ("Catalog and search", ["Tree, cards and detail pages for every level; technical and business metadata on separate tabs.",
                            "Relevance-ranked full-text search across names, descriptions, definitions, terms, tags, data types and stewards, with facets for object type, hub, layer and sensitivity.",
                            "Dashboard with KPIs and governance coverage (owner, steward, descriptions, sensitivity)."]),
    ("Governance and stewardship", ["Governance Overview for domains, people and assignments; PII flag per attribute.",
                                    "Certify, deprecate (with successor), review cycles (90/180/365 days) and ownership attestation with reminders.",
                                    "Project and use case tags on tables and data products."]),
    ("Lineage and glossary", ["Table lineage with column mapping; view of a data product's complete feeding chain.",
                              "Glossary with definitions, linked catalog objects, URLs and file attachments."]),
    ("Marketplace and workflows", ["Access requests for data products, decided by admins, with notification.",
                                   "Design of new data products across three phases with return, withdrawal, file attachments and the status overview “Discover Data Products”.",
                                   "Personal dashboard with everything awaiting an action; in-app inbox and optional e-mail in the recipient's language."]),
    ("Collaboration", ["Discussion per table, questions to steward and owner with notification, star ratings, usage statistics."]),
    ("Imports and exports", ["CSV import and export (one row per attribute, also for hundreds of thousands of rows as a background job).",
                             "dbt projects (manifest.json, catalog.json) and ODCS data contracts; source systems via the inspector and native connectors.",
                             "Export as Open Knowledge Format (Markdown bundle for people and AI); full dump and restore."]),
    ("Unity Catalog", ["Import of catalogs including lineage and governance tags; scheduled synchronisation with a drift report or automatic apply.",
                       "Write-back of descriptions, tags and properties: every user sees a preview and writes back only their own changes."]),
    ("AI agents", ["MCP server with the same rules as the UI; authentication by agent key, OAuth 2.1 (as the person) or platform identity; every agent change in the audit trail."]),
    ("Operations", ["Daily backups with restore drill, stored locally, in S3, Azure Blob or a Unity Catalog volume.",
                    "Health check <code>/healthz</code>, list of background jobs, tasks via API for external schedulers, graceful shutdown."]),
]
for t, items in feat:
    st += H2(t)
    st += bullets(items)

st += H1("5 · Data product workflow")
st.append(workflow_diagram())
st.append(Spacer(1, 6))
st.append(P("A design passes through the phases in order; every role sees its open steps on the personal dashboard. Selected "
            "source tables receive the Data Product, Project and Use Case tags as soon as the design is submitted; on completion the "
            "gold schema is tagged. BPMN models of the processes are available under <code>/docs</code> of the application."))

st += H1("6 · Security")
st += table([["Area", "Implementation"],
             ["Sign-in", "passwords hashed with scrypt; TOTP two-factor authentication; slow-down after failed attempts and lock-out after ten; Entra ID (OIDC) with enforceable SSO and break-glass accounts; proxy sign-in for Databricks Apps"],
             ["Sessions and tokens", "session, invitation and reset tokens stored only as SHA-256 hashes; a password change ends other sessions"],
             ["Web security", "CSRF protection (session-bound token, origin check), Content-Security-Policy, X-Frame-Options, nosniff, HSTS behind HTTPS"],
             ["Secrets", "stored Databricks and Entra secrets encrypted with AES-256-GCM (<code>SECRETS_KEY</code>)"],
             ["Outbound connections", "SSRF protection: connectors reach no private addresses, Databricks only allowed workspace hosts"],
             ["MCP", "schema validation of every tool call, rate limits per credential, write access only for admins and stewards, no user management via MCP"],
             ["Traceability", "field-level audit trail for people and agents; excluded from search engines"]],
            [0.22, 0.78])

st += H1("7 · Deployment options")
st += table([["", "Ubuntu server", "Databricks App"],
             ["Web server", "nginx with Let's Encrypt", "platform"],
             ["Database", "MariaDB or PostgreSQL", "Lakebase"],
             ["Sign-in", "password + 2FA, Entra ID", "Databricks identity"],
             ["Source systems", "inspector + native connectors", "native connectors, Lakehouse Federation"],
             ["Backups", "local, S3 or Azure", "Unity Catalog volume"],
             ["Scheduler", "in the server", "Databricks job"],
             ["Guide", "Deployment Guide · Ubuntu", "Deployment Guide · Databricks App"]],
            [0.2, 0.4, 0.4])

build(OUT, f"Alassio Data Catalog – Architecture and Features v{V}", "Architecture and features", st,
      f"Alassio Data Catalog v{V} · Architecture and Features")
print("ok", OUT)
