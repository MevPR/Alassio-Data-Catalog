/* v1.72 (F-T1) — the fetch stubs the component tests share (they were copied into nine files).
   okJson(body, status)     a Response-like object (ok follows the status)
   routeFetch(routes, fb, { calls })
                            vi.fn() that answers the first matching route: [RegExp | (url, opts) => bool, (url, opts) =>
                            body | [body, status]]; unmatched URLs get fb(url, opts) (default {}); with `calls` every
                            request is recorded as [url, method, parsed JSON body | null]
   appShellFetch({ me, catalog, routes, fallback, onPatch })
                            everything the signed-in App needs to boot (bootstrap check, /auth/me, /api/catalog) plus
                            the empty lists the dashboards, inbox and admin views ask for; `routes` come first */
import { vi } from "vitest";

export const okJson = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } });

const bodyOf = (b) => { if (typeof b !== "string") return null; try { return JSON.parse(b); } catch { return b; } };
export const routeFetch = (routes = [], fallback = () => ({}), { calls = null } = {}) => vi.fn(async (url, opts = {}) => {
  const u = String(url);
  calls?.push([u, opts.method || "GET", bodyOf(opts.body)]);
  for (const [match, answer] of routes) {
    if (typeof match === "function" ? match(u, opts) : match.test(u)) return okJson(...[].concat(answer(u, opts)));
  }
  return okJson(...[].concat(fallback(u, opts)));
});

export const EMPTY_LISTS = { requests: [], messages: [], unread: 0, users: [], invites: [], entries: [], toAct: [], initiated: [], tasks: [], personIds: [], keys: [], enabled: false, files: [] };

export const appShellFetch = ({ me, catalog, version = 1, lazy = false, routes = [], fallback = EMPTY_LISTS, onPatch = null } = {}) => routeFetch([
  ...routes,
  [/\/auth\/bootstrap-needed/, () => ({ needed: false })],
  [/\/auth\/me\/lang/, () => ({ lang: me?.lang || "en" })],
  [/\/auth\/me$/, () => (me ? { user: me } : [{}, 401])],
  [(u, o) => u.includes("/api/catalog") && o.method === "PATCH", (u, o) => { onPatch?.(JSON.parse(o.body)); return { ok: true, version: version + 1, applied: 1 }; }],
  [/\/api\/catalog/, () => ({ catalog, version, lazy })],
], () => (typeof fallback === "function" ? fallback() : fallback));
