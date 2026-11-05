"""Alassio Data Catalog — scheduled tasks from a Databricks Job (SCHEDULER=external).

Run hourly as a Python-script task (serverless compute). The app's platform sign-in consumes the Authorization
header, so the task token travels in X-Tasks-Token. Job parameters (or environment): APP_URL, SECRET_SCOPE
(default "cortex", key "tasks-token"), TASKS (comma-separated, default: all four).
"""
import os
import sys

import requests
from databricks.sdk import WorkspaceClient
from databricks.sdk.runtime import dbutils

APP_URL = (os.environ.get("APP_URL") or dbutils.widgets.get("APP_URL")).rstrip("/")
SCOPE = os.environ.get("SECRET_SCOPE") or "cortex"
TASKS = [t for t in (os.environ.get("TASKS") or "uc-sync,stewardship-reminders,backup,usage-purge").split(",") if t]

w = WorkspaceClient()
headers = {**w.config.authenticate(), "X-Tasks-Token": dbutils.secrets.get(SCOPE, "tasks-token")}

health = requests.get(f"{APP_URL}/healthz", headers=headers, timeout=60)
print("healthz", health.status_code, health.text[:200])

failed = []
for task in TASKS:
    r = requests.post(f"{APP_URL}/admin/tasks/{task}/run", headers=headers, json={}, timeout=900)
    print(task, r.status_code, r.text[:300])
    if r.status_code >= 400:
        failed.append(task)
if failed:
    sys.exit(f"tasks failed: {', '.join(failed)}")
