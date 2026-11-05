import sys
from doclib import *

V = sys.argv[1]
OUT = sys.argv[2]
st = []
st += cover("Deployment Guide · Databricks App",
            f"Running as a Databricks App with Lakebase · Version {V}",
            ["This guide describes how to run the Alassio Data Catalog as a Databricks App. It is the same code as on your own "
             "Ubuntu server – the Databricks edition is configuration only: the <code>app.yaml</code> file, Lakebase (PostgreSQL) "
             "as storage, sign-in through the platform, backups in a Unity Catalog volume and a Databricks job for scheduled tasks.",
             "Allow about 60 minutes, part of it for permissions in the workspace."],
            [[P("<b>Platform</b>", "cell"), P("Databricks Apps (the configuration targets Azure Databricks; AWS and GCP work the same way)", "cell")],
             [P("<b>Runtime</b>", "cell"), P("Databricks Apps environment with Node.js 22.16 (the app needs at least 22.12), default size 2 vCPU / 6 GB", "cell")],
             [P("<b>Storage</b>", "cell"), P("Lakebase (Autoscaling project or an existing Provisioned instance) · Unity Catalog volume for backups", "cell")],
             [P("<b>Result</b>", "cell"), P("https://&lt;app-url&gt;/ with Databricks sign-in, MCP endpoint /mcp for AI agents, hourly background tasks", "cell")]])
st += box("The Databricks edition is covered by automated tests (PostgreSQL, proxy sign-in, running without the inspector, "
          "task token, both Lakebase credential flows) but has not yet been run in a real workspace. "
          "Points to check on the first deployment are marked <b>[verify]</b> in the text.", "warn")

st += H1("Overview")
st += table([["Building block", "On an Ubuntu server", "As a Databricks App"],
             ["Web server / TLS", "nginx, Let's Encrypt", "platform (app URL with HTTPS)"],
             ["Sign-in", "password + 2FA, optionally Entra ID", "Databricks sign-in; the app reads the forwarded identity (<code>AUTH_MODE=header</code>)"],
             ["Roles", "in user management", "first admins via <code>AUTH_BOOTSTRAP_ADMINS</code>, otherwise group → role mapping from Databricks groups"],
             ["Database", "MariaDB or PostgreSQL", "Lakebase (PostgreSQL), password = OAuth token of the app's service principal"],
             ["Source systems", "Python inspector + native connectors", "native connectors only; databases via Lakehouse Federation and the Unity Catalog import"],
             ["Backups", "local directory", "Unity Catalog volume (<code>BACKUP_STORAGE=databricks</code>)"],
             ["Scheduled tasks", "built-in scheduler", "a Databricks job calls the task endpoints hourly (<code>SCHEDULER=external</code>)"],
             ["AI agents (MCP)", "agent keys, OAuth, MCP_TOKEN", "clients sign in to Databricks and act as the respective user"]],
            [0.22, 0.33, 0.45])

st += H1("Step 1 · Prerequisites in the workspace")
st += table([["What", "Why"],
             ["Lakebase database: an Autoscaling project with a branch, a compute endpoint and a database (today's default) – or an existing Provisioned instance", "catalog storage; the database attached as an app resource provides <code>PGHOST</code>, <code>PGPORT</code>, <code>PGUSER</code>, <code>PGDATABASE</code>, <code>PGSSLMODE</code>"],
             ["Unity Catalog volume, e.g. <code>/Volumes/main/alassio/backups</code>", "storage for the daily backups"],
             ["Secret scope with the key <code>tasks-token</code> (and <code>smtp-pass</code> if mail is used)", "token for the background tasks, SMTP password"],
             ["Optional: Lakehouse Federation connections (SQL Server, Oracle, Snowflake, PostgreSQL …)", "replaces the Python inspector: foreign databases appear as foreign catalogs and are loaded with the Unity Catalog import"],
             ["Databricks CLI (current version) on your workstation, signed in to the workspace", "creating secrets, uploading and deploying"]],
            [0.52, 0.48])
st += code("""openssl rand -base64 32
databricks secrets create-scope cortex
databricks secrets put-secret cortex tasks-token --string-value <token-from-openssl>""")
st.append(P("The scope name <code>cortex</code> is the default the job script expects (for another name use the job parameter <code>SECRET_SCOPE</code>)."))

st += H1("Step 2 · Create the app and attach resources")
st.append(P("In the workspace UI under <b>Compute › Apps</b>, create a new app of type “Custom”, e.g. named "
            "<code>alassio-catalog</code>, or use the CLI:"))
st += code("""databricks apps create alassio-catalog""")
st.append(P("Then attach the following in the app settings under <b>Resources</b>:"))
st += table([["Resource", "Setting", "Effect"],
             ["Database (Lakebase)", "the database from step 1, permission “Can connect and create”", "creates a PostgreSQL role for the app's service principal; the app creates its tables on first start"],
             ["Secret", "scope <code>cortex</code>, key <code>tasks-token</code>, resource key <code>tasks-token</code>", "read in <code>app.yaml</code> via <code>valueFrom: tasks-token</code> as <code>TASKS_TOKEN</code>"],
             ["Volume", "the backup volume, write access", "target of <code>DATABRICKS_VOLUME_PATH</code>"]],
            [0.2, 0.38, 0.42])
