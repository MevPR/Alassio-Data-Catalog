/* v1.74 (F-S1 of the third review) — the dependency guards in eslint.config.js must really fire.
   In v1.72 a later config block silently replaced the domain and route guards (flat config merges per rule, not per
   pattern) and nothing noticed. This test lints virtual files at real paths through the project config: each
   forbidden import must produce a no-restricted-imports error, each allowed one must not. */
import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";

const eslint = new ESLint({ cwd: process.cwd() });
const restricted = async (filePath, code) => {
  const [res] = await eslint.lintText(code, { filePath });
  return res.messages.filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message);
};

describe("dependency guards", () => {
  const forbidden = [
    ["server/zz-probe.js", 'import { x } from "../mcp.js"; export default x;', /must not depend on mcp\.js/],
    ["server/zz-probe.js", 'import r from "./routes/sync.js"; export default r;', /must not import route modules/],
    ["server/zz-probe.js", 'import A from "../src/App.jsx"; export default A;', /only the pure modules of src\/lib/],
    ["server/connectors/zz-probe.js", 'import { x } from "../../mcp.js"; export default x;', /must not depend on mcp\.js/],
    ["server/routes/zz-probe.js", 'import r from "./sync.js"; export default r;', /must not import each other/],
    ["server/routes/zz-probe.js", 'import { api } from "../../src/lib/api.js"; export default api;', /only the pure modules/],
    ["mcp/tools/zz-probe.js", 'import r from "../../server/routes/sync.js"; export default r;', /never route modules/],
    ["mcp/zz-probe.js", 'import H from "../src/hooks/use-collab.js"; export default H;', /only the pure modules/],
    ["zz-probe.js", 'import { apiGet } from "./src/lib/api.js"; export default apiGet;', /only the pure modules/],
    ["src/lib/zz-probe.js", 'import { useState } from "react"; export default useState;', /no UI libraries/],
    ["src/lib/zz-probe.js", 'import { api } from "./api.js"; export default api;', /browser-only client modules/],
  ];
  it.each(forbidden)("%s: forbidden import is reported", async (file, code, msg) => {
    const msgs = await restricted(file, code);
    expect(msgs.some((m) => msg.test(m)), `${file}: ${msgs.join(" | ") || "no error"}`).toBe(true);
  });

  const allowed = [
    ["server/zz-probe.js", 'import { seed } from "../src/lib/model.js"; import { q } from "./db.js"; export default [seed, q];'],
    ["server/routes/zz-probe.js", 'import { q } from "../db.js"; export default q;'],
    ["mcp/tools/zz-probe.js", 'import { guessLayer } from "../../src/lib/model.js"; export default guessLayer;'],
    ["server.js", 'import { q } from "./server/db.js"; export default q;'],
  ];
  it.each(allowed)("%s: allowed import passes", async (file, code) => {
    expect(await restricted(file, code)).toEqual([]);
  });
});
