import sys
from doclib import *

V = sys.argv[1]
OUT = sys.argv[2]
st = []
st += cover("Deployment Guide · Ubuntu",
            f"Installation on your own Ubuntu server · Version {V}",
            ["This guide takes a freshly installed Ubuntu server to a running installation of the Alassio Data Catalog: "
             "database, Node.js application server with the MCP server for AI agents behind nginx, the optional Python "
             "inspector for reading source systems, HTTPS with Let's Encrypt and the first administrator account. "
             "Allow 45 to 60 minutes.",
             "Every command is on its own line and can be run in order. Replace placeholders in angle brackets "
             "(such as <code>&lt;password&gt;</code>) with your values. Files are edited with <code>vim</code>."],
            [[P("<b>Target system</b>", "cell"), P("Ubuntu 22.04 LTS or later, x86_64 or ARM64 (e.g. Orange Pi), 2 CPU cores, 4 GB RAM, 10 GB free disk", "cell")],
             [P("<b>Software</b>", "cell"), P("Node.js 24 LTS (at least 22.12), MariaDB 10.6+ or PostgreSQL 14+, nginx, Python 3.10+ (inspector only)", "cell")],
             [P("<b>Package</b>", "cell"), P(f"<code>datahub-catalog-deploy.zip</code> (v{V}) or a clone of the Git repository", "cell")],
             [P("<b>Result</b>", "cell"), P("https://&lt;your-host&gt;/ with sign-in, catalog, marketplace, MCP endpoint /mcp and health check /healthz", "cell")]])

st += H1("Overview: what runs where")
st += table([["Component", "Purpose", "Location / port"],
             ["nginx", "serves the UI, forwards API, MCP, OAuth and health check to the Node server, TLS", "/var/www/datahub-catalog · :80 / :443"],
             ["Application server (Node.js)", "sign-in, permissions, catalog storage, workflows, imports/exports, Unity Catalog sync, MCP server, scheduler", "/opt/datahub-catalog · 127.0.0.1:3000 · systemd: datahub-catalog-proxy"],
             ["MariaDB (or PostgreSQL)", "users, sessions, catalog (tables cat_*), audit trail, jobs, settings", "127.0.0.1:3306 (5432)"],
             ["Source inspector (Python, optional)", "reads metadata from DuckDB, data lake files, SQL databases (SQLAlchemy) and JDBC sources", "/opt/datahub-catalog/inspector · 127.0.0.1:3001 · systemd: datahub-catalog-inspector"],
             ["Data directory", "upload temp files, local backups", "/var/lib/datahub-catalog"]],
            [0.24, 0.46, 0.30])
st += box("Only nginx is reachable from outside. The application server, inspector and database bind to 127.0.0.1 "
          "and must not be opened in the firewall.")

st += H1("Before you start")
st += bullets(["Root or sudo access via SSH.",
               "The release package <code>datahub-catalog-deploy.zip</code> in the server's home directory (e.g. via <code>scp</code>).",
               "A DNS name for HTTPS, e.g. <code>catalog.example.com</code>, pointing to the server.",
               "Optional: SMTP credentials for invitations and notifications, a Databricks workspace for the Unity Catalog "
               "import, credentials of the source systems for the inspector."])

st += H1("Step 1 · Base system and Node.js 24")
st += code("""sudo apt update
sudo apt upgrade -y
sudo apt install -y nginx unzip rsync curl ca-certificates gnupg python3-venv
curl -fsSL https://deb.nodesource.com/setup_24.x -o nodesource_setup.sh
sudo bash nodesource_setup.sh
sudo apt install -y nodejs
node -v""")
st.append(P("Expected: <code>v24.x</code>. The application requires at least Node.js 22.12; older versions do not start."))

st += H1("Step 2 · Database")
st += H2("Option A: MariaDB (default)")
st += code("""sudo apt install -y mariadb-server
sudo systemctl enable --now mariadb
sudo mysql_secure_installation
sudo mysql -e "CREATE DATABASE datahub_catalog CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER 'datahub'@'localhost' IDENTIFIED BY '<db-password>';"
sudo mysql -e "GRANT ALL PRIVILEGES ON datahub_catalog.* TO 'datahub'@'localhost';"
sudo mysql -e "FLUSH PRIVILEGES;\"""")
st += box("The application creates all tables itself on first start. The MariaDB server also installs "
          "<code>mysqldump</code>, which the backup feature uses for an additional full SQL dump.")
