/* /admin/backups — backup settings, on-demand backups, restore drills, restore and download (admins) */
import { Router } from "express";
import { ah, requireRole } from "../auth.js";
import { DRIVER } from "../db.js";
import { backupSettings, saveBackupSettings, listBackups, getBackup, runBackup, verifyBackup, deleteBackup, backupLocal, backupStream, backupExists, mysqldumpAvailable, sqlDumpTool, BACKUP_DIR, storageInfo } from "../backup.js";
import { newJob, publicJob } from "../jobs.js";
import { runRestore } from "../dump.js";

export function backupRoutes() {
  const r = Router();
  r.get("/admin/backups", requireRole("admin"), ah(async (req, res) => {
    res.json({ settings: await backupSettings(), backups: await listBackups(), dir: BACKUP_DIR, storage: storageInfo(), mysqldump: mysqldumpAvailable(), sqlTool: sqlDumpTool(), driver: DRIVER });
  }));
  r.put("/admin/backups/settings", requireRole("admin"), ah(async (req, res) => {
    res.json({ settings: await saveBackupSettings(req.body || {}, req.user) });
  }));
  r.post("/admin/backups", requireRole("admin"), ah(async (req, res) => {
    const b = await runBackup(req.user, "manual");
    res.json({ backup: b });
  }));
  r.post("/admin/backups/:id/verify", requireRole("admin"), ah(async (req, res) => {
    res.json({ backup: await verifyBackup(req.params.id, req.user) });
  }));
  /* restore from a backup file on the server: the normal restore job, without an upload */
  r.post("/admin/backups/:id/restore", requireRole("admin"), ah(async (req, res) => {
    const b = await getBackup(req.params.id);
    if (!b) return res.status(404).json({ error: "Unknown backup" });
    if (!(await backupExists(b))) return res.status(410).json({ error: "The backup file no longer exists in the backup storage" });
    const local = await backupLocal(b);   /* local storage: the file itself (kept); remote: a temp download (removed after the restore) */
    const job = newJob("dump", req.user, b.fileName, { tmpPath: local.path, keepFile: storageInfo().provider === "local", bytesTotal: b.size, bytesRead: b.size });
    runRestore(job);
    res.json({ job: publicJob(job) });
  }));
  r.get("/admin/backups/:id/download", requireRole("admin"), ah(async (req, res) => {
    const b = await getBackup(req.params.id);
    if (!b) return res.status(404).json({ error: "Unknown backup" });
    const sql = req.query.sql === "1" && b.sqlFile;
    if (!(await backupExists(b, !!sql))) return res.status(410).json({ error: "The backup file no longer exists in the backup storage" });
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename=${sql ? b.sqlFile : b.fileName}`);
    (await backupStream(b, !!sql)).pipe(res);
  }));
  r.delete("/admin/backups/:id", requireRole("admin"), ah(async (req, res) => {
    res.json({ ok: await deleteBackup(req.params.id) });
  }));
  return r;
}
