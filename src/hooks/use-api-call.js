/* v1.72 (F-F4): the busy-key + flash-on-error wrapper that backups.jsx and sync-profiles.jsx each carried as a
   byte-identical `call()` helper. `call(key, url, opts, okMsg)` marks `key` busy, runs api(url, opts), flashes
   okMsg (a string or a function of the result), reloads via `load`, and returns the result — or flashes
   "Failed: {error}" and returns null. */
import { useState } from "react";
import { useToast } from "../toast-context.jsx";
import { api } from "../lib/api.js";

export function useApiCall(load) {
  const { flash } = useToast();
  const [busy, setBusy] = useState("");
  const call = async (key, url, opts, okMsg) => {
    setBusy(key);
    try {
      const j = await api(url, opts);
      if (okMsg) flash(typeof okMsg === "function" ? okMsg(j) : okMsg);
      await load?.();
      return j;
    } catch (e) { flash("Failed: {error}", { error: e.message }); return null; }
    finally { setBusy(""); }
  };
  return { busy, call };
}