st += H2("Option B: PostgreSQL")
st += code("""sudo apt install -y postgresql
sudo -u postgres psql -c "CREATE USER datahub WITH PASSWORD '<db-password>';"
sudo -u postgres psql -c "CREATE DATABASE datahub_catalog OWNER datahub;"
sudo -u postgres psql -d datahub_catalog -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;\"""")
st.append(P("In step 7 also set <code>DB_DRIVER=postgres</code> and <code>DB_PORT=5432</code>. "
            "The <code>pg_trgm</code> extension speeds up substring search; without it search still works, only slower."))

st += H1("Step 3 · Unpack the package and build the UI")
st += code("""mkdir -p ~/datahub-catalog
cd ~ && rm -rf datahub-catalog-release && mkdir datahub-catalog-release && cd datahub-catalog-release
unzip -q ~/datahub-catalog-deploy.zip
rsync -a --delete --exclude .git --exclude node_modules --exclude dist --exclude venv --exclude inspector/venv ~/datahub-catalog-release/datahub-catalog/ ~/datahub-catalog/
cd ~/datahub-catalog
grep '"version"' package.json
npm install
npm run build""")
st.append(P(f"<code>grep</code> must show <code>\"version\": \"{V}\"</code>. <code>npm run build</code> creates the <code>dist</code> directory with the UI. "
            "If you work with the Git repository, clone it to <code>~/datahub-catalog</code> instead and skip unzip and rsync."))

st += H1("Step 4 · Copy the UI to the web root")
st += code("""sudo mkdir -p /var/www/datahub-catalog
sudo cp -r dist/* /var/www/datahub-catalog/""")

st += H1("Step 5 · Install the application server")
st += code("""sudo mkdir -p /opt/datahub-catalog
sudo cp server.js mcp.js okf.js catalog-diff.js csv-import.js csv-export.js permissions.js uc-writeback.js package.json package-lock.json /opt/datahub-catalog/
sudo cp -r server src mcp /opt/datahub-catalog/
cd /opt/datahub-catalog && sudo npm install --omit=dev
cd ~/datahub-catalog""")
st += box("The server needs all of these files and the three directories <code>server</code>, <code>src</code> and "
          "<code>mcp</code>. If one is missing, start-up fails with “Cannot find module …”.")

st += H1("Step 6 · Install the source inspector (optional)")
st.append(P("The inspector is only needed to read DuckDB files, data lake files (Parquet, CSV, JSON, Delta, Iceberg), "
            "SQL databases and JDBC sources. OData/SAP SuccessFactors, Kafka Schema Registry, Power BI, Informatica, dbt and "
            "ODCS run directly in the Node server. Without the inspector, skip this step and set <code>INSPECTOR_URL=</code> "
            "(empty) in step 7 – the affected source types then disappear from the UI."))
st += code("""sudo mkdir -p /opt/datahub-catalog/inspector /opt/datahub-catalog/jdbc-drivers
sudo cp inspector/app.py inspector/requirements.txt inspector/requirements.lock inspector/requirements-optional.txt /opt/datahub-catalog/inspector/
sudo cp -r inspector/connectors /opt/datahub-catalog/inspector/
sudo python3 -m venv /opt/datahub-catalog/inspector/venv
sudo /opt/datahub-catalog/inspector/venv/bin/pip install -r /opt/datahub-catalog/inspector/requirements.lock
sudo cp deploy/datahub-catalog-inspector.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now datahub-catalog-inspector
curl -s http://127.0.0.1:3001/health""")
st.append(P("Expected: <code>{\"ok\":true}</code>. Install additional drivers into the same environment as needed:"))
st += table([["Source", "Installation (in the inspector venv)"],
             ["MySQL/MariaDB, PostgreSQL, DuckDB, data lake files", "included (DuckDB loads httpfs/azure/delta/iceberg on first use; needs internet access once)"],
             ["Microsoft SQL Server / Azure SQL", "<code>sudo /opt/datahub-catalog/inspector/venv/bin/pip install pymssql</code>"],
             ["Oracle (thin mode, no Oracle client)", "<code>… pip install oracledb</code>"],
             ["Snowflake", "<code>… pip install snowflake-sqlalchemy</code>"],
             ["SAP HANA", "<code>… pip install sqlalchemy-hana hdbcli</code>"],
             ["IBM DB2 (x86_64 only)", "<code>… pip install ibm-db-sa</code>"],
             ["Generic JDBC (any database with a JDBC driver)", "<code>sudo apt install -y default-jre-headless</code>, then <code>… pip install JPype1 jaydebeapi</code>; copy the driver .jar to <code>/opt/datahub-catalog/jdbc-drivers</code>"]],
            [0.36, 0.64])
