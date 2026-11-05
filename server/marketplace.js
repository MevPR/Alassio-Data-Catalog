/* Marketplace use cases (v1.69 — extracted from routes/marketplace.js, which now only parses and responds):
     createRequest        new access request or data product design (validation, insert, auto-forward, notifications)
     decideAccessRequest  admin decision on an access request
     applyDesignAction    one transition of the design workflow — authorisation, payload validation, persistence,
                          history, audit, notifications and tag synchronisation
   Authorisation and payload validation are pure functions (authorizeDesignAction, designActionPayload) so they are
   unit-tested without a database; the orchestration below talks to the DB through the same helpers the route used. */
import crypto from "crypto";
import { q } from "./db.js";
import { hasRole } from "./config.js";
import { sysAudit } from "./audit.js";
import { notifyI18n, emailsByRole } from "./mail.js";
import { personIdsForUser, effOwnerId } from "../permissions.js";
import { reqRow, cleanAdvanced, SOURCING_KEYS, DESIGN_ACTIONS, CLOSED_STATES, STATUS_TEXT, isDesignOwner, designOwnerEmail, syncDesignTags, applyDesignTags, logHistory, loadRequest } from "./design-workflow.js";

const fail = (status, error) => Object.assign(new Error(error), { status });
const isUrl = (s) => /^https?:\/\//i.test(String(s || "").trim());
export const requestLabel = (r) => (r.kind === "access" ? `access request: ${r.product_label}` : `data product design: ${r.name}`);
const BA_EDIT_STATES = ["refinement_review", "sourcing", "refine_review"];
const tagsSafely = async (fn) => { try { await fn(); } catch (e) { console.error("design tags:", e.message); } };

