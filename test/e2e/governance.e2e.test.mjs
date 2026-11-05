/**
 * E2E — governance: steward permissions, description requests, stewardship (certify/review/attest/reminders), collaboration.
 * v1.73 (F-T6): split out of the former server.e2e.test.mjs. This file resets the test database, boots its own server
 * on port 3987 (E2E_PORT_BASE + 7), bootstraps the admin, seeds hub → e2e_gold → prod → kpi and removes it again.
 * Run alone: DB_USER=… DB_PASSWORD=… DB_NAME=datahub_catalog_test node --test test/e2e/governance.e2e.test.mjs
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { requireDb, startSuite, cleanupTree, signIn } from "./helpers.mjs";

let S;   /* the running suite: { base, c (cookie client), m (MCP client), hubName, seeded, stop } */
const req = (...a) => S.c.req(...a);
const tool = (...a) => S.m.tool(...a);

describe("E2E governance", { skip: requireDb() }, () => {
  before(async () => {
    S = await startSuite({ name: "governance" });
    /* a second schema so the steward test can also try to move a table into a foreign schema */
    assert.equal((await tool("create_schema", { database: `${S.hubName}/e2e_gold`, name: "stage" })).isError, false);
  });
  after(async () => { if (S) { await cleanupTree(S.m, S.hubName); await S.stop(); } });

  test("permissions: steward account is confined to its responsibilities", async () => {
    const stewardMail = `steward-${Date.now()}@example.com`;
    /* admin invites a steward and creates matching person records + responsibilities */
    const inv = await req("/admin/invite", { method: "POST", body: { email: stewardMail, role: "steward" } });
    assert.equal(inv.status, 200);
    const token = new URL(inv.json.link).searchParams.get("invite");
    assert.equal((await tool("create_table", { schema: "e2e_gold.prod", name: "mine", steward: "E2E Steward" })).isError, false);
    assert.equal((await tool("create_table", { schema: "e2e_gold.prod", name: "theirs" })).isError, false);
    let c = (await req("/api/catalog")).json.catalog;
    const person = c.people.find((x) => x.name === "E2E Steward");
    const adminCookie = S.c.cookie;
    const upd = { entityType: "person", action: "updated", id: person.id, before: person, after: { ...person, email: stewardMail } };
    assert.equal((await req("/api/catalog", { method: "PATCH", body: { baseVersion: 0, changes: [upd] } })).status, 200);
    /* switch to the steward */
    S.c.cookie = "";
    assert.equal((await req("/auth/accept-invite", { method: "POST", body: { token, name: "E2E Steward", password: "steward-pass-123" } })).status, 200);
    c = (await req("/api/catalog")).json.catalog;
    const mine = c.tables.find((t) => t.name === "mine"), theirs = c.tables.find((t) => t.name === "theirs");
    const ok = await req("/api/catalog", { method: "PATCH", body: { baseVersion: 0, changes: [{ entityType: "table", action: "updated", id: mine.id, before: mine, after: { ...mine, description: "steward edit" } }] } });
    assert.equal(ok.status, 200, "own table editable");
    const no = await req("/api/catalog", { method: "PATCH", body: { baseVersion: 0, changes: [{ entityType: "table", action: "updated", id: theirs.id, before: theirs, after: { ...theirs, description: "x" } }] } });
    assert.equal(no.status, 403, "foreign table blocked");
    const owner = await req("/api/catalog", { method: "PATCH", body: { baseVersion: 0, changes: [{ entityType: "table", action: "updated", id: mine.id, before: { ...mine, description: "steward edit" }, after: { ...mine, description: "steward edit", ownerId: person.id } }] } });
    assert.equal(owner.status, 403, "steward cannot set owner");
    const hub = c.hubs.find((h) => h.name === S.hubName);
    const structure = await req("/api/catalog", { method: "PATCH", body: { baseVersion: 0, changes: [{ entityType: "hub", action: "updated", id: hub.id, before: hub, after: { ...hub, description: "x" } }] } });
    assert.equal(structure.status, 403, "steward cannot change structure");
    /* v1.66.1 (security review): a record may not carry a foreign id, an attribute may not be re-parented onto the steward's
       table, and a table may not be moved into a foreign schema */
    const mineNow = (await req("/api/catalog")).json.catalog.tables.find((t) => t.id === mine.id);
    const hijack = await req("/api/catalog", { method: "PATCH", body: { baseVersion: 0, changes: [{ entityType: "table", action: "updated", id: mine.id, before: mineNow, after: { ...mineNow, id: theirs.id, description: "hijacked" } }] } });
    assert.equal(hijack.status, 409, JSON.stringify(hijack.json)); assert.match(JSON.stringify(hijack.json), /record id does not match/);
    assert.equal((await req("/api/catalog")).json.catalog.tables.find((t) => t.id === theirs.id).description, theirs.description || "", "foreign table untouched");
    const theirsAttr = { id: `at-${Date.now()}`, tableId: theirs.id, name: "secret_col", dataType: "STRING" };
    S.c.cookie = adminCookie;
    assert.equal((await req("/api/catalog", { method: "PATCH", body: { baseVersion: 0, changes: [{ entityType: "attribute", action: "created", id: theirsAttr.id, after: theirsAttr }] } })).status, 200);
    assert.equal((await signIn(S.c, stewardMail, "steward-pass-123")).status, 200);
    const reparent = await req("/api/catalog", { method: "PATCH", body: { baseVersion: 0, changes: [{ entityType: "attribute", action: "updated", id: theirsAttr.id, before: theirsAttr, after: { ...theirsAttr, tableId: mine.id } }] } });
    assert.equal(reparent.status, 403, "attribute of a foreign table cannot be moved onto the steward's table");
    const otherSchema = (await req("/api/catalog")).json.catalog.schemas.find((sc) => sc.id !== mineNow.schemaId);
    assert.ok(otherSchema, "the 'stage' schema seeded in before() is a foreign schema for the steward");
    if (otherSchema) {
      const move = await req("/api/catalog", { method: "PATCH", body: { baseVersion: 0, changes: [{ entityType: "table", action: "updated", id: mine.id, before: mineNow, after: { ...mineNow, schemaId: otherSchema.id } }] } });
      assert.equal(move.status, 403, "table cannot be moved into a foreign schema");
    }
    S.c.cookie = adminCookie;
  });

  test("request business descriptions: escalates steward → owner → admins", async () => {
    const c = (await req("/api/catalog")).json.catalog;
    const t = c.tables.find((x) => x.name === "kpi");
    const before = (await req("/api/messages")).json.messages.length;
    const r = await req("/api/messages/request-description", { method: "POST", body: { tableId: t.id, note: "e2e" } });
    assert.equal(r.status, 200);
    assert.ok(["steward", "owner", "admin"].includes(r.json.kind));
    if (r.json.kind === "admin") assert.ok((await req("/api/messages")).json.messages.length > before, "admins asked to name a data owner");
    const anon = await fetch(S.base + "/api/messages/request-description", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tableId: t.id }) });
    assert.equal(anon.status, 401);
  });

  test("stewardship: policy, MCP certify/review tools, owner-only attestation, reminders", async () => {
    const adminCookie = S.c.cookie;
    /* policy */
    assert.equal((await req("/api/stewardship/policy")).json.policy.attestDays, 180);
    assert.equal((await req("/admin/stewardship/policy", { method: "PUT", body: { attestDays: 90, remindEveryDays: 3 } })).json.policy.attestDays, 90);
    /* MCP: certify + review on the kpi table */
    const tbl = "e2e_gold.prod.kpi";
    assert.equal((await tool("create_table", { schema: "e2e_gold.prod", name: "kpi_v2" })).isError, false);
    let r = await tool("certify_table", { table: tbl, status: "deprecated", note: "use kpi_v2", successor: "e2e_gold.prod.kpi_v2" });
    assert.equal(r.isError, false, r.data);
    let det = (await tool("get_table", { table: tbl })).data;
    assert.deepEqual([det.certification.status, det.certification.note, det.certification.successor], ["deprecated", "use kpi_v2", "e2e_gold.prod.kpi_v2"]);
    assert.equal((await tool("certify_table", { table: tbl, status: "deprecated", successor: tbl })).isError, true, "self successor rejected");
    r = await tool("review_table", { table: tbl, cycle_days: 90, reviewed: false }); assert.equal(r.isError, false, r.data);
    det = (await tool("get_table", { table: tbl })).data;
    assert.equal(det.review.cycle_days, 90); assert.equal(det.review.status, "due");
    let tasks = (await tool("list_stewardship_tasks", {})).data;
    assert.ok(tasks.reviews_due.some((x) => x.table === tbl && x.status === "due")); assert.ok(tasks.deprecated.some((x) => x.table === tbl && x.successor === "e2e_gold.prod.kpi_v2"));
    r = await tool("certify_table", { table: tbl, status: "endorsed", note: "trusted" }); assert.equal(r.isError, false, r.data);
    det = (await tool("get_table", { table: tbl })).data;
    assert.equal(det.certification.status, "endorsed"); assert.equal(det.review.status, "ok", "endorsing counts as a review"); assert.equal(det.certification.by, "MCP Agent");
    /* read-scope keys cannot certify */
    const ro = await req("/admin/agents", { method: "POST", body: { name: "Reader Stew", scope: "read" } });
    assert.equal(ro.status, 200);
    const rr = await (await fetch(S.base + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ro.json.key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "certify_table", arguments: { table: tbl, status: "none" } } }) })).json();
    assert.equal(rr.result.isError, true); assert.match(rr.result.content[0].text, /read scope/);
    /* attestation: a steward account that is NOT the owner is refused, the owner (person matched by e-mail) is allowed */
    const cat = (await req("/api/catalog")).json;
    const kpi = cat.catalog.tables.find((t) => t.name === "kpi");
    const ownerMail = `owner-${Date.now()}@example.com`, stewMail = `stew-${Date.now()}@example.com`;
    const ownerPerson = { id: `p-own-${Date.now()}`, name: "Olaf Owner", email: ownerMail }, stewPerson = { id: `p-stw-${Date.now()}`, name: "Stella Steward", email: stewMail };
    let save = await req("/api/catalog", { method: "PATCH", body: { baseVersion: cat.version, changes: [
      { entityType: "person", action: "created", id: ownerPerson.id, after: ownerPerson }, { entityType: "person", action: "created", id: stewPerson.id, after: stewPerson },
      { entityType: "table", action: "updated", id: kpi.id, before: kpi, after: { ...kpi, ownerId: ownerPerson.id, stewardId: stewPerson.id } }] } });
    assert.equal(save.status, 200, JSON.stringify(save.json));
    const mk = async (mail) => { S.c.cookie = adminCookie; const inv = await req("/admin/invite", { method: "POST", body: { email: mail, role: "steward" } }); assert.equal(inv.status, 200); const token = new URL(inv.json.link).searchParams.get("invite");
      S.c.cookie = ""; assert.equal((await req("/auth/accept-invite", { method: "POST", body: { token, name: mail, password: "wf-pass-123" } })).status, 200); };
    await mk(ownerMail); await mk(stewMail);
    const login = async (mail) => { assert.equal((await signIn(S.c, mail, "wf-pass-123")).status, 200); };
    await login(stewMail);
    let cur = (await req("/api/catalog")).json; let t = cur.catalog.tables.find((x) => x.id === kpi.id);
    const attest = { entityType: "table", action: "updated", id: t.id, before: t, after: { ...t, ownerAttestedAt: Date.now(), ownerAttestedBy: "Stella" } };
    r = await req("/api/catalog", { method: "PATCH", body: { baseVersion: cur.version, changes: [attest] } });
    assert.equal(r.status, 403); assert.match(r.json.error, /only the data owner attests/);
    r = await req("/api/catalog", { method: "PATCH", body: { baseVersion: cur.version, changes: [{ ...attest, after: { ...t, lastReviewedAt: Date.now(), lastReviewedBy: "Stella" } }] } });
    assert.equal(r.status, 200, "the steward may review");
    await login(ownerMail);
    cur = (await req("/api/catalog")).json; t = cur.catalog.tables.find((x) => x.id === kpi.id);
    r = await req("/api/catalog", { method: "PATCH", body: { baseVersion: cur.version, changes: [{ entityType: "table", action: "updated", id: t.id, before: t, after: { ...t, ownerAttestedAt: Date.now(), ownerAttestedBy: "Olaf Owner" } }] } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    /* reminders: kpi_v2 gets a review cycle without a review → the owner (inherited) and steward get one message each */
    S.c.cookie = adminCookie;
    assert.equal((await tool("review_table", { table: "e2e_gold.prod.kpi_v2", cycle_days: 30, reviewed: false })).isError, false);
    cur = (await req("/api/catalog")).json; const v2 = cur.catalog.tables.find((x) => x.name === "kpi_v2");
    save = await req("/api/catalog", { method: "PATCH", body: { baseVersion: cur.version, changes: [{ entityType: "table", action: "updated", id: v2.id, before: v2, after: { ...v2, ownerId: ownerPerson.id, stewardId: stewPerson.id } }] } });
    assert.equal(save.status, 200);
    const rem = (await req("/admin/stewardship/remind", { method: "POST", body: { force: true } })).json;
    assert.ok(rem.reviews >= 1 && rem.messages >= 2, JSON.stringify(rem));
    await login(stewMail);
    const inbox = (await req("/api/messages")).json.messages;
    assert.ok(inbox.some((m) => /Stewardship: .*review/.test(m.subject) && m.body.includes("kpi_v2")), JSON.stringify(inbox.map((m) => m.subject)));
    /* v1.57: notifications arrive in the recipient's language — the owner switches to German and French is accepted too */
    await login(ownerMail);
    assert.equal((await req("/auth/me/lang", { method: "PATCH", body: { lang: "de" } })).json.lang, "de");
    assert.equal((await req("/auth/me/lang", { method: "PATCH", body: { lang: "fr" } })).json.lang, "fr");
    assert.equal((await req("/auth/me/lang", { method: "PATCH", body: { lang: "de" } })).json.lang, "de");
    S.c.cookie = adminCookie;
    const rem2 = (await req("/admin/stewardship/remind", { method: "POST", body: { force: true } })).json;
    assert.ok(rem2.messages >= 1);
    await login(ownerMail);
    const ownerInbox = (await req("/api/messages")).json.messages;
    assert.ok(ownerInbox.some((m) => /^Stewardship: .*(Review|Ownership-Bestätigung).*fällig/.test(m.subject) && /Fällige Reviews|Zu bestätigende Ownership/.test(m.body)), JSON.stringify(ownerInbox.map((m) => m.subject)));
    /* description requests to a German-speaking owner are German as well */
    S.c.cookie = adminCookie;
    const kpiNow = (await req("/api/catalog")).json.catalog.tables.find((x) => x.id === kpi.id);
    const ask = await req("/api/messages/request-description", { method: "POST", body: { tableId: kpiNow.id, note: "bitte" } });
    assert.equal(ask.status, 200, JSON.stringify(ask.json)); assert.equal(ask.json.kind, "steward");
    await login(stewMail);
    const stewInbox = (await req("/api/messages")).json.messages;
    assert.ok(stewInbox.some((m) => /^Please describe the attributes of/.test(m.subject) && m.body.includes("Note: bitte")), "steward keeps English (no language set)");
    S.c.cookie = adminCookie;
    assert.equal((await tool("delete_table", { table: "e2e_gold.prod.kpi_v2" })).isError, false);
    await req("/admin/stewardship/policy", { method: "PUT", body: { attestDays: 180, remindEveryDays: 7 } });
  });

  test("collaboration: comments, questions with notifications, answers, resolution, ratings, usage statistics, MCP tools", async () => {
    const adminCookie = S.c.cookie;
    const cat = (await req("/api/catalog")).json; const kpi = cat.catalog.tables.find((t) => t.name === "kpi"); const prod = cat.catalog.schemas.find((s) => s.id === kpi.schemaId);
    /* a steward account matched to the table's steward person + an asker (guest) */
    const stewMail = `collab-stew-${Date.now()}@example.com`, askMail = `collab-ask-${Date.now()}@example.com`;
    const stewPerson = { id: `p-cs-${Date.now()}`, name: "Cora Steward", email: stewMail };
    let save = await req("/api/catalog", { method: "PATCH", body: { baseVersion: cat.version, changes: [{ entityType: "person", action: "created", id: stewPerson.id, after: stewPerson },
      { entityType: "table", action: "updated", id: kpi.id, before: kpi, after: { ...kpi, stewardId: stewPerson.id } }] } });
    assert.equal(save.status, 200, JSON.stringify(save.json));
    const mk = async (mail, role, name) => { S.c.cookie = adminCookie; const inv = await req("/admin/invite", { method: "POST", body: { email: mail, role } }); const token = new URL(inv.json.link).searchParams.get("invite");
      S.c.cookie = ""; assert.equal((await req("/auth/accept-invite", { method: "POST", body: { token, name, password: "wf-pass-123" } })).status, 200); };
    await mk(stewMail, "steward", "Cora Steward"); await mk(askMail, "guest", "Al Asker");
    const login = async (mail) => { assert.equal((await signIn(S.c, mail, "wf-pass-123")).status, 200); };
    /* the guest views, rates, comments and asks */
    await login(askMail);
    assert.equal((await req("/api/usage", { method: "POST", body: { kind: "view", entityType: "table", entityId: kpi.id } })).json.ok, true);
    assert.equal((await req("/api/usage", { method: "POST", body: { kind: "view", entityType: "table", entityId: kpi.id } })).json.ok, false, "repeated view within 10 minutes is collapsed");
    assert.equal((await req("/api/usage", { method: "POST", body: { kind: "search", term: "KPI revenue" } })).json.ok, true);
    assert.equal((await req("/api/usage", { method: "POST", body: { kind: "bogus" } })).json.ok, false);
    assert.equal((await req("/api/collab/bogus/x")).status, 400);
    let r = await req(`/api/collab/table/${kpi.id}/rating`, { method: "PUT", body: { stars: 9 } }); assert.equal(r.status, 400);
    r = await req(`/api/collab/table/${kpi.id}/rating`, { method: "PUT", body: { stars: 4 } }); assert.equal(r.status, 200); assert.equal(r.json.rating.mine, 4); assert.equal(r.json.rating.count, 1);
    r = await req(`/api/collab/table/${kpi.id}/comments`, { method: "POST", body: { body: "   " } }); assert.equal(r.status, 400);
    r = await req(`/api/collab/table/${kpi.id}/comments`, { method: "POST", body: { body: "Handy table, refreshed nightly.", kind: "comment" } }); assert.equal(r.status, 200); const comment = r.json.comment; assert.equal(comment.kind, "comment");
    r = await req(`/api/collab/table/${kpi.id}/comments`, { method: "POST", body: { body: "Is revenue net or gross?", kind: "question" } });
    assert.equal(r.status, 200, JSON.stringify(r.json)); const question = r.json.comment; assert.equal(question.kind, "question"); assert.ok(r.json.notified >= 1, "the steward account (and the owner from the stewardship test) were notified");
    let col = (await req(`/api/collab/table/${kpi.id}`)).json;
    assert.equal(col.comments.length, 2); assert.equal(col.rating.avg, 4); assert.equal(col.usage.views30, 1); assert.equal(col.openQuestions.length, 1);
    /* the guest cannot edit or delete the steward's content, but their own */
    r = await req(`/api/collab/comments/${comment.id}`, { method: "PATCH", body: { body: "Handy table, refreshed nightly (edited)." } }); assert.equal(r.status, 200); assert.ok(r.json.comment.editedTs);
    const myQ = (await req("/api/collab/questions/open")).json; assert.equal(myQ.mine.length, 1); assert.equal(myQ.toAnswer.length, 0);
    /* the steward sees the question in the inbox and on the dashboard, answers it and resolves it */
    await login(stewMail);
    const inbox = (await req("/api/messages")).json.messages;
    assert.ok(inbox.some((m) => /^Question about e2e_gold\.prod\.kpi/.test(m.subject) && m.body.includes("net or gross")), JSON.stringify(inbox.map((m) => m.subject)));
    const stewQ = (await req("/api/collab/questions/open")).json; assert.equal(stewQ.toAnswer.length, 1); assert.equal(stewQ.toAnswer[0].path, "e2e_gold.prod.kpi");
    r = await req(`/api/collab/comments/${comment.id}`, { method: "DELETE" }); assert.equal(r.status, 403, "not the author");
    r = await req(`/api/collab/table/${kpi.id}/comments`, { method: "POST", body: { body: "Net revenue, after cancellations.", kind: "answer", parentId: question.id } });
    assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.comment.kind, "answer"); assert.equal(r.json.notified, 1, "the asker was notified");
    r = await req(`/api/collab/comments/${question.id}/resolve`, { method: "POST", body: {} }); assert.equal(r.status, 200); assert.ok(r.json.comment.resolvedTs);
    r = await req(`/api/collab/table/${kpi.id}/rating`, { method: "PUT", body: { stars: 2 } }); assert.equal(r.json.rating.count, 2); assert.equal(r.json.rating.avg, 3);
    await login(askMail);
    const askInbox = (await req("/api/messages")).json.messages;
    assert.ok(askInbox.some((m) => /^Answer to your question about e2e_gold\.prod\.kpi/.test(m.subject) && m.body.includes("Net revenue")), JSON.stringify(askInbox.map((m) => m.subject)));
    col = (await req(`/api/collab/table/${kpi.id}`)).json;
    const thread = col.comments.find((c) => c.id === question.id); assert.equal(thread.replies.length, 1); assert.equal(thread.replies[0].kind, "answer"); assert.equal(col.openQuestions.length, 0);
    r = await req(`/api/collab/table/${kpi.id}/rating`, { method: "PUT", body: { stars: null } }); assert.equal(r.json.rating.count, 1); assert.equal(r.json.rating.mine, null);
    /* discussions live on schemas (data products) too; usage top lists */
    r = await req(`/api/collab/schema/${prod.id}/comments`, { method: "POST", body: { body: "Great product." } }); assert.equal(r.status, 200);
    S.c.cookie = adminCookie;
    const top = (await req("/api/usage/top?days=30")).json;
    assert.ok(top.tables.some((x) => x.tableId === kpi.id && x.path === "e2e_gold.prod.kpi" && x.views === 1)); assert.ok(top.terms.some((x) => x.term === "kpi revenue")); assert.ok(top.totals.searches >= 1);
    assert.ok(top.topRated.some((x) => x.tableId === kpi.id && x.avg === 2));
    /* MCP: get_table carries rating + open questions; add_comment / list_open_questions / get_discussion */
    let det = (await tool("get_table", { table: "e2e_gold.prod.kpi" })).data; assert.equal(det.rating.count, 1); assert.equal(det.usage.views30, 1);
    let ac = await tool("add_comment", { table: "e2e_gold.prod.kpi", body: "Which currency?", kind: "question" }); assert.equal(ac.isError, false, ac.data); assert.equal(ac.data.kind, "question");
    const oq = (await tool("list_open_questions", {})).data; assert.ok(oq.some((x) => x.id === ac.data.id && x.path === "e2e_gold.prod.kpi" && x.asked_by === "MCP Agent"));
    det = (await tool("get_table", { table: "e2e_gold.prod.kpi" })).data; assert.equal(det.openQuestions.length, 1);
    const disc = (await tool("get_discussion", { table: "e2e_gold.prod.kpi" })).data; assert.equal(disc.threads.length, 3); assert.ok(disc.threads.some((t) => t.replies.length === 1));
    const ro = await req("/admin/agents", { method: "POST", body: { name: "Reader Collab", scope: "read" } });
    const rr = await (await fetch(S.base + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ro.json.key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "add_comment", arguments: { table: "e2e_gold.prod.kpi", body: "x" } } }) })).json();
    assert.equal(rr.result.isError, true, "add_comment is a write tool");
    /* usage purge (admin) */
    assert.equal((await req("/admin/usage/purge", { method: "POST", body: { keepDays: 400 } })).json.ok, true);
  });
});
