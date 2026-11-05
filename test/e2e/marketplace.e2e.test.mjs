/**
 * E2E — marketplace: access requests, the full data-product workflow across roles, my dashboard.
 * v1.73 (F-T6): split out of the former server.e2e.test.mjs. This file resets the test database, boots its own server
 * on port 3983 (E2E_PORT_BASE + 3), bootstraps the admin, seeds hub → e2e_gold → prod → kpi and removes it again.
 * Run alone: DB_USER=… DB_PASSWORD=… DB_NAME=datahub_catalog_test node --test test/e2e/marketplace.e2e.test.mjs
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { ADMIN, requireDb, startSuite, cleanupTree, signIn } from "./helpers.mjs";

let S;   /* the running suite: { base, c (cookie client), m (MCP client), hubName, seeded, stop } */
const req = (...a) => S.c.req(...a);

describe("E2E marketplace", { skip: requireDb() }, () => {
  before(async () => {
    S = await startSuite({ name: "marketplace" });
  });
  after(async () => { if (S) { await cleanupTree(S.m, S.hubName); await S.stop(); } });

  test("marketplace: request, admin approval, anonymous blocked", async () => {
    const sc = (await req("/api/catalog")).json.catalog.schemas.find((s) => s.name === "prod");
    const r = await req("/api/marketplace/requests", { method: "POST", body: { kind: "access", productRef: sc.id, productLabel: "e2e", purpose: "testing" } });
    assert.equal(r.status, 200);
    const p = await req(`/api/marketplace/requests/${r.json.request.id}`, { method: "PATCH", body: { status: "approved" } });
    assert.equal(p.json.request.status, "approved");
    const anon = await fetch(S.base + "/api/marketplace/requests");
    assert.equal(anon.status, 401);
  });

  test("data product workflow: sourcing (BA, owner approval, ingestion) → refinement (BA) → development → done", async () => {
    const adminCookie = S.c.cookie;
    const mk = async (role) => { const mail = `${role}-${Date.now()}@example.com`; const inv = await req("/admin/invite", { method: "POST", body: { email: mail, role } });
      assert.equal(inv.status, 200); return { mail, token: new URL(inv.json.link).searchParams.get("invite") }; };
    const login = async (u) => { const r = await signIn(S.c, u.mail, "wf-pass-123"); assert.equal(r.status, 200); };
    try {
      const pm = await mk("pm"), ing = await mk("ingestion"), ba = await mk("ba"), dev = await mk("dpd");
      for (const [u, name] of [[pm, "Paula PM"], [ing, "Ingo Ingestion"], [ba, "Bea Analyst"], [dev, "Dana Dev"]]) {
        S.c.cookie = ""; assert.equal((await req("/auth/accept-invite", { method: "POST", body: { token: u.token, name, password: "wf-pass-123" } })).status, 200);
      }
      await login(pm);
      const noProject = await req("/api/marketplace/requests", { method: "POST", body: { kind: "design", name: "WF Product", hub: "Health", purpose: "x" } });
      assert.equal(noProject.status, 400, "project is required");
      const noUseCase = await req("/api/marketplace/requests", { method: "POST", body: { kind: "design", name: "WF Product", hub: "Health", purpose: "x", project: "GenAI" } });
      assert.equal(noUseCase.status, 400, "use case is required");
      const srcTable = (await req("/api/catalog")).json.catalog.tables.find((t) => t.name === "kpi");
      const design = await req("/api/marketplace/requests", { method: "POST", body: { kind: "design", name: "WF Product", hub: "Health", purpose: "e2e workflow", project: "GenAI", useCase: "Fraud detection", tagKey: "Data Product", tagValue: "Health Gold.wf (WF Product)", tableIds: [srcTable.id], advanced: { retention: "3 months", refreshFrequency: "weekly", classification: "C2", auditTrail: "SCD2", dataType: "structured", neededBy: "2026-12-31" } } });
      assert.equal(design.status, 200); assert.equal(design.json.request.status, "refinement_review", "a new design goes to the Business Analyst automatically");
      assert.equal(design.json.request.advanced.classification, "C2"); assert.equal(design.json.request.advanced.retention, "3 months", "v1.63: retention is kept under advanced");
      /* tags are synchronised with the selection immediately */
      let tags = (await req("/api/catalog")).json.catalog.tables.find((t) => t.id === srcTable.id).kvTags || [];
      assert.ok(tags.some((k) => k.key === "Data Product" && k.value === "Health Gold.wf (WF Product)"), "Data Product tag set on submit");
      assert.ok(tags.some((k) => k.key === "Project" && k.value === "GenAI"), "Project tag set on submit");
      assert.ok(tags.some((k) => k.key === "Use Case" && k.value === "Fraud detection"), "Use Case tag set on submit");
      const edit0 = await req(`/api/marketplace/requests/${design.json.request.id}`, { method: "PATCH", body: { action: "edit", fields: { tableIds: [] } } });
      assert.equal(edit0.status, 200);
      tags = (await req("/api/catalog")).json.catalog.tables.find((t) => t.id === srcTable.id).kvTags || [];
      assert.ok(!tags.some((k) => k.key === "Data Product" || k.key === "Project" || k.key === "Use Case"), "tags removed when the table leaves the selection");
      const edit1 = await req(`/api/marketplace/requests/${design.json.request.id}`, { method: "PATCH", body: { action: "edit", fields: { tableIds: [srcTable.id] } } });
      assert.equal(edit1.status, 200);
      const id = design.json.request.id;
      const step = async (action, reason) => (await req(`/api/marketplace/requests/${id}`, { method: "PATCH", body: { action, reason } })).json;
      assert.ok((await step("mark_done")).error?.includes("not possible"), "cannot skip steps");
      assert.equal((await step("edit")).request.status, "refinement_review", "editing keeps the design with the analyst");
      assert.ok((await step("forward_ingestion")).error, "phase 1 (Business Analyst) cannot be skipped");
      await login(ba);
      assert.ok((await req("/api/messages")).json.messages.some((m) => m.subject.includes("WF Product")), "business analyst got notified");
      assert.equal((await step("refinement_reject", "unclear scope")).request.status, "refinement_rejected");
      await login(pm);
      assert.equal((await step("forward_refinement")).request.status, "refinement_review");
      await login(ba);
      /* the analyst may edit the design while it is with them, then marks it refined and documents the sourcing */
      assert.equal((await req(`/api/marketplace/requests/${id}`, { method: "PATCH", body: { action: "edit", fields: { purpose: "refined by BA" } } })).json.request.purpose, "refined by BA");
      assert.ok((await step("design_refined")).error?.includes("refinement of the design"), "Design refined needs notes");
      assert.equal((await req(`/api/marketplace/requests/${id}`, { method: "PATCH", body: { action: "design_refined", note: "clarified scope with the BPO" } })).json.request.status, "sourcing", "Design refined");
      assert.ok((await step("refinement_ok")).error?.includes("must provide"), "documenting the sourcing requires the details");
      const okRes = (await req(`/api/marketplace/requests/${id}`, { method: "PATCH", body: { action: "refinement_ok", sourcing: { sourceSystem: "SAP FS-CD", bpo: "Owen Owner", leanixUrl: "https://company.leanix.net/x", dataSteward: "Gina Steward" } } })).json;
      assert.equal(okRes.request.status, "owner_review", "Submit and request Approval → data owner directly");
      assert.equal(okRes.request.sourcing.sourceSystem, "SAP FS-CD");
      await login(pm);
      assert.ok((await step("forward_ingestion")).error, "data owner approval cannot be skipped");
      /* the data owner named in the sourcing ("Owen Owner") is the admin account here: give the admin's person record that name via the catalog */
      S.c.cookie = adminCookie;
      let cat = (await req("/api/catalog")).json.catalog;
      const owen = cat.people.find((x) => x.name === "Owen Owner") || null;
      if (owen) {
        const upd = { entityType: "person", action: "updated", id: owen.id, before: owen, after: { ...owen, email: ADMIN.email } };
        assert.equal((await req("/api/catalog", { method: "PATCH", body: { baseVersion: 0, changes: [upd] } })).status, 200);
      }
      await login(pm);
      assert.ok((await step("owner_approve")).error, "the submitter is not the data owner");
      S.c.cookie = adminCookie;
      const up = await req(`/api/marketplace/requests/${id}/files`, { method: "POST", body: { name: "approval.eml", mime: "message/rfc822", data: Buffer.from("Subject: Approved").toString("base64") } });
      assert.equal(up.status, 200);
      const noDoc = await req(`/api/marketplace/requests/${id}`, { method: "PATCH", body: { action: "owner_approve" } });
      assert.equal(noDoc.status, 400, "approval needs a document or note");
      /* explicit decline sends the design back to the Business Analyst */
      const decl = await req(`/api/marketplace/requests/${id}`, { method: "PATCH", body: { action: "owner_reject", reason: "purpose unclear" } });
      assert.equal(decl.json.request.status, "refinement_review", "decline → back to the Business Analyst");
      await login(ba);
      assert.equal((await req(`/api/marketplace/requests/${id}`, { method: "PATCH", body: { action: "refinement_ok", sourcing: { sourceSystem: "SAP FS-CD", bpo: "Owen Owner", leanixUrl: "https://company.leanix.net/x", dataSteward: "Gina Steward" } } })).json.request.status, "owner_review", "re-documenting requests the approval again");
      S.c.cookie = adminCookie;
      const appr = await req(`/api/marketplace/requests/${id}`, { method: "PATCH", body: { action: "owner_approve", fileId: up.json.file.id, note: "ok for reporting" } });
      assert.equal(appr.json.request.status, "ingestion_review", "approval forwards to Data Ingestion automatically");
      assert.equal(appr.json.request.approval.fileName, "approval.eml");
      const dl = await req(`/api/marketplace/files/${up.json.file.id}`, { raw: true });
      assert.equal(await dl.text(), "Subject: Approved");
      await login(ing);
      assert.ok((await req("/api/messages")).json.messages.some((m) => m.subject.includes("WF Product")), "ingestion got notified");
      assert.ok((await step("ingestion_ok")).error, "old Okay action no longer exists");
      assert.ok((await step("ingestion_confirm")).error?.includes("where the ingested tables"), "confirmation needs the location note");
      const conf = (await req(`/api/marketplace/requests/${id}`, { method: "PATCH", body: { action: "ingestion_confirm", note: "health_bronze.wf.* in adb-1" } })).json;
      assert.equal(conf.request.status, "refine_review", "Tables ingested → refinement automatically");
      assert.equal(conf.request.ingestion.note, "health_bronze.wf.* in adb-1");
      await login(pm);
      assert.ok((await step("forward_development")).error, "phase 2 (refinement) cannot be skipped");
      await login(ba);
      assert.equal((await step("refine_reject", "needs more attributes")).request.status, "refine_rejected");
      await login(pm);
      assert.equal((await step("forward_refine")).request.status, "refine_review");
      await login(ba);
      assert.ok((await step("refine_ok")).error?.includes("describe the refinement"), "refinement completion needs notes");
      const rf = await req(`/api/marketplace/requests/${id}/files`, { method: "POST", body: { name: "refinement.pdf", mime: "application/pdf", data: Buffer.from("%PDF-1.4 refined").toString("base64") } });
      assert.equal(rf.status, 200, "the Business Analyst may attach refinement files");
      const refined = (await req(`/api/marketplace/requests/${id}`, { method: "PATCH", body: { action: "refine_ok", note: "Documented in Confluence: https://confluence/x", fileIds: [rf.json.file.id] } })).json;
      assert.equal(refined.request.status, "development", "Refinement completed → Development automatically");
      assert.equal(refined.request.refinement.files[0].name, "refinement.pdf");
      await login(dev);
      assert.ok((await step("mark_done")).error, "development cannot mark done");
      assert.ok((await step("development_done")).error, "the old single completion step is admin-only now");
      assert.ok((await step("uat_done")).error, "UAT cannot be completed before development");
      assert.ok((await step("dev_done")).error?.includes("development result"), "development completion needs notes");
      assert.equal((await req(`/api/marketplace/requests/${id}`, { method: "PATCH", body: { action: "dev_done", note: "repo dp-wf, deployed to DEV" } })).json.request.status, "uat", "Development completed → UAT");
      assert.equal((await step("development_reject", "UAT found defects")).request.status, "development_rejected", "return is possible from UAT");
      await login(pm);
      assert.equal((await step("forward_development")).request.status, "development");
      await login(dev);
      assert.equal((await req(`/api/marketplace/requests/${id}`, { method: "PATCH", body: { action: "dev_done", note: "fixed defects, redeployed" } })).json.request.status, "uat");
      assert.ok((await step("uat_done")).error?.includes("UAT result"), "UAT completion needs notes");
      assert.equal((await req(`/api/marketplace/requests/${id}`, { method: "PATCH", body: { action: "uat_done", note: "UAT accepted by business" } })).json.request.status, "sit", "UAT completed → SIT");
      const sitFile = await req(`/api/marketplace/requests/${id}/files`, { method: "POST", body: { name: "sit-report.pdf", mime: "application/pdf", data: Buffer.from("%PDF sit").toString("base64") } });
      assert.equal(sitFile.status, 200, "Data Product Development may attach step documents");
      const sitRes = (await req(`/api/marketplace/requests/${id}`, { method: "PATCH", body: { action: "sit_done", note: "SIT passed", fileIds: [sitFile.json.file.id] } })).json;
      assert.equal(sitRes.request.status, "release", "SIT completed → Release to PRD");
      assert.equal(sitRes.request.sit.files[0].name, "sit-report.pdf");
      assert.ok((await step("signoff_done")).error, "sign-off is not possible before the release");
      assert.equal((await req(`/api/marketplace/requests/${id}`, { method: "PATCH", body: { action: "release_done", note: "Release 1.0 deployed to PRD" } })).json.request.status, "signoff", "Released to PRD → Sign-off");
      assert.ok((await step("signoff_done")).error, "development cannot sign off — the Project Manager does");
      await login(pm);
      assert.equal((await step("signoff_done")).request.status, "done", "Sign-off by the Project Manager completes the design");
      const inbox = (await req("/api/messages")).json;
      assert.ok(inbox.messages.length >= 4, "submitter received workflow notifications");
      assert.ok(inbox.unread >= 1);
      const done = (await req("/api/marketplace/requests")).json.requests.find((r) => r.id === id);
      assert.ok(done.history.length >= 6, "history recorded");
      const tagged = (await req("/api/catalog")).json.catalog.tables.find((t) => t.id === srcTable.id);
      assert.ok(tagged.kvTags.some((k) => k.key === "Project" && k.value === "GenAI"), "source table inherited the Project tag");
      assert.equal((await req(`/api/marketplace/requests/${id}`, { method: "DELETE" })).status, 403, "pm cannot delete");
      S.c.cookie = adminCookie;
      assert.equal((await req(`/api/marketplace/requests/${id}`, { method: "DELETE" })).status, 200, "admin deletes a finished request");
      assert.ok(!(await req("/api/marketplace/requests")).json.requests.some((r) => r.id === id));
    } finally { S.c.cookie = adminCookie; }
  });

  test("my dashboard: initiated requests and pending actions are listed", async () => {
    const d = await req("/api/me/dashboard");
    assert.equal(d.status, 200);
    assert.ok(Array.isArray(d.json.toAct) && Array.isArray(d.json.initiated) && Array.isArray(d.json.tasks));
    const anon = await fetch(S.base + "/api/me/dashboard");
    assert.equal(anon.status, 401);
  });
});
