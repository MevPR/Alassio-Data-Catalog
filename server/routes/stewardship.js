/* /api/stewardship/policy (read: signed in; write: admins) and the manual reminder run */
import { Router } from "express";
import { ah, requireAuth, requireRole } from "../auth.js";
import { stewardshipPolicy, saveStewardshipPolicy } from "../stewardship.js";
import { runTask } from "../tasks.js";
import { sysAudit } from "../audit.js";

export function stewardshipRoutes() {
  const r = Router();
  r.get("/api/stewardship/policy", requireAuth, ah(async (req, res) => res.json({ policy: await stewardshipPolicy() })));
  r.put("/admin/stewardship/policy", requireRole("admin"), ah(async (req, res) => {
    const policy = await saveStewardshipPolicy(req.body || {}, req.user);
    await sysAudit(req.user, "system", "updated", `stewardship policy: attest every ${policy.attestDays} d, remind every ${policy.remindEveryDays} d`);
    res.json({ policy });
  }));
  r.post("/admin/stewardship/remind", requireRole("admin"), ah(async (req, res) => {
    /* v1.74 (F-S3): through the task runner — shares its "running" guard with the scheduler (409 while a run is in progress) */
    const out = await runTask("stewardship-reminders", req.user, { force: req.body?.force === true });
    if (!out.ok) return res.status(500).json({ error: out.error });
    res.json(out.result);
  }));
  return r;
}
