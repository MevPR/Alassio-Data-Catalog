/* v1.69 — the marketplace use cases are testable without a database: authorisation and payload validation are pure,
   the orchestration (applyDesignAction / createRequest / decideAccessRequest) runs against a stubbed q(). */
import { describe, it, expect, vi, beforeEach } from "vitest";
const sql = [];
const rows = { current: null };
vi.mock("../../server/db.js", () => ({ q: vi.fn(async (s, p = []) => { sql.push([s, p]); if (/^UPDATE marketplace_requests SET status = \?, decided_by/.test(s) && rows.current) rows.current = { ...rows.current, status: p[0], ...(s.includes("sourcing_json") && p[5] ? { sourcing_json: p[5] } : {}) }; if (/^SELECT \* FROM marketplace_requests WHERE id/.test(s)) return rows.current ? [rows.current] : []; if (/^SELECT history_json/.test(s)) return [{ history_json: "[]" }]; if (/^SELECT id, name FROM request_files/.test(s)) return [{ id: "f1", name: "approval.pdf" }]; return { affectedRows: 1 }; }), pool: {}, sql: {} }));
vi.mock("../../server/mail.js", () => ({ notifyI18n: vi.fn(async () => 1), emailsByRole: vi.fn(async (r) => [`${r}@x.io`]), messageRow: (m) => m }));
vi.mock("../../server/audit.js", () => ({ sysAudit: vi.fn(async () => {}) }));
vi.mock("../../server/catalog-store.js", () => ({ assembleLite: vi.fn(async () => ({ catalog: { people: [{ id: "p1", name: "Owen", email: "owen@x.io" }], tables: [], schemas: [], databases: [], hubs: [], domains: [], attributes: [] }, stats: { attributes: 0, perTable: {} }, version: 1 })), applyChanges: vi.fn(async () => ({ ok: true, version: 2, applied: 1 })) }));
const { authorizeDesignAction, designActionPayload, applyDesignAction, createRequest, decideAccessRequest, validateNewRequest, ownershipOf, pendingActionsFor } = await import("../../server/marketplace.js");
const { DESIGN_ACTIONS } = await import("../../server/design-workflow.js");
const { notifyI18n } = await import("../../server/mail.js");

const admin = { id: "a", name: "Ada", email: "ada@x.io", role: "admin", roles: ["admin"] };
const pm = { id: "p", name: "Pat", email: "pat@x.io", role: "pm", roles: ["pm"] };
const ba = { id: "b", name: "Bea", email: "bea@x.io", role: "ba", roles: ["ba"] };
const guest = { id: "g", name: "Gus", email: "gus@x.io", role: "guest", roles: ["guest"] };
const design = (status, extra = {}) => ({ id: "r1", kind: "design", name: "Claims DP", hub: "Health", requested_by: "pat@x.io", requester_name: "Pat", status, sourcing_json: null, table_ids: null, ...extra });
beforeEach(() => { sql.length = 0; vi.clearAllMocks(); });

describe("authorizeDesignAction (pure)", () => {
  it("submitter and admin may forward; a guest may not; wrong state is a 409", () => {
    expect(authorizeDesignAction(design("submitted"), "forward_refinement", pm).to).toBe("refinement_review");
    expect(authorizeDesignAction(design("submitted"), "forward_refinement", admin).to).toBe("refinement_review");
    expect(() => authorizeDesignAction(design("submitted"), "forward_refinement", guest)).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => authorizeDesignAction(design("sourcing"), "forward_refinement", pm)).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => authorizeDesignAction(design("sourcing"), "nope", pm)).toThrow(expect.objectContaining({ status: 400 }));
  });
  it("the owner gate needs the resolved ownership flag; a BA edits only in BA states", () => {
    expect(() => authorizeDesignAction(design("owner_review"), "owner_approve", guest)).toThrow(expect.objectContaining({ status: 403 }));
    expect(authorizeDesignAction(design("owner_review"), "owner_approve", guest, { isOwner: true }).to).toBe("ingestion_review");
    expect(authorizeDesignAction(design("refinement_review"), "edit", ba)).toBe(DESIGN_ACTIONS.edit);
    expect(() => authorizeDesignAction(design("owner_approved"), "edit", ba)).toThrow(/only while it is with the analyst/);
    expect(authorizeDesignAction(design("owner_approved"), "edit", pm)).toBe(DESIGN_ACTIONS.edit);   /* the submitter may */
  });
});

