/* v1.73 (F-F13) — the assignment fields a create / edit dialog offers, moved from the UI's modal host into
   permissions.js (pure functions next to the rules the server enforces). */
import { describe, it, expect } from "vitest";
import { buildPerms, entityDialogPerms, glossaryDialogPerms } from "../../permissions.js";

const cat = () => ({
  hubs: [{ id: "h1", name: "Health", dataHubs: [] }],
  domains: [], people: [{ id: "owen", name: "Owen Owner", email: "owen@x.io" }, { id: "tia", name: "Tia", email: "tia@x.io" }],
  databases: [{ id: "d1", name: "GOLD", hubId: "h1", ownerId: "owen" }, { id: "d2", name: "OTHER", hubId: "h1" }],
  schemas: [{ id: "s1", databaseId: "d1", name: "partners" }, { id: "s2", databaseId: "d2", name: "x" }],
  tables: [{ id: "t1", schemaId: "s1", name: "loss_ratio" }, { id: "t2", schemaId: "s2", name: "foreign", stewardId: "tia" }],
  attributes: [], lineage: [], glossary: [],
});
const admin = { role: "admin", email: "a@x.io", name: "A" };
const owen = { role: "steward", email: "owen@x.io", name: "Owen Owner" };
const tia = { role: "steward", email: "tia@x.io", name: "Tia" };
const guestOwen = { role: "guest", email: "owen@x.io", name: "Owen Owner" };

describe("entityDialogPerms", () => {
  it("admins may set owner, steward and domain everywhere", () => {
    const p = buildPerms(cat(), admin);
    for (const dialog of [{ kind: "hub" }, { kind: "table", parentId: "s2" }, { kind: "table", edit: { id: "t2" } }, { kind: "domain" }])
      expect(entityDialogPerms(p, dialog)).toEqual({ canSetOwner: true, canSetSteward: true, canSetDomain: true });
  });
  it("a new table or schema gets a steward from the owner of its parent; other new objects only from admins", () => {
    const p = buildPerms(cat(), owen);
    expect(entityDialogPerms(p, { kind: "table", parentId: "s1" })).toEqual({ canSetOwner: false, canSetSteward: true, canSetDomain: true });
    expect(entityDialogPerms(p, { kind: "schema", parentId: "d1" })).toEqual({ canSetOwner: false, canSetSteward: true, canSetDomain: false });
    expect(entityDialogPerms(p, { kind: "table", parentId: "s2" })).toEqual({ canSetOwner: false, canSetSteward: false, canSetDomain: false });
    expect(entityDialogPerms(p, { kind: "attribute", parentId: "t1" }).canSetSteward).toBe(false);
  });
  it("editing follows the owner of the object; a steward is not an owner; a guest never sets a steward", () => {
    expect(entityDialogPerms(buildPerms(cat(), owen), { kind: "table", edit: { id: "t1" } })).toEqual({ canSetOwner: false, canSetSteward: true, canSetDomain: true });
    expect(entityDialogPerms(buildPerms(cat(), tia), { kind: "table", edit: { id: "t2" } })).toEqual({ canSetOwner: false, canSetSteward: false, canSetDomain: false });
    const g = entityDialogPerms(buildPerms(cat(), guestOwen), { kind: "table", edit: { id: "t1" } });
    expect(g.canSetSteward).toBe(false); expect(g.canSetDomain).toBe(true);   /* the domain field mirrors isOwner (the server gate decides the save) */
    expect(entityDialogPerms(buildPerms(cat(), owen), { kind: "schema", edit: { id: "s1" } }).canSetDomain).toBe(false);   /* domain is a table-level field */
  });
  it("tolerates a missing dialog descriptor", () => {
    expect(entityDialogPerms(buildPerms(cat(), owen))).toEqual({ canSetOwner: false, canSetSteward: false, canSetDomain: false });
  });
});

describe("glossaryDialogPerms", () => {
  it("a new term may name its steward; an existing one only admins or its owner", () => {
    const p = buildPerms(cat(), owen);
    expect(glossaryDialogPerms(p, null)).toEqual({ canSetOwner: false, canSetSteward: true });
    expect(glossaryDialogPerms(p, { id: "g1", ownerId: "owen" }).canSetSteward).toBe(true);
    expect(glossaryDialogPerms(p, { id: "g2", ownerId: "tia" }).canSetSteward).toBe(false);
    expect(glossaryDialogPerms(p, { id: "g3" }).canSetSteward).toBe(false);
    expect(glossaryDialogPerms(buildPerms(cat(), admin), { id: "g2", ownerId: "tia" })).toEqual({ canSetOwner: true, canSetSteward: true });
  });
});
