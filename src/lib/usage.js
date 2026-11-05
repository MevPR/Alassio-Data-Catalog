/* Usage events (v1.58): views, searches and exports are reported fire-and-forget to /api/usage.
   The server collapses repeated views of the same object within ten minutes; searches are debounced here. */
import { apiBeacon } from "./api.js";
const post = (body) => apiBeacon("/api/usage", body);   /* keepalive, never rejects */

let lastView = "";
export const recordView = (entityType, entityId) => {
  if (!entityType || !entityId) return;
  const key = `${entityType}:${entityId}`;
  if (key === lastView) return;
  lastView = key;
  post({ kind: "view", entityType, entityId });
};
let searchTimer = null, lastSearch = "";
export const recordSearch = (term, delay = 900) => {
  const q = String(term || "").trim();
  clearTimeout(searchTimer);
  if (q.length < 2 || q.toLowerCase() === lastSearch) return;
  searchTimer = setTimeout(() => { lastSearch = q.toLowerCase(); post({ kind: "search", term: q }); }, delay);
};
export const recordExport = (entityType = null, entityId = null, term = null) => post({ kind: "export", entityType, entityId, term });
export const _resetUsageForTests = () => { lastView = ""; lastSearch = ""; clearTimeout(searchTimer); };