st.append(P("Under <b>User authorization</b> enable the scope <code>iam.current-user:read</code>. The app uses it to read the "
            "Databricks groups of the signed-in person for the group → role mapping <b>[verify]</b>. Also note the app URL "
            "(e.g. <code>https://alassio-catalog-1234567890.1.azure.databricksapps.com</code>) – you need it in step 3."))

st += H1("Step 3 · Get the code and adapt app.yaml")
st += code("""git clone https://github.com/MevPR/Alassio-Data-Catalog.git
cd Alassio-Data-Catalog
cp deploy/databricks/app.yaml app.yaml
vim app.yaml""")
st.append(P("Without access to the repository, unzip <code>datahub-catalog-deploy.zip</code> instead and change into the <code>datahub-catalog</code> directory. Adapt in <code>app.yaml</code>:"))
st += table([["Variable", "Value"],
             ["<code>LAKEBASE_ENDPOINT</code>", "resource name of the compute endpoint: <code>projects/&lt;id&gt;/branches/&lt;id&gt;/endpoints/&lt;id&gt;</code> (Lakebase project › branch › Computes › “Copy resource name”). For a Provisioned instance use <code>LAKEBASE_INSTANCE</code> with the instance name instead"],
             ["<code>AUTH_BOOTSTRAP_ADMINS</code>", "e-mail address(es) of the first administrators, comma-separated – the first sign-in of these accounts creates them as admins"],
             ["<code>AUTH_HEADER_DEFAULT_ROLES</code>", "role of all other new users (default <code>guest</code>, read-only)"],
             ["<code>APP_URL</code>", "the app URL from step 2 (links in notifications)"],
             ["<code>DATABRICKS_VOLUME_PATH</code>", "path of the backup volume, e.g. <code>/Volumes/main/alassio/backups</code>"],
             ["<code>DATABRICKS_ALLOWED_HOSTS</code>", "host name of your own workspace (e.g. <code>adb-1234567890.1.azuredatabricks.net</code>) for the Unity Catalog import"],
             ["<code>SMTP_*</code>", "optional; without a reachable mail server notifications stay in the app's inbox <b>[verify]</b>"]],
            [0.32, 0.68])
st.append(P("Fixed – do not change: <code>DB_DRIVER=postgres</code>, <code>DB_PASSWORD_PROVIDER=databricks</code>, "
            "<code>DB_SSL=1</code>, <code>AUTH_MODE=header</code>, <code>AUTH_GROUPS_FROM=databricks</code>, <code>COOKIE_SECURE=1</code>, "
            "<code>INSPECTOR_URL=\"\"</code>, <code>DATA_DIR=/tmp/cortex</code>, <code>BACKUP_STORAGE=databricks</code>, <code>SCHEDULER=external</code>. "
            "The platform sets <code>DATABRICKS_HOST</code>, <code>DATABRICKS_CLIENT_ID</code>, <code>DATABRICKS_CLIENT_SECRET</code> and the port itself."))

st += H1("Step 4 · Upload and deploy")
st.append(P("<b>Option A – from a workspace folder:</b>"))
st += code("""databricks sync . /Workspace/Users/<your-e-mail>/alassio-catalog
databricks apps deploy alassio-catalog --source-code-path /Workspace/Users/<your-e-mail>/alassio-catalog""")
st.append(P("<code>databricks sync</code> honours <code>.gitignore</code>; <code>node_modules</code>, <code>dist</code> and Python virtual environments are not uploaded. "
            "During deployment the platform runs <code>npm install</code> and <code>npm run build</code> and then starts the command from <code>app.yaml</code> "
            "(<code>node server.js</code>). The app automatically listens on the port Databricks assigns."))
st.append(P("<b>Option B – directly from Git:</b> if the app is connected to the repository (private GitHub repository with a Git credential for the app's service principal), "
            "deploy a specific release by tag:"))
st += code(f"""databricks apps deploy alassio-catalog --git-tag v{V}""")
st += box("With option B, <code>app.yaml</code> must be in the repository root. Because it contains workspace-specific values, "
          "use a dedicated branch for it or option A.")

st += H1("Step 5 · Check and first sign-in")
st += bullets([f"Open <code>https://&lt;app-url&gt;/healthz</code> in the browser: expected <code>\"status\":\"ready\"</code> and <code>\"version\":\"{V}\"</code>.",
               "Open the app's start page with an account from <code>AUTH_BOOTSTRAP_ADMINS</code> – there is no password screen, the platform signs you in; the account is created as admin.",
               "Under Admin › Users › “Group → role mapping”, map Databricks groups to roles (e.g. <code>data-stewards</code> → Data Steward). New users without a match get <code>AUTH_HEADER_DEFAULT_ROLES</code>.",
               "If start-up fails, check the app's logs (the app's <b>Logs</b> tab). “Lakebase credentials need …” means the database resource or <code>LAKEBASE_ENDPOINT</code> is missing."])

