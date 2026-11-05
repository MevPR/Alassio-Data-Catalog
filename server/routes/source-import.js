/* /api/source-import/* — generic source loading (admins only). The logic (modes, inspector health, forwarding, audit)
   lives in server/source-inspect.js since v1.73 (F-S7); this router only authenticates, calls and answers. */
import { Router } from "express";
import { ah, requireRole } from "../auth.js";
import { inspectCapabilities, inspectSource } from "../source-inspect.js";

export function sourceImportRoutes() {
  const r = Router();
  r.get("/api/source-import/capabilities", requireRole("admin"), ah(async (req, res) => {
    res.json(await inspectCapabilities({ force: req.query.refresh === "1" }));
  }));
  r.post("/api/source-import/inspect", requireRole("admin"), ah(async (req, res) => {
    const { status, body } = await inspectSource(req.body || {}, req.user);   /* refusals carry their status — ah() answers */
    res.status(status).json(body);
  }));
  return r;
}
