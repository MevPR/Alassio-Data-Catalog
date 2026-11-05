import { useEffect, useState } from "react";
import { apiGet } from "../lib/api.js";

/* server-side FULLTEXT ranking for queries of 3+ characters: { q, order: Map(id → rank), attributes: [records] } or null.
   The attribute records let a lazy (large) catalog show column hits the browser never loaded (v1.66). */
export function useServerSearch(query) {
  const [serverHits, setServerHits] = useState(null);
  useEffect(() => {
    const qq = query.trim();
    if (qq.length < 3) { setServerHits(null); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const j = await apiGet(`/api/search?q=${encodeURIComponent(qq)}&limit=200`, { signal: ctrl.signal });
        setServerHits({ q: qq, order: new Map(j.hits.map((h, i) => [h.id, i])), attributes: j.hits.filter((h) => h.type === "attribute" && h.record).map((h) => h.record) });
      } catch { setServerHits(null); }
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [query]);
  return serverHits;
}