st += H1("Step 6 · Background tasks as a Databricks job")
st.append(P("Without a long-running in-process scheduler, a job takes over the hourly tasks: Unity Catalog synchronisation, "
            "stewardship reminders, backup and purging old usage data."))
st += table([["Setting", "Value"],
             ["Task type", "Python script, source workspace, path <code>…/alassio-catalog/deploy/databricks/run_tasks.py</code>"],
             ["Compute", "serverless"],
             ["Parameters", "<code>APP_URL</code> = app URL; optional <code>SECRET_SCOPE</code> (default <code>cortex</code>) and <code>TASKS</code> (default: <code>uc-sync,stewardship-reminders,backup,usage-purge</code>)"],
             ["Schedule", "hourly"],
             ["Permissions", "the identity the job runs as needs “Can use” on the app and read access to the secret scope"]],
            [0.22, 0.78])
st.append(P("The script sends the token in the <code>X-Tasks-Token</code> header, because the <code>Authorization</code> header is taken by the platform sign-in. "
            "The backup writes the gzip'd catalog dump to the volume; the SQL dump is skipped because the app runtime has no <code>pg_dump</code>."))

st += H1("Step 7 · Connect Unity Catalog")
st += bullets(["<b>Import</b> (Import › Unity Catalog): choose a sync profile or “App identity (Databricks Apps)” for a one-off import. The app's service principal needs <code>USE CATALOG</code>, <code>USE SCHEMA</code> and <code>SELECT</code> on the catalogs to import, and for governance tags also “Can use” on a SQL warehouse.",
               "<b>Scheduled synchronisation</b> (Admin › Backups &amp; jobs › Scheduled synchronisation): a profile with catalog, target data hub, schedule and mode “Report only” or “Apply”; run by the job from step 6.",
               "<b>Write-back</b> (Export › Write back to UC): every user previews and writes back their own changes; admins additionally changes without a recorded author. The service principal needs <code>MODIFY</code> (or ownership) on the target objects and “Can use” on the profile's SQL warehouse; without a warehouse only comments and catalog properties are written.",
               "<b>Other sources</b>: OData/SAP SuccessFactors, Kafka Schema Registry, Power BI, Informatica, dbt, ODCS and CSV work as on the server; outbound connections follow the workspace's network policy <b>[verify]</b>."])

st += H1("Step 8 · AI agents (MCP)")
st.append(P("Agents connect to <code>https://&lt;app-url&gt;/mcp</code> and sign in to Databricks via OAuth. The app acts as the "
            "forwarded person: admins and data stewards get write tools, everyone else read tools only. "
            "<code>MCP_TOKEN</code> and agent keys are not used in this edition."))

st += H1("Updates")
st.append(P("Get the new version (<code>git pull</code> or unzip the new package), keep your own <code>app.yaml</code>, then upload and deploy again:"))
st += code("""git pull
databricks sync . /Workspace/Users/<your-e-mail>/alassio-catalog
databricks apps deploy alassio-catalog --source-code-path /Workspace/Users/<your-e-mail>/alassio-catalog""")
st.append(P("The app applies schema changes itself at start-up. Earlier deployments are listed with <code>databricks apps list-deployments alassio-catalog</code>."))

st += H1("Limits of this edition")
st += bullets(["No password sign-in, no own two-factor authentication, no invitations and no own OAuth server – the platform handles this.",
               "No Python inspector: DuckDB files, data lake files and direct SQL/JDBC connections are not available; databases come through Lakehouse Federation.",
               "No persistent file system: <code>/tmp/cortex</code> holds upload temp files only.",
               "Mail only if the workspace allows outbound SMTP connections <b>[verify]</b>."])

st += H1("To verify on the first deployment")
st += table([["Point", "How to tell", "Fallback"],
             ["Groups via <code>iam.current-user:read</code>", "the group → role mapping applies on first sign-in", "assign roles manually in Admin › Users"],
             ["Lakebase token renewal", "the app runs longer than an hour without database errors", "check the logs; tokens are renewed 5 minutes before expiry"],
             ["Outbound connections (APIs, SMTP)", "source import or mail works", "adjust the workspace network policy"],
             ["Job access to the app", "the job run shows HTTP 200 for all tasks", "grant “Can use” on the app to the job identity"]],
            [0.3, 0.38, 0.32])

build(OUT, f"Alassio Data Catalog – Deployment Guide Databricks App v{V}", "Running as a Databricks App", st,
      f"Alassio Data Catalog v{V} · Deployment Guide Databricks App")
print("ok", OUT)
