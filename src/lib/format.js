/* Display formatting shared by the components (v1.68 — formerly re-implemented per file). */
export const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n || 0} B`);
export const fmtTs = (ts) => (ts ? new Date(ts).toLocaleString() : "—");
export const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString() : "—");
