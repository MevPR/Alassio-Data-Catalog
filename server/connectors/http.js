/* Minimal HTTP transport for the native connectors (v1.60).
   Built on node:http/https so that `tlsVerify: false` (self-signed SAP/Kafka/Informatica endpoints) can be honoured
   per request — the global fetch cannot do that without an undici dispatcher. Returns a response shaped like the
   Python `requests` object the connectors were ported from: { status, ok, text, json() }. Injectable for tests. */
import http from "node:http";
import https from "node:https";
import dns from "node:dns/promises";
import { lookup as dnsLookup } from "node:dns";
import net from "node:net";

/* v1.66.1 (security review): the connectors never reach private, loopback or link-local addresses (cloud metadata
   endpoints, internal services) unless CONNECTORS_ALLOW_PRIVATE=1 — the admin's URL is resolved first and every
   resolved address is checked; the response body is capped and never echoed into error messages. */
const allowPrivate = () => process.env.CONNECTORS_ALLOW_PRIVATE === "1";
const MAX_BODY = Math.max(1 << 20, Number(process.env.CONNECTOR_MAX_BODY_BYTES || 64 * 1024 * 1024));
const privateV4 = (ip) => { const p = ip.split(".").map(Number); return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127); };
const privateV6 = (ip) => { const x = ip.toLowerCase(); return x === "::1" || x === "::" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80") || (x.startsWith("::ffff:") && privateV4(x.slice(7))); };
export const isPrivateAddress = (ip) => (net.isIPv4(ip) ? privateV4(ip) : net.isIPv6(ip) ? privateV6(ip) : true);
export const assertPublicTarget = async (target) => {
  if (allowPrivate()) return;
  const host = target.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) throw new ConnectorError(`${host}: internal addresses are not allowed`, 400);
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new ConnectorError(`${host}: name does not resolve`, 502);
  if (addrs.some(isPrivateAddress)) throw new ConnectorError(`${host}: internal addresses are not allowed`, 400);
};

/* v1.74 (F-S9 of the third review): the check above resolves the name once, the socket used to resolve it again — a
   DNS-rebinding server could answer with a public address first and a private one second. The socket now connects
   through this lookup, which applies the same rule to the addresses it actually uses. */
export const guardedLookup = (hostname, options, callback) => {
  const cb = typeof options === "function" ? options : callback;
  const opts = typeof options === "function" ? {} : (typeof options === "number" ? { family: options } : options || {});
  dnsLookup(hostname, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!allowPrivate() && addrs.some((a) => isPrivateAddress(a.address))) return cb(new ConnectorError(`${hostname}: internal addresses are not allowed`, 400));
    if (opts.all) return cb(null, addrs);
    const [first] = addrs;
    return first ? cb(null, first.address, first.family) : cb(Object.assign(new Error(`${hostname}: name does not resolve`), { code: "ENOTFOUND" }));
  });
};

export class ConnectorError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

const encodeParams = (params) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  return u.toString();
};

/* request(url, { method, headers, params, body, json, auth:{user,password}, bearer, tlsVerify, timeoutMs }) */
export async function request(url, opts = {}) {
  let target;
  try { target = new URL(url); } catch { throw new ConnectorError(`Invalid URL: ${url}`, 400); }
  if (target.protocol !== "http:" && target.protocol !== "https:") throw new ConnectorError(`Unsupported URL scheme: ${target.protocol}`, 400);
  await assertPublicTarget(target);
  if (opts.tlsVerify === false && process.env.CONNECTOR_ALLOW_INSECURE_TLS !== "1") throw new ConnectorError("Disabling TLS verification requires CONNECTOR_ALLOW_INSECURE_TLS=1 on the server", 400);
  return new Promise((resolve, reject) => {
    const qs = encodeParams(opts.params);
    if (qs) target.search = (target.search ? target.search + "&" : "?") + qs;
    const headers = { Accept: "application/json", "User-Agent": "cortex-data-catalog", ...(opts.headers || {}) };
    let payload = null;
    if (opts.json !== undefined) { payload = Buffer.from(JSON.stringify(opts.json)); headers["Content-Type"] = "application/json"; }
    else if (opts.form) { payload = Buffer.from(encodeParams(opts.form)); headers["Content-Type"] = "application/x-www-form-urlencoded"; }
    else if (opts.body !== undefined) payload = Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(String(opts.body));
    if (payload) headers["Content-Length"] = String(payload.length);
    if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
    else if (opts.auth && opts.auth.user) headers.Authorization = "Basic " + Buffer.from(`${opts.auth.user}:${opts.auth.password || ""}`).toString("base64");
    const mod = target.protocol === "http:" ? http : https;
    const req = mod.request(target, {
      method: opts.method || "GET", headers,
      rejectUnauthorized: opts.tlsVerify === false ? false : undefined,
      timeout: opts.timeoutMs || 120000,
      lookup: guardedLookup,
    }, (res) => {
      const chunks = []; let size = 0;
      res.on("data", (c) => { size += c.length; if (size > MAX_BODY) { req.destroy(new ConnectorError(`Response from ${target.host} exceeds ${Math.round(MAX_BODY / 1048576)} MB`)); return; } chunks.push(c); });
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString("utf8");
        resolve({
          status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 400, headers: res.headers, text, buffer: buf,
          json: () => { try { return JSON.parse(text); } catch { throw new ConnectorError(`Invalid JSON from ${target.host} (HTTP ${res.statusCode})`); } },
        });
      });
    });
    req.on("timeout", () => { req.destroy(new ConnectorError(`Timeout after ${Math.max(1, Math.round((opts.timeoutMs || 120000) / 1000))} s talking to ${target.host}`)); });
    req.on("error", (e) => reject(e instanceof ConnectorError ? e : new ConnectorError(`${target.host}: ${e.code || e.message}`)));
    if (payload) req.write(payload);
    req.end();
  });
}

/* A fake transport for tests: routes = [[substring | RegExp, handler(url, opts) → {status, body|text}], …] */
export const fakeTransport = (routes) => {
  const calls = [];
  const t = async (url, opts = {}) => {
    calls.push({ method: opts.method || "GET", url, opts });
    for (const [key, fn] of routes) {
      if (typeof key === "string" ? url.includes(key) : key.test(url)) {
        const r = typeof fn === "function" ? await fn(url, opts) : fn;
        const status = r.status || 200; const text = r.text !== undefined ? r.text : JSON.stringify(r.body === undefined ? {} : r.body);
        return { status, ok: status < 400, text, headers: {}, json: () => (r.body !== undefined ? r.body : JSON.parse(text)) };
      }
    }
    return { status: 404, ok: false, text: `no canned response for ${url}`, headers: {}, json: () => ({ error: `no canned response for ${url}` }) };
  };
  t.calls = calls;
  return t;
};