describe("designActionPayload (pure)", () => {
  it("validates reason, ingestion note, step note with files, approval document and sourcing details", async () => {
    await expect(designActionPayload(DESIGN_ACTIONS.refinement_reject, design("sourcing"), {}, ba)).rejects.toMatchObject({ status: 400 });
    await expect(designActionPayload(DESIGN_ACTIONS.ingestion_confirm, design("ingestion_review"), { note: "" }, admin)).rejects.toThrow(/where the ingested tables/);
    const p = await designActionPayload(DESIGN_ACTIONS.dev_done, design("development"), { note: "deployed", fileIds: ["f1"] }, admin, { now: 5, filesOf: async () => [{ id: "f1", name: "n.txt" }] });
    expect(p.stepNote).toEqual({ by: "Ada", email: "ada@x.io", ts: 5, note: "deployed", files: [{ id: "f1", name: "n.txt" }] });
    await expect(designActionPayload(DESIGN_ACTIONS.owner_approve, design("owner_review"), { url: "ftp://x" }, admin)).rejects.toThrow(/must be a URL/);
    await expect(designActionPayload(DESIGN_ACTIONS.owner_approve, design("owner_review"), {}, admin)).rejects.toThrow(/attach the approval document/);
    const a = await designActionPayload(DESIGN_ACTIONS.owner_approve, design("owner_review"), { fileId: "f1" }, admin, { filesOf: async () => [{ id: "f1", name: "approval.pdf" }] });
    expect(a.approval.fileName).toBe("approval.pdf");
    await expect(designActionPayload(DESIGN_ACTIONS.forward_ingestion, design("owner_approved"), {}, pm)).rejects.toThrow(/must document source system/);
    await expect(designActionPayload(DESIGN_ACTIONS.refinement_ok, design("sourcing"), { sourcing: { sourceSystem: "SAP", bpo: "Owen", leanixUrl: "nope", dataSteward: "Sue" } }, ba)).rejects.toThrow(/LeanIX link must be a URL/);
    const s = await designActionPayload(DESIGN_ACTIONS.refinement_ok, design("sourcing"), { sourcing: { sourceSystem: "SAP", bpo: "Owen", leanixUrl: "https://leanix/x", dataSteward: "Sue" } }, ba);
    expect(s.sourcing).toEqual({ sourceSystem: "SAP", bpo: "Owen", leanixUrl: "https://leanix/x", dataSteward: "Sue" });
  });
});

describe("applyDesignAction (orchestration against a stubbed database)", () => {
  it("persists the transition, writes history + audit and notifies requester, role and owner", async () => {
    rows.current = design("sourcing", { sourcing_json: null });
    const out = await applyDesignAction(rows.current, "refinement_ok", { sourcing: { sourceSystem: "SAP", bpo: "Owen", leanixUrl: "https://leanix/x", dataSteward: "Sue" } }, ba);
    expect(out.id).toBe("r1");
    const upd = sql.find(([s]) => s.startsWith("UPDATE marketplace_requests SET status = ?"));
    expect(upd[1][0]).toBe("owner_review"); expect(JSON.parse(upd[1][5]).bpo).toBe("Owen");
    expect(sql.some(([s]) => s.startsWith("UPDATE marketplace_requests SET history_json"))).toBe(true);
    const [recipients, , key, params] = notifyI18n.mock.calls.at(-1);
    expect(key).toBe("design_status"); expect(params.status).toBe("owner_review");
    expect(recipients).toEqual(expect.arrayContaining(["pat@x.io", "owen@x.io"]));   /* submitter + the BPO resolved by e-mail */
  });
  it("refuses a transition the caller may not take without touching the database", async () => {
    rows.current = design("owner_review");
    await expect(applyDesignAction(rows.current, "owner_approve", { note: "ok" }, guest)).rejects.toMatchObject({ status: 403 });
    expect(sql.filter(([s]) => s.startsWith("UPDATE")).length).toBe(0);
  });
  it("the design owner (matched by e-mail) may approve", async () => {
    rows.current = design("owner_review", { sourcing_json: JSON.stringify({ bpo: "Owen" }) });
    const owner = { id: "o", name: "Owen", email: "owen@x.io", role: "guest", roles: ["guest"] };
    const out = await applyDesignAction(rows.current, "owner_approve", { note: "approved by mail" }, owner);
    expect(out.id).toBe("r1");
    expect(sql.find(([s]) => s.startsWith("UPDATE marketplace_requests SET status = ?"))[1][0]).toBe("ingestion_review");
  });
});

