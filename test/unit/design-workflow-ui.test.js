/* v1.68 — the UI's workflow vocabulary lives in one module (src/lib/design-workflow.js) and agrees with the server's
   state machine; the role vocabulary in src/lib/roles.js. */
import { describe, it, expect } from "vitest";
import { DESIGN_ACTIONS, DESIGN_STATUS, STATUS_LABEL, PHASES, PHASE_OF, PHASE_LABEL, ORDER, phaseState, STEP_RANK, availableActions, WAITING_FOR } from "../../src/lib/design-workflow.js";
import { DESIGN_ACTIONS as SERVER_ACTIONS } from "../../server/design-workflow.js";
import { ROLE_LABEL, ROLE_OPTIONS, highestRole, hasRole, rolesOf } from "../../src/lib/roles.js";

describe("design workflow vocabulary", () => {
  it("every status the server can produce has a label, a phase and a position", () => {
    const serverStatuses = new Set(Object.values(SERVER_ACTIONS).flatMap((a) => [...a.from, a.to].filter(Boolean)));
    for (const s of serverStatuses) {
      expect(STATUS_LABEL[s], `label for ${s}`).toBeTruthy();
      if (!["withdrawn", "done"].includes(s)) { expect(PHASE_OF(s), `phase of ${s}`).toBeGreaterThan(0); expect(ORDER.includes(s), `order of ${s}`).toBe(true); expect(STEP_RANK[s], `step rank of ${s}`).toBeGreaterThan(0); }
    }
    expect(PHASE_OF("done")).toBe(3); expect(PHASE_LABEL[1]).toMatch(/Sourcing/);
  });
  it("UI actions mirror the server's transitions (same keys, same from-states, same roles)", () => {
    for (const k of Object.keys(DESIGN_ACTIONS)) expect(SERVER_ACTIONS[k], `server knows ${k}`).toBeTruthy();   /* the server may keep extra legacy transitions (development_done) */
    for (const [k, a] of Object.entries(DESIGN_ACTIONS)) {
      expect([...a.from].sort(), `from of ${k}`).toEqual([...SERVER_ACTIONS[k].from].sort());
      expect([...a.who].sort(), `who of ${k}`).toEqual([...SERVER_ACTIONS[k].who].sort());
    }
  });
  it("availableActions: submitter, owner and roles see their own actions; a BA may edit only in BA stages", () => {
    const req = { status: "refinement_review", requestedBy: "pat@x.io", name: "DP", sourcing: { bpo: "Owen" } };
    const names = (me, r = req, own = () => false) => availableActions(r, me, own).map(([k]) => k).sort();
    expect(names({ email: "pat@x.io", role: "guest", roles: ["guest"] })).toEqual(["edit", "withdraw"]);   /* the submitter may still edit or withdraw */
    expect(names({ email: "nobody@x.io", role: "guest", roles: ["guest"] })).toEqual([]);
    expect(names({ email: "ba@x.io", role: "ba", roles: ["ba"] })).toEqual(["design_refined", "edit", "refinement_ok", "refinement_reject"]);   /* withdraw belongs to the submitter */
    expect(names({ email: "ba@x.io", role: "ba", roles: ["ba"] }, { ...req, status: "owner_review" })).toEqual([]);
    expect(names({ email: "o@x.io", role: "guest", roles: ["guest"] }, { ...req, status: "owner_review" }, () => true)).toEqual(["owner_approve", "owner_reject"]);
    expect(names({ email: "a@x.io", role: "admin", roles: ["admin"] }, { ...req, status: "sit" })).toEqual(["development_reject", "sit_done", "withdraw"]);
  });
  it("phaseState walks the three phases", () => {
    const r = (status) => ({ status });
    expect(PHASES.map((p, i) => phaseState(r("sourcing"), p, i))).toEqual(["current", "pending", "pending"]);
    expect(PHASES.map((p, i) => phaseState(r("refine_review"), p, i))).toEqual(["done", "current", "pending"]);
    expect(PHASES.map((p, i) => phaseState(r("done"), p, i))).toEqual(["done", "done", "done"]);
    /* v1.73: [dictionary key, placeholder values] instead of a baked English sentence */
    expect(WAITING_FOR({ kind: "design", status: "owner_review", sourcing: { bpo: "Owen" } })).toEqual(["BPO {bpo} — approve or decline", { name: "", bpo: "Owen" }]);
    expect(WAITING_FOR({ kind: "design", status: "submitted", requesterName: "Pat" })).toEqual(["{name} — forward to the Business Analyst", { name: "Pat", bpo: "" }]);
    expect(WAITING_FOR({ kind: "access", status: "open" })[0]).toBe("Admin / data owner (approve or reject)");
    expect(WAITING_FOR({ kind: "design", status: "done" })).toEqual(["—", {}]);
    expect(DESIGN_STATUS.refinement_review[0]).toBe("With Business Analyst");   /* the label the three screens used to disagree on */
  });
});

describe("role vocabulary", () => {
  it("labels, options and precedence agree", () => {
    for (const [k] of ROLE_OPTIONS) expect(ROLE_LABEL[k], k).toBeTruthy();
    expect(highestRole(["guest", "pm", "ingestion"])).toBe("pm"); expect(highestRole(["steward", "admin"])).toBe("admin"); expect(highestRole([])).toBe("guest");
    expect(rolesOf({ role: "pm", roles: ["pm", "ba"] })).toEqual(["pm", "ba"]); expect(rolesOf({ role: "pm" })).toEqual(["pm"]); expect(rolesOf(null)).toEqual([]);
    expect(hasRole({ role: "pm", roles: ["pm", "ba"] }, "ba")).toBe(true); expect(hasRole({ role: "pm" }, "ba")).toBe(false);
  });
});
