/* v1.60 — the node:http transport behind the native connectors, against a throw-away local server */
process.env.CONNECTORS_ALLOW_PRIVATE = "1";   /* the test server listens on loopback (the v1.66.1 SSRF guard would block it) */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { request, ConnectorError, guardedLookup } from "../../server/connectors/http.js";

let srv, base; const seen = [];
beforeAll(async () => {
  srv = http.createServer((req, res) => {
    const chunks = []; req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (req.url.startsWith("/slow")) return setTimeout(() => { res.end("late"); }, 400);
      if (req.url.startsWith("/xml")) { res.setHeader("Content-Type", "application/xml"); return res.end("<a/>"); }
      if (req.url.startsWith("/deny")) { res.statusCode = 401; return res.end("nope"); }
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ ok: true, url: req.url, body }));
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
afterAll(() => new Promise((r) => srv.close(r)));

describe("connector http transport", () => {
  it("sends basic auth, bearer, query params, JSON and form bodies", async () => {
    const r = await request(`${base}/x?a=1`, { params: { q: "core.classType:T AND x:\"y\"", offset: 0, pageSize: 100, empty: "" }, auth: { user: "u", password: "p" } });
    expect(r.ok).toBe(true); expect(r.json().url).toBe("/x?a=1&q=core.classType%3AT+AND+x%3A%22y%22&offset=0&pageSize=100");
    expect(seen.at(-1).headers.authorization).toBe("Basic " + Buffer.from("u:p").toString("base64"));
    await request(`${base}/j`, { method: "POST", json: { workspaces: ["w1"] }, bearer: "tok" });
    expect(seen.at(-1)).toMatchObject({ method: "POST", body: '{"workspaces":["w1"]}' }); expect(seen.at(-1).headers["content-type"]).toBe("application/json"); expect(seen.at(-1).headers.authorization).toBe("Bearer tok");
    await request(`${base}/f`, { method: "POST", form: { grant_type: "client_credentials", scope: "https://a/.default" } });
    expect(seen.at(-1).body).toBe("grant_type=client_credentials&scope=https%3A%2F%2Fa%2F.default"); expect(seen.at(-1).headers["content-type"]).toBe("application/x-www-form-urlencoded");
  });
  it("returns status/text for non-JSON and error responses and raises ConnectorError on timeout / bad JSON / bad host", async () => {
    const x = await request(`${base}/xml`, { headers: { Accept: "application/xml" } });
    expect(x.text).toBe("<a/>"); expect(() => x.json()).toThrow(ConnectorError); expect(seen.at(-1).headers.accept).toBe("application/xml");
    const d = await request(`${base}/deny`); expect(d.ok).toBe(false); expect(d.status).toBe(401); expect(d.text).toBe("nope");
    await expect(request(`${base}/slow`, { timeoutMs: 100 })).rejects.toThrow(/Timeout after 1 s/);
    await expect(request("http://127.0.0.1:1/", { timeoutMs: 1000 })).rejects.toThrow(/ECONNREFUSED/);
    await expect(request("not a url")).rejects.toMatchObject({ status: 400 });
  });
});

/* v1.74 (F-S9): the socket resolves through the guarded lookup, so a rebinding answer cannot reach a private address */
describe("guarded DNS lookup", () => {
  const look = (host, opts) => new Promise((resolve) => guardedLookup(host, opts, (err, addr, family) => resolve({ err, addr, family })));
  it("refuses private answers unless CONNECTORS_ALLOW_PRIVATE=1, in both callback shapes", async () => {
    const saved = process.env.CONNECTORS_ALLOW_PRIVATE;
    try {
      delete process.env.CONNECTORS_ALLOW_PRIVATE;
      const one = await look("localhost", {});
      expect(one.err).toBeInstanceOf(ConnectorError);
      expect(one.err.message).toMatch(/internal addresses are not allowed/);
      expect((await look("localhost", { all: true })).err).toBeInstanceOf(ConnectorError);
      process.env.CONNECTORS_ALLOW_PRIVATE = "1";
      const ok = await look("localhost", {});
      expect(ok.err).toBeNull(); expect(["127.0.0.1", "::1"]).toContain(ok.addr);
      const all = await look("localhost", { all: true });
      expect(Array.isArray(all.addr)).toBe(true);
    } finally { process.env.CONNECTORS_ALLOW_PRIVATE = saved; }
  });
  it("requests by host name connect through it", async () => {
    const port = new URL(base).port;
    const r = await request(`http://localhost:${port}/by-name`);
    expect(r.status).toBe(200);
  });
});
