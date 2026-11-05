/* Stable action functions (v1.71 — finding F-F1 of the second Clean Code review).

   The action hooks (structure, import/export, glossary, stewardship, …) build their functions as plain closures over
   the current state, so every render produces new function identities — which made the memoised CatalogContext
   change on every render. useStableCallbacks(fns) returns an object with the same keys whose functions never change
   identity and always call the latest implementation (no stale closures: a language switch or a new catalog version
   is seen by the next call). The set of keys must be the same on every render — it is, because each hook returns a
   fixed object literal. Values that are not functions are dropped; pass data through the context explicitly. */
import { useLayoutEffect, useMemo, useRef } from "react";

export function useStableCallbacks(fns) {
  const latest = useRef(fns);
  /* updated after render, before any event handler can run — calls always reach the newest closure */
  useLayoutEffect(() => { latest.current = fns; });
  const keys = Object.keys(fns).filter((k) => typeof fns[k] === "function");
  const signature = keys.join("|");
  return useMemo(() => Object.fromEntries(signature.split("|").filter(Boolean).map((k) => [k, (...args) => latest.current[k](...args)])), [signature]);
}
