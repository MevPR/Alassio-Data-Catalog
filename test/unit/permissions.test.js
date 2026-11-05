import { describe, it, expect } from "vitest";
import { buildPerms, authorizeChanges, effOwnerId, effStewardId, effDomainId } from "../../permissions.js";

const cat = () => ({
  hubs: [{ id: "h1", name: "Health", dataHubs: [{ name: "GLOBAL", bpoId: "owen" }] }],
  domains: [{ id: "dm1", name: "Claims", stewardId: "gina" }],
  people: [{ id: "owen", name: "Owen Owner", email: "owen@x.io" }, { id: "gina", name: "Gina Steward", email: "gina@x.io" }, { id: "tia", name: "Tia", email: "tia@x.io" }],
  databases: [{ id: "d1", name: "GOLD", hubId: "h1", domainId: "dm1" }, { id: "d2", name: "OTHER", hubId: "h1" }],
  schemas: [{ id: "s1", databaseId: "d1", name: "partners" }, { id: "s2", databaseId: "d2", name: "x" }],
  tables: [{ id: "t1", schemaId: "s1", name: "loss_ratio" }, { id: "t2", schemaId: "s1", name: "special", stewardId: "tia", ownerId: null }, { id: "t3", schemaId: "s2", name: "foreign" }],
  attributes: [{ id: "a1", tableId: "t1", name: "lr" }], lineage: [], glossary: [],
});
const admin = { role: "admin", email: "a@x.io", name: "A" };
const owen = { role: "steward", email: "OWEN@x.io", name: "Owen Owner" };
const gina = { role: "steward", email: "gina@x.io", name: "Gina Steward" };
const tia = { role: "steward", email: "tia@x.io", name: "Tia" };
const nobody = { role: "steward", email: "n@x.io", name: "Nobody" };
const guest = { role: "guest", email: "gina@x.io", name: "Gina Steward" };

describe("inheritance", () => {
  it("owner inherits from hub, steward from domain, table override wins", () => {
    const c = cat();
    expect(effOwnerId(c, "table", "t1")).toBe("owen");   // BPO of the data hub at the top of the chain
    expect(effStewardId(c, "table", "t1")).toBe("gina");
    expect(effStewardId(c, "table", "t2")).toBe("tia");
    expect(effStewardId(c, "table", "t3")).toBe(null);
  });
});

describe("data domain inheritance", () => {
  it("inherits hub → database → schema → table with overrides and adjusts owners accordingly", () => {
    const c = cat();
    c.domains.push({ id: "dm2", name: "Pricing", ownerId: "tia" });
    c.hubs[0].domainId = "dm2";                 // type-level domain
    expect(effDomainId(c, "table", "t3")).toBe("dm2");   // d2 has no domain → hub domain
    expect(effDomainId(c, "table", "t1")).toBe("dm1");   // database override
    c.tables[0].domainId = "dm2";                // table override
    expect(effDomainId(c, "table", "t1")).toBe("dm2");
    expect(effStewardId(c, "table", "t1")).toBe(null);   // dm2 has no steward, dm1 no longer applies
    expect(effOwnerId(c, "table", "t3")).toBe("tia");    // the (inherited) domain owner precedes the data hub BPO
  });
});

describe("buildPerms", () => {
  it("guests never edit, even when they are stewards on paper", () => {
    const p = buildPerms(cat(), guest);
    expect(p.canEditTable("t1")).toBe(false);
    expect(p.canEditGlossary).toBe(false);
  });
  it("stewards edit only their tables; owners set stewards on their assets", () => {
    const g = buildPerms(cat(), gina), t = buildPerms(cat(), tia), o = buildPerms(cat(), owen), n = buildPerms(cat(), nobody);
    expect(g.canEditTable("t1")).toBe(true);   // domain steward inherited
    expect(g.canEditTable("t3")).toBe(false);  // other database, no responsibility
    expect(t.canEditTable("t2")).toBe(true);   // table override
    expect(t.canEditTable("t1")).toBe(false);
    expect(o.canSetSteward("table", "t3")).toBe(true);   // the data hub BPO inherits down to every table
    expect(g.canSetSteward("table", "t1")).toBe(false);  // steward is not owner
    expect(o.canSetOwner).toBe(false);                   // only admins
    expect(n.canEditGlossary).toBe(false);
    expect(g.canEditGlossary).toBe(true);
    expect(o.canEditStructure).toBe(false);
    expect(buildPerms(cat(), admin).canEditStructure).toBe(true);
  });
});

