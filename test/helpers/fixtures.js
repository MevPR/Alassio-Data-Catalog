/* v1.72 (F-T1) — fixtures several component tests share */
export const adminUser = (over = {}) => ({ id: "u", name: "Tester", email: "t@x.io", role: "admin", roles: ["admin"], ...over });
export const emptyCatalog = (over = {}) => ({ hubs: [{ id: "h", name: "Health" }], databases: [], schemas: [], tables: [], attributes: [], domains: [], people: [], lineage: [], glossary: [], ...over });
