import { useEffect, useRef, useState } from "react";
import { apiGetOr } from "../lib/api.js";

/* unread inbox counter, polled once a minute while signed in */
export function useUnread(me) {
  const [unread, setUnread] = useState(0);
  const refreshRef = useRef(null);
  useEffect(() => {
    if (!me) return;
    let stop = false;
    const tick = async () => { const j = await apiGetOr("/api/messages"); if (j && !stop) setUnread(j.unread || 0); };
    refreshRef.current = tick;
    tick(); const iv = setInterval(tick, 60000);
    return () => { stop = true; clearInterval(iv); };
  }, [me]);
  return { unread, setUnread, refreshUnread: () => refreshRef.current?.() };
}
