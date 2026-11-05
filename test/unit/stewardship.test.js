import { describe, it, expect } from "vitest";
import { reviewStatus, nextReviewAt, attestationDue, stewardshipTasks, stewardshipKpis, DAY } from "../../src/lib/stewardship.js";
import { certifyTable, markTableReviewed, setReviewCycle, attestOwnership } from "../../src/lib/catalog-ops.js";
import { authorizeChanges } from "../../permissions.js";

const now = Date.UTC(2026, 8, 30);
const user = { id: "u1", name: "Jane Steward", email: "jane@x.de" };
const base = () => ({
  hubs: [{ id: "h", name: "Health", dataHubs: [{ name: "DE", bpoId: "p-bpo" }] }], domains: [{ id: "dm", name: "Claims", ownerId: "p-owner", stewardId: null }],
  people: [{ id: "p-owner", name: "Olaf Owner", email: "olaf@x.de" }, { id: "p-steward", name: "Jane Steward", email: "jane@x.de" }, { id: "p-bpo", name: "Bea BPO" }],
  databases: [{ id: "d", name: "GOLD", hubId: "h", country: "DE", domainId: "dm", ownerId: "p-owner" }], schemas: [{ id: "s", databaseId: "d", name: "claims" }],
  tables: [{ id: "t1", schemaId: "s", name: "fct_claims", stewardId: "p-steward", reviewCycleDays: 90, lastReviewedAt: now - 100 * DAY },
    { id: "t2", schemaId: "s", name: "dim_policy", reviewCycleDays: 365, lastReviewedAt: now - 10 * DAY }, { id: "t3", schemaId: "s", name: "stg_old", ownerId: "p-owner", reviewCycleDays: 30 }],
  attributes: [], lineage: [], glossary: [],
});

describe("stewardship helpers", () => {
  it("derives review status from cycle and last review", () => {
    const s = base();
    expect(reviewStatus(s.tables[0], now)).toBe("overdue");
    expect(reviewStatus(s.tables[1], now)).toBe("ok");
    expect(reviewStatus(s.tables[2], now)).toBe("due");
    expect(reviewStatus({ reviewCycleDays: 90, lastReviewedAt: now - 80 * DAY }, now)).toBe("soon");
    expect(reviewStatus({ name: "x" }, now)).toBe("none");
    expect(nextReviewAt(s.tables[0])).toBe(now - 10 * DAY);
  });
  it("attestation is due when never confirmed or older than the policy", () => {
    expect(attestationDue({ ownerId: "p" }, 180, now)).toBe(true);
    expect(attestationDue({ ownerId: "p", ownerAttestedAt: now - 10 * DAY }, 180, now)).toBe(false);
    expect(attestationDue({ ownerId: "p", ownerAttestedAt: now - 200 * DAY }, 180, now)).toBe(true);
    expect(attestationDue({ ownerAttestedAt: 0 }, 180, now)).toBe(false);   /* inherited owner: nothing to attest here */
  });
  it("lists the tasks of a person set with inherited responsibilities", () => {
    const s = base();
    const steward = stewardshipTasks(s, new Set(["p-steward"]), undefined, now);
    expect(steward.reviews.map((r) => [r.table.name, r.status])).toEqual([["fct_claims", "overdue"]]);
    expect(steward.attestations).toEqual([]);
    const owner = stewardshipTasks(s, new Set(["p-owner"]), { attestDays: 180, soonDays: 14 }, now);
    expect(owner.reviews.map((r) => r.table.name)).toEqual(["fct_claims", "stg_old"]);   /* domain owner inherits every table of the database */
    expect(owner.attestations.map((a) => `${a.kind}:${a.obj.name}`).sort()).toEqual(["database:GOLD", "domain:Claims", "table:stg_old"]);
    const k = stewardshipKpis(s, undefined, now);
    expect(k).toMatchObject({ endorsed: 0, deprecated: 0, withReviewCycle: 3, reviewsOverdue: 2, owned: 3, attestationsDue: 3 });
  });
});