describe("authorizeChanges (server gate)", () => {
  const c = cat(); const t1 = c.tables[0];
  const upd = (rec, patch) => ({ entityType: "table", action: "updated", id: rec.id, before: rec, after: { ...rec, ...patch } });
  it("admin passes everything", () => { expect(authorizeChanges(c, admin, [upd(t1, { ownerId: "tia" })])).toEqual([]); });
  it("steward may edit own table but not set owner or steward", () => {
    expect(authorizeChanges(c, gina, [upd(t1, { description: "x" })])).toEqual([]);
    expect(authorizeChanges(c, gina, [upd(t1, { ownerId: "gina" })])[0].reason).toMatch(/only admins set data owners/);
    expect(authorizeChanges(c, gina, [upd(t1, { stewardId: "tia" })])[0].reason).toMatch(/data owner set the steward/);
  });
  it("owner may set the steward on own asset, also on a schema, but not change structure", () => {
    expect(authorizeChanges(c, owen, [upd(t1, { stewardId: "tia" })])).toEqual([]);
    const s1 = c.schemas[0];
    expect(authorizeChanges(c, owen, [{ entityType: "schema", action: "updated", id: "s1", before: s1, after: { ...s1, stewardId: "tia" } }])).toEqual([]);
    expect(authorizeChanges(c, owen, [{ entityType: "schema", action: "updated", id: "s1", before: s1, after: { ...s1, name: "renamed" } }])[0].reason).toMatch(/only admins change/);
    expect(authorizeChanges(c, owen, [{ entityType: "database", action: "created", id: "dx", after: { id: "dx", name: "new", hubId: "h1" } }])).toHaveLength(1);
  });
  it("lineage needs responsibility on either table; glossary needs any responsibility", () => {
    const edge = { entityType: "lineage", action: "created", id: "e1", after: { id: "e1", from: "t3", to: "t1" } };
    expect(authorizeChanges(c, gina, [edge])).toEqual([]);
    expect(authorizeChanges(c, nobody, [edge])).toHaveLength(1);
    const term = { entityType: "glossary_term", action: "created", id: "g1", after: { id: "g1", name: "X" } };
    expect(authorizeChanges(c, tia, [term])).toEqual([]);
    expect(authorizeChanges(c, nobody, [term])).toHaveLength(1);
  });
  it("owners/stewards may change Project tags on a schema but nothing else", () => {
    const s1 = c.schemas[0];
    expect(authorizeChanges(c, gina, [{ entityType: "schema", action: "updated", id: "s1", before: s1, after: { ...s1, kvTags: [{ key: "Project", value: "GenAI" }] } }])).toEqual([]);
    expect(authorizeChanges(c, nobody, [{ entityType: "schema", action: "updated", id: "s1", before: s1, after: { ...s1, kvTags: [{ key: "Project", value: "GenAI" }] } }])).toHaveLength(1);
    expect(authorizeChanges(c, gina, [{ entityType: "schema", action: "updated", id: "s1", before: s1, after: { ...s1, kvTags: [{ key: "Project", value: "GenAI" }], name: "x" } }])).toHaveLength(1);
  });
  it("attributes follow their table; unknown stewards are blocked from creating tables", () => {
    expect(authorizeChanges(c, gina, [{ entityType: "attribute", action: "created", id: "a9", after: { id: "a9", tableId: "t1", name: "n" } }])).toEqual([]);
    expect(authorizeChanges(c, tia, [{ entityType: "attribute", action: "created", id: "a9", after: { id: "a9", tableId: "t1", name: "n" } }])).toHaveLength(1);
    expect(authorizeChanges(c, gina, [{ entityType: "table", action: "created", id: "t9", after: { id: "t9", schemaId: "s2", name: "n" } }])).toHaveLength(1);
    expect(authorizeChanges(c, gina, [{ entityType: "table", action: "created", id: "t9", after: { id: "t9", schemaId: "s1", name: "n" } }])).toEqual([]);
  });
});
