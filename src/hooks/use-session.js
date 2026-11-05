import { useEffect, useState } from "react";
import { apiGet, apiGetOr, apiPost, ApiError } from "../lib/api.js";

/* `?next=/oauth/authorize?…` — an MCP client's consent request that bounced through the login; go back once signed in */
const oauthNext = () => {
  try { const next = new URLSearchParams(window.location.search).get("next"); if (next && /^\/oauth\/authorize\?/.test(next)) { window.location.assign(next); return true; } } catch { }
  return false;
};

/* Signed-in user (`me`: undefined = loading, null = signed out) and the auth screen to show when signed out. */
export function useSession() {
  const [me, setMe] = useState(undefined);
  const [authScreen, setAuthScreen] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        let mine = null;
        try { mine = await apiGet("/auth/me"); } catch (e) { if (!(e instanceof ApiError)) throw e; }   /* refused → signed out; network error → login screen */
        if (mine) { if (oauthNext()) return; setMe(mine.user); return; }
        const params = new URLSearchParams(window.location.search);
        const inv = params.get("invite"), reset = params.get("reset");   /* v1.67: ?reset=<token> — a password-reset link */
        let needed = false, mode = "local", mail = false;
        const b = await apiGetOr("/auth/bootstrap-needed");
        if (b) { needed = b.needed; mode = b.mode || "local"; mail = !!b.mail; }
        setAuthScreen(inv ? { mode: "invite", token: inv } : reset ? { mode: "reset", token: reset, mail } : mode === "header" ? { mode: "header" } : needed ? { mode: "bootstrap" } : { mode: "login", mail });
        setMe(null);
      } catch {
        setAuthScreen({ mode: "login" });
        setMe(null);
      }
    })();
  }, []);
  const logout = async () => {
    try { await apiPost("/auth/logout"); } catch { }
    window.location.reload();
  };
  const onAuthed = (u) => {
    /* an OAuth consent (MCP client) that bounced through the login returns to /oauth/authorize?… once signed in */
    if (oauthNext()) return;
    setMe(u); try { window.history.replaceState({}, "", window.location.pathname); } catch { }
  };
  return { me, setMe, authScreen, logout, onAuthed };
}
