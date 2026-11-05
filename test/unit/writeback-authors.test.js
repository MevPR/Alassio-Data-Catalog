/* v1.77 — who owns a pending write-back change: the newest audit entry that touched one of the operation's source
   fields; "created" counts for every field; no trace → no author (admins may write those). */
import { describe, it, expect, vi, beforeEach } from "vitest";

const audit = vi.hoisted(() => ({ rows: [], calls: [] }));
vi.mock("../../server/db.js", () => ({ q: vi.fn(async (sql, params) => { audit.calls.push([sql, params]); const [type, ...ids] = params; return audit.rows.filter((r) => r.entity_type === type && ids.includes(r.entity_id)).sort((a, b) => b.ts - a.ts); }), sql: {}, pool: {} }));
const { attributeOps, mayWrite, pendingSummary } = await import("../../server/writeback-authors.js");

const row = (type, id, user, ts, action, fields) => ({ entity_type: type, entity_id: id, user_json: JSON.stringify(user), ts, action, changes_json: fields ? JSON.stringify(fields.map((f) => ({ field: f, from: null, to: "x" }))) : null });
const anna = { id: "u-anna", name: "Anna Weber", email: "anna@x.de" }, jonas = { id: "u-jonas", name: "Jonas Klein", email: "jonas@x.de" }, admin = { id: "u-admin", name: "Ada", email: "ada@x.de", role: "admin", roles: ["admin"] };

beforeEach(() => { audit.rows = []; audit.calls = []; });

describe("attributeOps", () => {
  it("picks the newest entry that changed one of the source fields; created counts for all fields; nothing → null", async () => {
    audit.rows = [
      row("table", "t1", anna, 100, "updated", ["description"]),
      row("table", "t1", jonas, 200, "updated", ["stewardId"]),
      row("attribute", "a1", jonas, 50, "created", null),
      row("person", "p1", admin, 300, "updated", ["email"]),
    ];
    const ops = [
      { label: "table desc", src: [{ type: "table", id: "t1", field: "description" }] },
      { label: "table steward", src: [{ type: "table", id: "t1", field: "stewardId" }, { type: "person", id: "p1", field: "name" }] },
      { label: "col sens", src: [{ type: "attribute", id: "a1", field: "sensitivity" }] },
      { label: "uc owner", src: [{ type: "database", id: "d", field: "ownerId" }, { type: "person", id: "p1", field: "email" }] },
      { label: "untouched", src: [{ type: "schema", id: "s9", field: "description" }] },
    ];
    await attributeOps(ops);
    expect(ops.map((o) => o.author?.name ?? null)).toEqual(["Anna Weber", "Jonas Klein", "Jonas Klein", "Ada", null]);
    expect(ops[1].author.ts).toBe(200);
    /* one query per entity type, ids batched */
    expect(audit.calls.map(([, p]) => p[0]).sort()).toEqual(["attribute", "database", "person", "schema", "table"]);
    expect(audit.calls.find(([, p]) => p[0] === "table")[1].slice(1)).toEqual(["t1"]);
  });
  it("a person's name change is attributed to the person's editor, not the table's", async () => {
    audit.rows = [row("table", "t1", anna, 100, "updated", ["ownerId"]), row("person", "p2", jonas, 400, "updated", ["name"])];
    const ops = [{ label: "owner tag", src: [{ type: "table", id: "t1", field: "ownerId" }, { type: "person", id: "p2", field: "name" }] }];
    await attributeOps(ops);
    expect(ops[0].author.id).toBe("u-jonas");
  });
});

describe("mayWrite / pendingSummary", () => {
  const ops = [
    { label: "a", author: { id: "u-anna", name: "Anna Weber", ts: 1 } },
    { label: "b", author: { id: "u-anna", name: "Anna Weber", ts: 2 } },
    { label: "c", author: { id: "u-jonas", name: "Jonas Klein", ts: 3 } },
    { label: "d", author: null },
  ];
  it("own changes always, unattributed only for admins, other users' never", () => {
    expect(ops.map((o) => mayWrite(o, anna))).toEqual([true, true, false, false]);
    expect(ops.map((o) => mayWrite(o, admin))).toEqual([false, false, false, true]);
    expect(ops.map((o) => mayWrite(o, { ...jonas, role: "steward" }))).toEqual([false, false, true, false]);
    expect(mayWrite(ops[3], null)).toBe(false);
  });
  it("summarises mine / others per author / unattributed / writable", () => {
    expect(pendingSummary(ops, anna)).toEqual({ mine: 2, unattributed: 1, others: [{ id: "u-jonas", name: "Jonas Klein", count: 1 }], writable: 2 });
    expect(pendingSummary(ops, admin)).toEqual({ mine: 0, unattributed: 1, others: [{ id: "u-anna", name: "Anna Weber", count: 2 }, { id: "u-jonas", name: "Jonas Klein", count: 1 }], writable: 1 });
  });
});