st += box("ARM64 (e.g. Orange Pi): <code>ibm_db</code> does not build there. For DB2 use the JDBC route with IBM's pure Java "
          "driver (<code>com.ibm.db2:jcc</code> from Maven Central, saved as <code>db2jcc4.jar</code>; class "
          "<code>com.ibm.db2.jcc.DB2Driver</code>, URL <code>jdbc:db2://host:50000/DB</code>).")

st += H1("Step 7 · Configure and start the application server")
st += code("""openssl rand -base64 48
sudo cp deploy/datahub-catalog-proxy.service /etc/systemd/system/
sudo vim /etc/systemd/system/datahub-catalog-proxy.service""")
st.append(P("The first command generates a key for <code>SECRETS_KEY</code>. In the unit file set at least:"))
st += code("""Environment=APP_URL=https://catalog.example.com
Environment=COOKIE_SECURE=0
Environment=SECRETS_KEY=<key-from-openssl>
Environment=DB_HOST=127.0.0.1
Environment=DB_PORT=3306
Environment=DB_USER=datahub
Environment=DB_PASSWORD=<db-password>
Environment=DB_NAME=datahub_catalog""")
st += table([["Variable", "Meaning"],
             ["<code>APP_URL</code>", "public address; used for links in invitations and e-mails and as the OAuth issuer for MCP clients"],
             ["<code>COOKIE_SECURE</code>", "set to 1 only after step 9 (HTTPS), otherwise sign-in over http fails"],
             ["<code>SECRETS_KEY</code>", "encrypts stored Databricks and Entra secrets (AES-256-GCM); set it once and keep it – without it stored secrets can no longer be read"],
             ["<code>DB_DRIVER</code>", "PostgreSQL only: <code>postgres</code> (then <code>DB_PORT=5432</code>)"],
             ["<code>INSPECTOR_URL</code>", "without the inspector set it explicitly to empty: <code>Environment=INSPECTOR_URL=</code>; if unset, http://127.0.0.1:3001 applies"],
             ["<code>SMTP_HOST/PORT/USER/PASS/FROM</code>", "optional: invitations, password links and notifications by e-mail; without SMTP the UI shows links to copy"],
             ["<code>MCP_TOKEN</code>", "optional: static bearer token for AI agents (<code>openssl rand -base64 32</code>); alternatively agent keys or OAuth (see step 12)"],
             ["<code>ADMIN_EMAIL/ADMIN_PASSWORD</code>", "optional: creates the first administrator at start-up while no users exist"],
             ["<code>BACKUP_STORAGE</code>", "<code>local</code> (default, <code>/var/lib/datahub-catalog/backups</code>), <code>s3</code>, <code>azure</code> or <code>databricks</code>"]],
            [0.30, 0.70])
st.append(P("Further, rarely needed variables (rate limits, connector security, external scheduler, proxy sign-in) are documented as comments in the unit file. Then start:"))
st += code("""sudo systemctl daemon-reload
sudo systemctl enable --now datahub-catalog-proxy
sudo journalctl -u datahub-catalog-proxy -n 20 --no-pager""")
st.append(P(f"Expected line: <code>Alassio Data Catalog v{V} listening on http://127.0.0.1:3000 (mariadb: datahub_catalog, scheduler internal)</code>. "
            "“Access denied” or “ECONNREFUSED” means the database credentials or host do not match step 2."))

