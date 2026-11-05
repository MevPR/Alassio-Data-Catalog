/* /admin/sync — scheduled Unity Catalog synchronisation profiles (admins).
   v1.77: /api/writeback — every signed-in user writes their own catalog changes back to Unity Catalog, after a preview
   (the profile's credentials stay on the server; changes by other users are reported, never written for them). */
import { Router } from "express";
import { ah, requireAuth, requireRole } from "../auth.js";
import { sysAudit } from "../audit.js";
import { runSync } from "../uc-sync.js";
import { fetchUnity } from "../unity-client.js";
import { syncProfiles, publicProfile, saveProfile, deleteProfile, dueProfiles } from "../sync-profiles.js";
import { SCHEDULER } from "../tasks.js";
import { runWriteBack } from "../uc-writeback-run.js";

export function syncRoutes() {
  const r = Router();
  r.get("/admin/sync/profiles", requireRole("admin"), ah(async (req, res) => {
    const profiles = await syncProfiles();
    res.json({ profiles: profiles.map(publicProfile), due: dueProfiles(profiles).map((p) => p.id), scheduler: SCHEDULER, appIdentity: !!(process.env.DATABRICKS_CLIENT_ID && process.env.DATABRICKS_CLIENT_SECRET) });
  }));
  r.put("/admin/sync/profiles", requireRole("admin"), ah(async (req, res) => {
    const p = await saveProfile(req.body || {}, req.user);
    await sysAudit(req.user, "settings", "updated", `sync profile ${p.name}`, [{ field: "catalog", from: null, to: p.catalog }, { field: "mode", from: null, to: p.mode }, { field: "schedule", from: null, to: p.schedule }]);
    res.json({ profile: publicProfile(p) });
  }));
  r.delete("/admin/sync/profiles/:id", requireRole("admin"), ah(async (req, res) => {
    const ok = await deleteProfile(req.params.id, req.user);
    if (ok) await sysAudit(req.user, "settings", "deleted", `sync profile ${req.params.id}`);
    res.json({ ok });
  }));
  /* connection test: counts schemas and tables without touching the catalog (fetchUnity failures carry status 502) */
  r.post("/admin/sync/profiles/:id/test", requireRole("admin"), ah(async (req, res) => {
    const p = (await syncProfiles()).find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: "Unknown sync profile" });
    const u = await fetchUnity({ ...p, lineage: false });
    res.json({ ok: true, schemas: u.schemasPayload.length, tables: u.schemasPayload.reduce((n, s) => n + (s.tables || []).length, 0), columns: u.schemasPayload.reduce((n, s) => n + (s.tables || []).reduce((m, t) => m + (t.columns || []).length, 0), 0) });
  }));
  /* v1.64: server-side write-back (preview with ?dryRun=1); v1.77: like every user-triggered run it writes the admin's
     own changes (plus the unattributed ones) — the automatic write-back after a sync run is the only "everything" run */
  r.post("/admin/sync/profiles/:id/writeback", requireRole("admin"), ah(async (req, res) => {
    res.json({ result: await runWriteBack(req.params.id, req.user, { dryRun: req.query.dryRun === "1" || !!req.body?.dryRun, scope: "mine" }) });
  }));
  /* v1.77: the user's own write-back — targets, preview, run */
  const target = (p) => ({ id: p.id, name: p.name, catalog: p.catalog, host: p.auth?.type === "app" ? "" : p.host, lastWriteBack: p.lastWriteBack ? { at: p.lastWriteBack.at, ok: p.lastWriteBack.ok, written: p.lastWriteBack.written } : null });
  r.get("/api/writeback/targets", requireAuth, ah(async (req, res) => {
    res.json({ targets: (await syncProfiles()).filter((p) => p.enabled !== false).map(target) });
  }));
  r.post("/api/writeback/:id/preview", requireAuth, ah(async (req, res) => {
    res.json({ result: await runWriteBack(req.params.id, req.user, { dryRun: true, scope: "mine" }) });
  }));
  r.post("/api/writeback/:id/run", requireAuth, ah(async (req, res) => {
    res.json({ result: await runWriteBack(req.params.id, req.user, { dryRun: false, scope: "mine" }) });
  }));
  r.post("/admin/sync/profiles/:id/run", requireRole("admin"), ah(async (req, res) => {
    res.json({ result: await runSync(req.params.id, req.user) });
  }));
  return r;
}
