/* /admin/agents, /admin/users/:id/keys, /auth/me/keys — agent accounts and their MCP keys */
import { Router } from "express";
import crypto from "crypto";
import { q } from "../db.js";
import { parseRoles, AGENT_DOMAIN } from "../config.js";
import { scryptHash, randomPassword } from "../crypto.js";
import { createUser, requireUser } from "../users.js";
import { ah, safeUser, requireRole } from "../auth.js";
import { sysAudit } from "../audit.js";
import { issueKey, revokeKey, keysOfUser } from "../agent-keys.js";

export function agentKeyRoutes() {
  const r = Router();
  /* Admins create agents by name (no e-mail, no password login): the account exists for identity, audit and keys */
  r.post("/admin/agents", requireRole("admin"), ah(async (req, res) => {
    const name = String(req.body?.name || "").trim(); const scope = req.body?.scope === "read" ? "read" : "write";
    if (name.length < 2) return res.status(400).json({ error: "Please give the agent a name" });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "agent";
    const email = `${slug}-${crypto.randomBytes(3).toString("hex")}${AGENT_DOMAIN}`;
    const u = await createUser({ name, email, role: "agent", passwordHash: await scryptHash(randomPassword()) });
    await sysAudit(req.user, "user", "created", u.email, [{ field: "role", from: null, to: `agent (${scope})` }]);
    const { id, key } = await issueKey(u, `${name} · ${scope}`, req.user, scope);
    res.json({ user: safeUser(u), keyId: id, key, scope, note: "The key is the agent's credential — shown once." });
  }));
  r.get("/admin/users/:id/keys", requireRole("admin"), ah(async (req, res) => res.json({ keys: await keysOfUser(req.params.id) })));
  r.post("/admin/users/:id/keys", requireRole("admin"), ah(async (req, res) => {
    const u = await requireUser(req.params.id); u.roles = parseRoles(u);
    const { id, key, scope } = await issueKey(u, req.body?.name, req.user, req.body?.scope);
    res.json({ id, key, scope, note: "Shown once — store it in the MCP client configuration." });
  }));
  r.delete("/admin/keys/:id", requireRole("admin"), ah(async (req, res) => {
    const rows = await q("SELECT k.*, u.email FROM agent_keys k JOIN users u ON u.id = k.user_id WHERE k.id = ?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Key not found" });
    await revokeKey(req.params.id);
    await sysAudit(req.user, "user", "updated", rows[0].email, [{ field: "agent key", from: `${rows[0].prefix}…`, to: "revoked" }]);
    res.json({ ok: true });
  }));
  /* self-service for the agent account itself */
  r.get("/auth/me/keys", requireRole("agent"), ah(async (req, res) => res.json({ keys: await keysOfUser(req.user.id) })));
  r.post("/auth/me/keys", requireRole("agent"), ah(async (req, res) => {
    const { id, key, scope } = await issueKey(req.user, req.body?.name, req.user, req.body?.scope); res.json({ id, key, scope });
  }));
  r.delete("/auth/me/keys/:id", requireRole("agent"), ah(async (req, res) => {
    const rows = await q("SELECT id FROM agent_keys WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: "Key not found" });
    await revokeKey(req.params.id);
    res.json({ ok: true });
  }));
  return r;
}