st += H1("Step 8 · Set up nginx")
st += code("""sudo cp deploy/nginx-datahub-catalog.conf /etc/nginx/sites-available/datahub-catalog
sudo vim /etc/nginx/sites-available/datahub-catalog
sudo ln -sf /etc/nginx/sites-available/datahub-catalog /etc/nginx/sites-enabled/datahub-catalog
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx""")
st.append(P("In the file, replace <code>server_name _;</code> with your host name. The template already contains everything needed:"))
st += bullets(["Forwarding of <code>/auth</code>, <code>/api</code>, <code>/admin</code>, <code>/mcp</code>, <code>/oauth</code>, <code>/.well-known</code> and <code>/healthz</code> to the Node server.",
               "A separate block with a 512 MB upload limit and a 10-minute timeout for CSV import, exports, dump/restore and source inspection. It must stay above the general block.",
               "Security headers (Content-Security-Policy, X-Frame-Options, nosniff, Referrer and Permissions Policy) and exclusion from search engines."])

st += H1("Step 9 · HTTPS with Let's Encrypt")
st += code("""sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d catalog.example.com
sudo sed -i 's/^Environment=COOKIE_SECURE=0/Environment=COOKIE_SECURE=1/' /etc/systemd/system/datahub-catalog-proxy.service
sudo systemctl daemon-reload
sudo systemctl restart datahub-catalog-proxy""")
st.append(P("Once HTTPS works for every host name of the server, also enable the prepared "
            "<code>Strict-Transport-Security</code> line in the nginx file and reload nginx."))

st += H1("Step 10 · Firewall (if ufw is used)")
st += code("""sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable""")

st += H1("Step 11 · First sign-in and initial setup")
st.append(P("Open the address in a browser. While no users exist, “Create the first administrator” appears "
            "(name, e-mail, password with at least 8 characters). Afterwards you can set up two-factor authentication with a QR code "
            "or do it later via the key icon. Recommended first steps:"))
st += bullets(["<b>Invite users</b> (Admin › Users) and assign roles: Data Steward, Project Manager, Business Analyst, Data Ingestion, Development &amp; Test / Sign-off, Guest.",
               "<b>Create the structure</b> or import it: data hub types (pre-set: Finance, HR, Sales and SOURCE), data hubs, databases – via Import › Unity Catalog, Import › CSV or Import › Load source.",
               "<b>Maintain responsibilities</b>: BPO per data hub, owner and steward per data domain (Governance Overview).",
               "<b>Check backups</b>: Admin › Backups &amp; jobs – time, retention, then “Back up now” and “Verify” once.",
               "Optionally configure <b>Entra ID</b> (Microsoft sign-in) and the group → role mapping under Admin › Users."])

st += H1("Step 12 · Connect AI agents (optional, MCP)")
st.append(P("The catalog is a Model Context Protocol server at <code>https://&lt;host&gt;/mcp</code>. There are three ways to authenticate:"))
st += bullets(["<b>Agent key</b> (recommended): Admin › Users › Invite Agent – name, read or write access; the key is shown once.",
               "<b>OAuth 2.1</b>: clients such as Claude sign in as the respective user (discovery, dynamic registration, PKCE); write access only for admins and data stewards.",
               "<b>Static token</b>: <code>MCP_TOKEN</code> in the unit file."])
st += code("""curl -s https://catalog.example.com/mcp -H "Authorization: Bearer <key>" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'""")
st.append(P("The response lists the tools (read, search, lineage, audit, catalog maintenance, glossary, stewardship, OKF export). Clients that only speak stdio connect via <code>npx mcp-remote https://catalog.example.com/mcp --header \"Authorization: Bearer &lt;key&gt;\"</code>."))

st += H1("Step 13 · Checklist")
st += code("""systemctl status datahub-catalog-proxy datahub-catalog-inspector --no-pager
curl -s http://127.0.0.1:3000/healthz
curl -s http://127.0.0.1:3001/health
sudo mysql datahub_catalog -e 'SHOW TABLES;'""")
st += bullets([f"Both services are “active (running)”; <code>/healthz</code> returns <code>{{\"ok\":true,\"status\":\"ready\",\"version\":\"{V}\"}}</code>.",
               "<code>SHOW TABLES</code> lists, among others, <code>users</code>, <code>sessions</code>, <code>audit</code>, <code>cat_hubs</code>, <code>cat_tables</code>, <code>cat_attributes</code>.",
               f"In the browser: the dashboard after sign-in; the help (i icon) shows version {V} (Ctrl+F5 if an older one appears).",
               "A change to a database survives a reload and appears in the audit trail."])