/* ── new request ── */
export const validateNewRequest = (b, user) => {
  if (!["access", "design"].includes(b.kind)) throw fail(400, "kind must be access or design");
  if (!String(b.purpose || "").trim()) throw fail(400, b.kind === "access" ? "Please state the purpose" : "Please describe the data product");
  if (b.kind === "access" && !b.productRef) throw fail(400, "Choose a data product");
  if (b.kind === "design") {
    if (!String(b.name || "").trim() || !b.hub) throw fail(400, "Name and data hub are required");
    if (!String(b.project || "").trim()) throw fail(400, "Please state the project (e.g. GenAI, Customer360)");
    if (!String(b.useCase || "").trim()) throw fail(400, "Please state the use case (tag \"Use Case\")");
    if (!hasRole(user, "admin") && !hasRole(user, "pm")) throw fail(403, "Only Project Managers and Admins design data products");
  }
};
export const createRequest = async (b, user) => {
  validateNewRequest(b, user);
  const id = crypto.randomUUID(), ts = Date.now();
  await q(`INSERT INTO marketplace_requests (id, kind, product_ref, product_label, name, hub, purpose, tag_key, tag_value, table_ids, requested_by, requester_name, status, ts, advanced_json, project, use_case)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, b.kind, b.productRef || null, (b.productLabel || "").slice(0, 500) || null, (b.name || "").slice(0, 250) || null, (b.hub || "").slice(0, 250) || null,
     String(b.purpose).slice(0, 8000), (b.tagKey ? "Data Product" : null),   /* v1.66.1: the design tag key is fixed */ (b.tagValue || "").slice(0, 500) || null,
     Array.isArray(b.tableIds) ? JSON.stringify(b.tableIds.slice(0, 2000)) : null, user.email, user.name, b.kind === "design" ? "submitted" : "open", ts,
     b.kind === "design" && b.advanced ? JSON.stringify(cleanAdvanced(b.advanced)) : null, b.kind === "design" ? String(b.project).trim().slice(0, 250) : null, b.kind === "design" ? String(b.useCase).trim().slice(0, 250) : null]);
  if (b.kind === "design") {
    await notifyI18n([user.email], "Alassio Data Catalog", "design_submitted", { name: b.name, hub: b.hub }, { requestId: id });
    await tagsSafely(async () => syncDesignTags(null, await loadRequest(id), user));
    /* a new design goes to the Business Analyst automatically */
    await q("UPDATE marketplace_requests SET status = 'refinement_review', updated_ts = ? WHERE id = ?", [Date.now(), id]);
    await logHistory(id, { ts: Date.now(), by: user.name, action: "forwarded to the Business Analyst", reason: null });
    await notifyI18n(await emailsByRole("ba"), "Alassio Data Catalog", "design_refine", { requester: user.name, name: b.name, hub: b.hub }, { requestId: id });
  } else {
    await notifyI18n([...await emailsByRole("admin")], user.name, "access_request", { requester: user.name, product: b.productLabel || b.productRef, purpose: b.purpose }, { requestId: id });
  }
  await sysAudit(user, "marketplace", "created", b.kind === "access" ? `access request: ${b.productLabel || b.productRef}` : `data product design: ${b.name}`, [{ field: "kind", from: null, to: b.kind }]);
  return reqRow(await loadRequest(id));
};

/* ── access request decision (admins) ── */
export const decideAccessRequest = async (row, { status, reason }, user) => {
  if (!hasRole(user, "admin")) throw fail(403, "Only admins decide access requests");
  if (!["open", "approved", "rejected", "done"].includes(status)) throw fail(400, "status must be open, approved, rejected or done");
  const now = Date.now();
  await q("UPDATE marketplace_requests SET status = ?, decided_by = ?, decided_ts = ?, reason = ?, updated_ts = ? WHERE id = ?", [status, user.email, now, reason || null, now, row.id]);
  await logHistory(row.id, { ts: now, by: user.name, action: status, reason: reason || null });
  await sysAudit(user, "marketplace", "updated", requestLabel(row), [{ field: "status", from: row.status, to: status }]);
  await notifyI18n([row.requested_by], user.name, "access_decided", { product: row.product_label, status, reason: reason || "" }, { requestId: row.id });
  return reqRow(await loadRequest(row.id));
};

/* ── design workflow ── */
/* who may do what in which state (pure): returns the action spec or throws 400 / 403 / 409 */
export const authorizeDesignAction = (row, action, user, { isOwner = false } = {}) => {
  const spec = DESIGN_ACTIONS[action];
  if (!spec) throw fail(400, `Unknown action; use one of ${Object.keys(DESIGN_ACTIONS).join(", ")}`);
  const isSubmitter = row.requested_by === user.email;
  const ownerHere = spec.who.includes("owner") && isOwner;
  const baEdit = action === "edit" && hasRole(user, "ba") && !hasRole(user, "admin") && !isSubmitter;
  if (baEdit && !BA_EDIT_STATES.includes(row.status)) throw fail(403, "The Business Analyst edits a design only while it is with the analyst");
  const allowed = ownerHere || spec.who.some((w) => (w === "submitter" && isSubmitter) || (w !== "owner" && hasRole(user, w)));
  if (!allowed) throw fail(403, `Action "${action}" is not available for your role in this step`);
  if (!spec.from.includes(row.status)) throw fail(409, `Action "${action}" is not possible while the design is ${STATUS_TEXT[row.status] || row.status}`);
  return spec;
};

/* ── My Dashboard: what waits for the user (v1.73, F-S7 — moved out of the /api/me/dashboard route) ── */
/* the user's stake in the catalog: their person ids, the names they answer to as BPO, and product ownership */
export const ownershipOf = (catalog, user) => {
  const mineIds = personIdsForUser(catalog, user);
  const ownerNames = new Set([...(catalog.people || []).filter((p) => mineIds.has(p.id)).map((p) => p.name.trim().toLowerCase()), String(user.name || "").trim().toLowerCase()]);
  const ownsProduct = (x) => x.kind === "access" && !!x.productRef && mineIds.has(effOwnerId(catalog, "schema", x.productRef));
  return { mineIds, ownerNames, ownsProduct };
};
/* the actions the user could take next on a request (reqRow shape) — non-empty means "waiting for me" (pure).
   Access requests: "decide" while open, for admins and the product's owner. Designs: every forward-moving action of
   the current state the user's role, submittership or BPO name (matched by name, as the dashboard always did) allows. */
export const pendingActionsFor = (x, user, { ownerNames, ownsProduct }) => {
  if (CLOSED_STATES.includes(x.status)) return [];
  if (x.kind === "access") return x.status === "open" && (hasRole(user, "admin") || ownsProduct(x)) ? ["decide"] : [];
  const bpo = String(x.sourcing?.bpo || x.sourcing?.dataOwner || "").trim().toLowerCase();
  return Object.entries(DESIGN_ACTIONS).filter(([, a]) => a.from.includes(x.status) && a.to)
    .filter(([, a]) => a.who.some((w) => w !== "owner" && w !== "submitter" && hasRole(user, w)) || (a.who.includes("submitter") && x.requestedBy === user.email) || (a.who.includes("owner") && ownerNames.has(bpo)))
    .map(([name]) => name);
};

/* the validated payload of a transition (pure except for the attachment lookup, injected as `filesOf(ids)`):
   reason, ingestion note, step note (+ files), approval document, sourcing details */
export const designActionPayload = async (spec, row, b, user, { now = Date.now(), filesOf = async () => [] } = {}) => {
  if (spec.needsReason && !String(b.reason || "").trim()) throw fail(400, "Please give a reason");
  const out = { reason: b.reason || null, ingestion: null, stepNote: null, approval: null, sourcing: null };
  if (spec.needsIngestionNote) {
    const note = String(b.note || "").trim();
    if (!note) throw fail(400, "Please describe where the ingested tables can be found (catalog / schema / path)");
    out.ingestion = { by: user.name, email: user.email, ts: now, note: note.slice(0, 4000) };
  }
  if (spec.noteColumn) {
    const note = String(b.note || "").trim();
    if (!note) throw fail(400, spec.noteError || "Please add a note");
    const fileIds = Array.isArray(b.fileIds) ? b.fileIds.slice(0, 20) : [];
    const files = fileIds.length ? await filesOf(fileIds) : [];
    out.stepNote = { by: user.name, email: user.email, ts: now, note: note.slice(0, 4000), files: files.map((f) => ({ id: f.id, name: f.name })) };
  }
  if (spec.approval) {
    const approval = { approvedBy: user.name, email: user.email, ts: now, note: String(b.note || "").slice(0, 2000), url: String(b.url || "").trim().slice(0, 1000) || null, fileId: b.fileId || null };
    if (approval.url && !isUrl(approval.url)) throw fail(400, "The document link must be a URL (https://…)");
    if (approval.fileId) { const f = await filesOf([approval.fileId]); if (!f.length) throw fail(400, "Unknown document"); approval.fileName = f[0].name; }
    if (!approval.url && !approval.fileId && !approval.note) throw fail(400, "Please attach the approval document (file or link) or add a note");
    out.approval = approval;
  }
  if (spec.requiresSourcing && !row.sourcing_json) throw fail(400, "The Business Analyst must document source system, BPO, LeanIX link, data steward and data owner before the design is forwarded to Data Ingestion");
  if (spec.needsSourcing) {
    const src = b.sourcing || {};
    const missing = SOURCING_KEYS.filter((k) => !String(src[k] || "").trim());
    if (missing.length) throw fail(400, `The Business Analyst must provide: source system, BPO, LeanIX link and data steward (missing: ${missing.join(", ")})`);
    if (!isUrl(src.leanixUrl)) throw fail(400, "The LeanIX link must be a URL (https://…)");
    out.sourcing = Object.fromEntries(SOURCING_KEYS.map((k) => [k, String(src[k]).trim().slice(0, 500)]));
  }
  return out;
};

const historyReason = (p) => p.reason || (p.sourcing ? `source ${p.sourcing.sourceSystem}, BPO ${p.sourcing.bpo}` : p.ingestion ? p.ingestion.note.slice(0, 200) : p.stepNote ? p.stepNote.note.slice(0, 200) : null);

/* one workflow transition (or an edit) on a design row; returns the updated request */
export const applyDesignAction = async (row, action, b, user) => {
  const spec = authorizeDesignAction(row, action, user, { isOwner: DESIGN_ACTIONS[action]?.who.includes("owner") ? await isDesignOwner(row, user) : false });
  const now = Date.now();
  const label = requestLabel(row);
  const filesOf = (ids) => q(`SELECT id, name FROM request_files WHERE request_id = ? AND id IN (${ids.map(() => "?").join(",")})`, [row.id, ...ids]);
  const p = await designActionPayload(spec, row, b, user, { now, filesOf });
  if (action === "edit") {
    const f = b.fields || {};
    await q("UPDATE marketplace_requests SET name = COALESCE(?, name), hub = COALESCE(?, hub), purpose = COALESCE(?, purpose), tag_key = COALESCE(?, tag_key), tag_value = COALESCE(?, tag_value), table_ids = COALESCE(?, table_ids), advanced_json = COALESCE(?, advanced_json), project = COALESCE(?, project), use_case = COALESCE(?, use_case), updated_ts = ? WHERE id = ?",
      [f.name ? String(f.name).slice(0, 250) : null, f.hub ? String(f.hub).slice(0, 250) : null, f.purpose ? String(f.purpose).slice(0, 8000) : null, f.tagKey ? "Data Product" : null,
       f.tagValue ? String(f.tagValue).slice(0, 500) : null, Array.isArray(f.tableIds) ? JSON.stringify(f.tableIds.slice(0, 2000)) : null, f.advanced ? JSON.stringify(cleanAdvanced(f.advanced)) : null, f.project ? String(f.project).trim().slice(0, 250) : null, f.useCase ? String(f.useCase).trim().slice(0, 250) : null, now, row.id]);
    await sysAudit(user, "marketplace", "updated", label, [{ field: "design", from: "edited", to: "edited" }]);
    await tagsSafely(async () => syncDesignTags(row, await loadRequest(row.id), user));
    return reqRow(await loadRequest(row.id));
  }
  await q("UPDATE marketplace_requests SET status = ?, decided_by = ?, decided_ts = ?, reason = ?, updated_ts = ?, sourcing_json = COALESCE(?, sourcing_json), approval_json = COALESCE(?, approval_json), ingestion_json = COALESCE(?, ingestion_json) WHERE id = ?",
    [spec.to, user.email, now, p.reason, now, p.sourcing ? JSON.stringify(p.sourcing) : null, p.approval ? JSON.stringify(p.approval) : null, p.ingestion ? JSON.stringify(p.ingestion) : null, row.id]);
  if (p.stepNote) await q(`UPDATE marketplace_requests SET ${spec.noteColumn} = ? WHERE id = ?`, [JSON.stringify(p.stepNote), row.id]);
  await logHistory(row.id, { ts: now, by: user.name, action: action.replace(/_/g, " "), reason: historyReason(p) });
  await sysAudit(user, "marketplace", "updated", label, [{ field: "status", from: row.status, to: spec.to }]);
  const fresh = await loadRequest(row.id);
  const recipients = [row.requested_by];
  if (spec.notifyRole) recipients.push(...await emailsByRole(spec.notifyRole));
  /* the BPO is read from the saved row: refinement_ok stores the sourcing details in this very transition, so the old
     row has none yet (v1.69 — the owner used to miss exactly this notification) */
  if (spec.notifyOwner) { const oe = await designOwnerEmail(fresh || row); if (oe) recipients.push(oe); }
  await notifyI18n(recipients, user.name, "design_status", { requester: user.name, name: row.name, hub: row.hub, status: spec.to, reason: p.reason || "", review: !!spec.notifyRole }, { requestId: row.id });
  if (spec.to === "done") await tagsSafely(() => applyDesignTags(row, user));
  if (spec.to === "withdrawn") await tagsSafely(() => syncDesignTags(row, null, user));
  return reqRow(fresh);
};

/* admin deletion incl. tag clean-up and dependent rows */
export const deleteRequest = async (row, user) => {
  if (row.kind === "design" && row.status !== "withdrawn") await tagsSafely(() => syncDesignTags(row, null, user));
  await q("DELETE FROM marketplace_requests WHERE id = ?", [row.id]);
  await q("DELETE FROM messages WHERE request_id = ?", [row.id]).catch(() => {});
  await q("DELETE FROM request_files WHERE request_id = ?", [row.id]).catch(() => {});
  await sysAudit(user, "marketplace", "deleted", requestLabel(row), [{ field: "status", from: row.status, to: null }]);
};