describe("stewardship catalog ops", () => {
  it("endorses (counts as review), deprecates with successor, clears", () => {
    const s = base();
    certifyTable(s, "t3", "endorsed", { user, now });
    expect(s.tables[2]).toMatchObject({ certStatus: "endorsed", certifiedBy: "Jane Steward", certifiedAt: now, lastReviewedAt: now, lastReviewedBy: "Jane Steward" });
    expect(reviewStatus(s.tables[2], now)).toBe("ok");
    certifyTable(s, "t3", "deprecated", { user, now, note: "replaced", successorId: "t1" });
    expect(s.tables[2]).toMatchObject({ certStatus: "deprecated", certNote: "replaced", successorId: "t1" });
    expect(() => certifyTable(s, "t3", "deprecated", { successorId: "t3" })).toThrow(/own successor/);
    expect(() => certifyTable(s, "t3", "gold")).toThrow(/status/);
    certifyTable(s, "t3", "", {});
    expect(s.tables[2].certStatus).toBeUndefined(); expect(s.tables[2].successorId).toBeUndefined();
  });
  it("marks reviews, sets cycles and attests ownership", () => {
    const s = base();
    markTableReviewed(s, "t1", { user, now, note: "all good" });
    expect(s.tables[0]).toMatchObject({ lastReviewedAt: now, lastReviewedBy: "Jane Steward", lastReviewNote: "all good" });
    setReviewCycle(s, "t1", 180); expect(s.tables[0].reviewCycleDays).toBe(180);
    setReviewCycle(s, "t1", 0); expect(s.tables[0].reviewCycleDays).toBeUndefined();
    attestOwnership(s, "database", "d", { user: { name: "Olaf Owner" }, now });
    expect(s.databases[0]).toMatchObject({ ownerAttestedAt: now, ownerAttestedBy: "Olaf Owner" });
    attestOwnership(s, "table", "t1", { user, now });   /* no explicit owner → nothing to attest */
    expect(s.tables[0].ownerAttestedAt).toBeUndefined();
  });
});

describe("attestation permissions", () => {
  it("only the owner may attest; the steward may still edit the rest", () => {
    const s = base();
    const steward = { id: "u", name: "Jane Steward", email: "jane@x.de", role: "steward" };
    const owner = { id: "o", name: "Olaf Owner", email: "olaf@x.de", role: "steward" };
    const t3 = s.tables[2];
    const attest = { entityType: "table", action: "updated", id: "t3", before: t3, after: { ...t3, ownerAttestedAt: now, ownerAttestedBy: "x" } };
    expect(authorizeChanges(s, steward, [attest]).map((v) => v.reason)).toEqual(["only the data owner attests ownership"]);
    expect(authorizeChanges(s, owner, [attest])).toEqual([]);
    const t1 = s.tables[0];   /* jane is the steward of t1: reviewing and endorsing are hers, attesting is not */
    expect(authorizeChanges(s, steward, [{ entityType: "table", action: "updated", id: "t1", before: t1, after: { ...t1, lastReviewedAt: now, certStatus: "endorsed" } }])).toEqual([]);
    expect(authorizeChanges(s, steward, [{ entityType: "table", action: "updated", id: "t3", before: t3, after: { ...t3, lastReviewedAt: now } }]).map((v) => v.reason)).toEqual(["not owner/steward of this table"]);
  });
  it("lets an owner attest a database or domain although structure changes are admin-only", () => {
    const s = base();
    const owner = { id: "o", name: "Olaf Owner", email: "olaf@x.de", role: "steward" };
    const d = s.databases[0];
    expect(authorizeChanges(s, owner, [{ entityType: "database", action: "updated", id: "d", before: d, after: { ...d, ownerAttestedAt: now, ownerAttestedBy: "Olaf Owner" } }])).toEqual([]);
    expect(authorizeChanges(s, owner, [{ entityType: "database", action: "updated", id: "d", before: d, after: { ...d, ownerAttestedAt: now, name: "renamed" } }]).length).toBe(1);
    const dm = s.domains[0];
    expect(authorizeChanges(s, owner, [{ entityType: "domain", action: "updated", id: "dm", before: dm, after: { ...dm, ownerAttestedAt: now } }])).toEqual([]);
  });
});