st += H1("Updating to a new version")
st.append(P("Every release ships as a complete package. Put the new <code>datahub-catalog-deploy.zip</code> into the home directory and run:"))
st += code("""cd ~ && rm -rf datahub-catalog-release && mkdir datahub-catalog-release && cd datahub-catalog-release
unzip -q ~/datahub-catalog-deploy.zip
rsync -a --delete --exclude .git --exclude node_modules --exclude dist --exclude venv --exclude inspector/venv ~/datahub-catalog-release/datahub-catalog/ ~/datahub-catalog/
cd ~/datahub-catalog
npm install
npm run build
sudo cp -r dist/* /var/www/datahub-catalog/
sudo cp server.js mcp.js okf.js catalog-diff.js csv-import.js csv-export.js permissions.js uc-writeback.js package.json package-lock.json /opt/datahub-catalog/
sudo cp -r server src mcp /opt/datahub-catalog/
sudo cp inspector/app.py inspector/requirements.txt inspector/requirements.lock /opt/datahub-catalog/inspector/
sudo cp -r inspector/connectors /opt/datahub-catalog/inspector/
cd /opt/datahub-catalog && sudo npm install --omit=dev
sudo systemctl restart datahub-catalog-inspector
sudo systemctl restart datahub-catalog-proxy
sleep 5
curl -s http://127.0.0.1:3000/healthz""")
st.append(P("The server applies database changes itself at start-up. Without the inspector, leave out the two <code>inspector</code> lines and its restart. "
            "If Python dependencies change, also run <code>sudo /opt/datahub-catalog/inspector/venv/bin/pip install -r /opt/datahub-catalog/inspector/requirements.lock</code>."))
st += box("Do not run <code>npm audit fix --force</code> on the server – it installs incompatible major versions. "
          "Security fixes to dependencies come with the next release.", "warn")

st += H1("Backup and restore")
st += bullets(["<b>Automatic</b>: Admin › Backups &amp; jobs writes a gzip'd catalog dump every day and – when <code>mysqldump</code> or <code>pg_dump</code> is available – an SQL dump of the whole database. Time and retention are configurable.",
               "<b>Verify</b> runs a restore drill (structure, referential integrity, record counts).",
               "<b>Restore</b> replays a backup through the normal restore job; downloads hand you the files.",
               "For backups off the server set <code>BACKUP_STORAGE=s3</code> (S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, optionally S3_ENDPOINT for MinIO) or <code>azure</code> (AZURE_CONTAINER_SAS_URL)."])

st += H1("Troubleshooting")
st += table([["Symptom", "Cause and fix"],
             ["Browser shows an old version", "package not re-extracted or browser cache: check the version in <code>package.json</code>, rebuild, Ctrl+F5"],
             ["502 Bad Gateway", "application server not running: <code>sudo journalctl -u datahub-catalog-proxy -n 50 --no-pager</code>"],
             ["“Cannot find module …”", "a file or directory is missing in /opt (step 5) or <code>npm install --omit=dev</code> was not run there"],
             ["Sign-in fails immediately, no cookie", "<code>COOKIE_SECURE=1</code> without HTTPS – set it to 1 only after step 9"],
             ["403 “csrf” on changes", "origin does not match the host: nginx must pass <code>proxy_set_header Host $host</code> (included in the template); then reload the page"],
             ["MCP returns HTML instead of JSON", "nginx block without <code>mcp</code> – use the template from <code>deploy/</code>"],
             ["“inspector service is not reachable”", "<code>systemctl status datahub-catalog-inspector</code>; the venv must be at <code>/opt/datahub-catalog/inspector/venv</code>"],
             ["Uploads of large files abort", "the nginx block for large transfers is missing or below the general block"],
             ["Two-factor device lost", "<code>sudo mysql datahub_catalog -e \"UPDATE users SET totp_enabled=0, totp_secret=NULL WHERE email='user@example.com';\"</code>"]],
            [0.32, 0.68])

build(OUT, f"Alassio Data Catalog – Deployment Guide Ubuntu v{V}", "Installation on Ubuntu", st,
      f"Alassio Data Catalog v{V} · Deployment Guide Ubuntu")
print("ok", OUT)
