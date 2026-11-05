/* Role vocabulary of the UI — one table since v1.72 (F-F5; before: four tables that had drifted apart). Every
   label, select option, precedence rank, chip colour and Governance-overview box is derived from ROLES below.
   The server's role model lives in server/config.js.
   key    — the stored role id
   label  — chip / summary text
   option — text in the role multi-select when it needs more than the label (special roles)
   hint   — workflow roles only: what the role does (Governance › Workflow roles box)
   rank   — precedence; the highest rank is the effective role (permissions follow it)
   chip   — chip colour class */
export const ROLES = [
  { key: "admin", label: "Admin", rank: 100, chip: "chip-brand" },
  { key: "steward", label: "Data Steward", rank: 60, chip: "chip-blue" },
  { key: "pm", label: "Project Manager", hint: "designs data products and drives them through the workflow", rank: 50, chip: "chip-amber" },
  { key: "ba", label: "Business Analyst / Req. Engineer", hint: "refines designs and documents the sourcing (phase 1)", rank: 40, chip: "chip-amber" },
  { key: "ingestion", label: "Data Ingestion", hint: "confirms the ingested tables (phase 2)", rank: 40, chip: "chip-amber" },
  { key: "dpd", label: "Development & Test / Sign-off", hint: "develops, tests and signs off (phase 3)", rank: 40, chip: "chip-amber" },
  { key: "guest", label: "Guest", option: "Guest · read-only", rank: 0, chip: "chip-grey" },
  { key: "agent", label: "Agent · MCP access", option: "Agent · MCP access, no governance role", rank: 0, chip: "chip-grey" },
];
export const ROLE_LABEL = Object.fromEntries(ROLES.map((r) => [r.key, r.label]));
/* options of the role multi-select: [key, text] */
export const ROLE_OPTIONS = ROLES.map((r) => [r.key, r.option || r.label]);
export const ROLE_RANK = Object.fromEntries(ROLES.map((r) => [r.key, r.rank]));
/* the four workflow roles of the data product design process (they carry a hint) */
export const WORKFLOW_ROLES = ROLES.filter((r) => r.hint);
/* roles an identity-provider group can grant (agents are technical accounts, never mapped from groups) */
export const GROUP_ROLE_KEYS = ROLES.filter((r) => r.key !== "agent").map((r) => r.key);
export const highestRole = (roles) => [...(roles || [])].sort((x, y) => (ROLE_RANK[y] ?? 0) - (ROLE_RANK[x] ?? 0))[0] || "guest";
export const rolesOf = (me) => (me ? (Array.isArray(me.roles) && me.roles.length ? me.roles : [me.role]) : []);
export const hasRole = (me, role) => rolesOf(me).includes(role);
const CHIP = Object.fromEntries(ROLES.map((r) => [r.key, r.chip]));
export const roleChip = (r) => CHIP[r] || "chip-grey";