describe("createRequest / decideAccessRequest", () => {
  it("validates new requests and forwards a design to the Business Analyst automatically", async () => {
    expect(() => validateNewRequest({ kind: "x" }, pm)).toThrow(/kind must be/);
    expect(() => validateNewRequest({ kind: "design", purpose: "p", name: "n", hub: "h", project: "P", useCase: "U" }, guest)).toThrow(expect.objectContaining({ status: 403 }));
    rows.current = design("submitted");
    await createRequest({ kind: "design", purpose: "p", name: "Claims DP", hub: "Health", project: "P", useCase: "U", tableIds: ["t1"] }, pm);
    expect(sql.some(([s]) => s.startsWith("INSERT INTO marketplace_requests"))).toBe(true);
    expect(sql.some(([s]) => s.includes("SET status = 'refinement_review'"))).toBe(true);
    expect(notifyI18n.mock.calls.map((c) => c[2])).toEqual(["design_submitted", "design_refine"]);
  });
  it("only admins decide access requests; the decision is recorded and the requester notified", async () => {
    rows.current = { id: "r2", kind: "access", product_label: "Sales gold", requested_by: "gus@x.io", status: "open" };
    await expect(decideAccessRequest(rows.current, { status: "approved" }, pm)).rejects.toMatchObject({ status: 403 });
    await expect(decideAccessRequest(rows.current, { status: "maybe" }, admin)).rejects.toMatchObject({ status: 400 });
    await decideAccessRequest(rows.current, { status: "approved", reason: "ok" }, admin);
    expect(sql.find(([s]) => s.startsWith("UPDATE marketplace_requests SET status = ?, decided_by"))[1][0]).toBe("approved");
    expect(notifyI18n.mock.calls.at(-1)[2]).toBe("access_decided");
  });
});

/* v1.73 (F-S7): the "waiting for me" rule of My Dashboard, formerly inline in the /api/me/dashboard route */
describe("pendingActionsFor / ownershipOf (pure)", () => {
  const cat = { people: [{ id: "p1", name: "Owen", email: "owen@x.io" }, { id: "p2", name: "Bea Legacy", email: "" }],
    hubs: [{ id: "h1", name: "Health" }], databases: [{ id: "d1", hubId: "h1", name: "GOLD" }], schemas: [{ id: "s1", databaseId: "d1", name: "dp", ownerId: "p1" }], tables: [] };
  const owen = { id: "o", name: "Owen", email: "owen@x.io", role: "guest", roles: ["guest"] };
  const row = (kind, status, extra = {}) => ({ id: "r", kind, status, requestedBy: "pat@x.io", productRef: kind === "access" ? "s1" : null, sourcing: null, ...extra });
  it("resolves the user's person ids, BPO names and product ownership", () => {
    const own = ownershipOf(cat, owen);
    expect([...own.mineIds]).toEqual(["p1"]);
    expect(own.ownerNames.has("owen")).toBe(true);
    expect(own.ownsProduct(row("access", "open"))).toBe(true);
    expect(own.ownsProduct(row("access", "open", { productRef: null }))).toBe(false);
    expect(ownershipOf(cat, guest).ownsProduct(row("access", "open"))).toBe(false);
  });
  it("access requests wait for admins and the product owner while open", () => {
    expect(pendingActionsFor(row("access", "open"), admin, ownershipOf(cat, admin))).toEqual(["decide"]);
    expect(pendingActionsFor(row("access", "open"), owen, ownershipOf(cat, owen))).toEqual(["decide"]);
    expect(pendingActionsFor(row("access", "open"), guest, ownershipOf(cat, guest))).toEqual([]);
    expect(pendingActionsFor(row("access", "approved"), admin, ownershipOf(cat, admin))).toEqual([]);
  });
  it("designs wait for the role of the next step, the submitter, or the named BPO — never when closed", () => {
    expect(pendingActionsFor(row("design", "refinement_review"), ba, ownershipOf(cat, ba))).toEqual(expect.arrayContaining(["design_refined", "refinement_ok", "refinement_reject"]));
    expect(pendingActionsFor(row("design", "refinement_review"), guest, ownershipOf(cat, guest))).toEqual([]);
    expect(pendingActionsFor(row("design", "submitted"), pm, ownershipOf(cat, pm))).toEqual(expect.arrayContaining(["withdraw", "forward_refinement"]));
    expect(pendingActionsFor(row("design", "submitted"), pm, ownershipOf(cat, pm))).not.toContain("edit");   /* "edit" moves nowhere */
    expect(pendingActionsFor(row("design", "owner_review", { sourcing: { bpo: " owen " } }), owen, ownershipOf(cat, owen))).toEqual(["owner_approve", "owner_reject"]);
    expect(pendingActionsFor(row("design", "owner_review", { sourcing: { dataOwner: "Owen" } }), owen, ownershipOf(cat, owen))).toEqual(["owner_approve", "owner_reject"]);
    expect(pendingActionsFor(row("design", "owner_review", { sourcing: { bpo: "Someone" } }), owen, ownershipOf(cat, owen))).toEqual([]);
    for (const st of ["done", "withdrawn", "rejected"]) expect(pendingActionsFor(row("design", st), admin, ownershipOf(cat, admin))).toEqual([]);
  });
});
