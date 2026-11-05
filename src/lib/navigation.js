/* Navigation vocabulary of the UI (v1.71 — finding F-F2/F-F10 of the second Clean Code review): the view names the
   main switch knows, the tabs of the table page and the keys of the expandable tree nodes. Every jump goes through
   useNavigation().openRef(ref) — a ref is { type, id } plus an optional `tab` for tables; an unknown tab falls back
   to the first one, so a typo can never leave a blank table page again. */

/* views of the main switch (src/views/main.jsx); "catalog" shows the selected object */
export const VIEWS = ["catalog", "governance", "lineage", "glossary", "marketplace", "mydash", "dpstatus", "users", "audit", "inbox", "backups"];

/* tabs of the table page, in display order */
export const TABLE_TABS = ["technical", "business", "lineage", "governance", "discussion"];
export const DEFAULT_TABLE_TAB = TABLE_TABS[0];
export const isTableTab = (tab) => TABLE_TABS.includes(tab);
/* the tab a jump may ask for; anything unknown (or nothing) lands on the first tab */
export const tableTabOr = (tab, fallback = DEFAULT_TABLE_TAB) => (isTableTab(tab) ? tab : fallback);

/* keys of the expandable nodes of the catalog tree — one spelling for the tree and for the auto-expand effect */
export const treeKey = {
  hub: (hubId) => `hub:${hubId}`,
  country: (hubId, country) => `co:${hubId}:${country || "GLOBAL"}`,
  db: (dbId) => `db:${dbId}`,
  schema: (schemaId) => `sc:${schemaId}`,
};
