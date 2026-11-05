/* One JSON API client for the UI (v1.68). Every call goes through window.fetch (so tests keep stubbing globalThis.fetch
   and the CSRF wrapper in csrf.js stays in the loop), parses the JSON body and turns a non-2xx answer into an Error
   carrying the server's `error` text, its `status` and an optional machine `code`. Components used to carry their own
   copy of this block — six variants; they now import from here. */
import { fileToBase64 } from "./download.js";

export class ApiError extends Error {
  constructor(message, status, code = null, body = null) { super(message); this.name = "ApiError"; this.status = status; this.code = code; this.body = body; }
}

const parse = async (r) => {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(j.error || `HTTP ${r.status}`, r.status, j.code || null, j);
  return j;
};

/* api(path, { method, body, headers, signal }) — body objects are JSON-encoded; a FormData/string body is sent as is */
export const api = async (path, { method = "GET", body, headers = {}, ...rest } = {}) => {
  const json = body !== undefined && body !== null && typeof body === "object" && !(body instanceof FormData) && !(body instanceof Blob);
  const r = await fetch(path, { method, headers: { ...(json || typeof body === "string" ? { "Content-Type": "application/json" } : {}), ...headers }, body: json ? JSON.stringify(body) : body, ...rest });
  return parse(r);
};
export const apiGet = (path, opts) => api(path, { ...opts, method: "GET" });
export const apiPost = (path, body, opts) => api(path, { ...opts, method: "POST", body: body ?? {} });
export const apiPut = (path, body, opts) => api(path, { ...opts, method: "PUT", body: body ?? {} });
export const apiPatch = (path, body, opts) => api(path, { ...opts, method: "PATCH", body: body ?? {} });
export const apiDelete = (path, opts) => api(path, { ...opts, method: "DELETE" });
/* a GET whose failure is not an error for the caller (optional data, polling): resolves to `fallback` instead of throwing */
export const apiGetOr = async (path, fallback = null) => { try { return await apiGet(path); } catch { return fallback; } };
/* v1.72: the text a caller shows for a failed call — the server's `error` when it sent one, `fallback` for a bare
   non-2xx answer (where callers used to show their own message instead of "HTTP 4xx"), else the thrown message */
export const errorText = (e, fallback) => (e instanceof ApiError ? (e.body?.error || fallback || e.message) : e?.message || fallback || String(e));
/* v1.72: fire-and-forget POST that survives page unload (usage events); never rejects */
export const apiBeacon = (path, body) => api(path, { method: "POST", body: body ?? {}, keepalive: true }).catch(() => {});

/* request attachments (marketplace workflow): the file travels base64-encoded in JSON, the server stores it in the database */
export const uploadRequestFile = async (requestId, file) => {
  const data = await fileToBase64(file);
  return (await apiPost(`/api/marketplace/requests/${requestId}/files`, { name: file.name, mime: file.type || "application/octet-stream", data })).file;
};
