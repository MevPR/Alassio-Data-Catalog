/* v1.78 — the product is company-neutral: no employer- or group-specific names, systems or brand colours in the code,
   the UI texts, the help or the tests (owner's decision of 2026-10-28). New deployments start with neutral example
   data hub types; existing catalogs keep theirs. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_HUBS, seed } from "../../src/lib/model.js";
import { defaultDesignHub } from "../../src/hooks/use-design-form.js";

const ROOT = process.cwd();
const SELF = path.join(ROOT, "test/unit/neutral-product.test.js");
const DIRS = ["src", "server", "mcp", "test", "inspector", "deploy", "docs", "public/docs"];
const FILES = ["README.md", "PLAN.md", "package.json", "index.html", "server.js", "mcp.js", "okf.js", "catalog-diff.js", "csv-import.js", "csv-export.js", "permissions.js", "uc-writeback.js"];
const SKIP = new Set(["node_modules", "dist", "venv", "__pycache__"]);
const walk = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(js|jsx|mjs|py|html|yaml|yml|conf|service|dot|md|bpmn)$/.test(e.name)) out.push(p);
  }
  return out;
};
/* names of a former employer, its group and internal systems, and the brand colours used before v1.78 */
/* v1.79.7 (owner, 2026-11-05, before making the repository public): any spelling of the former employer's name — also in
   host names and paths such as ergo.leanix.net or ergo-health/… — and the owner's personal name, also in PDF metadata */
const FORBIDDEN = [/\bergo\b/i, /\bMagnus\b/, /Reimann/, /\bDKV\b/, /Munich\s*Re/i, /\bITERGO\b/, /\bBDAP\b/, /zesar/i, /servpar/i, /HEALTH_DE_USR/, /\bINSURANCE\b/, /#EE003B/i, /#C40031/i, /#00538A/i, /#00516C/i, /cortex\.ergo|ergo\.example/i];

describe("company-neutral product", () => {
  it("no employer or group names, internal system names or foreign brand colours in code, texts, help and tests", () => {
    const files = [...DIRS.flatMap((d) => walk(path.join(ROOT, d))), ...FILES.map((f) => path.join(ROOT, f))].filter((f) => f !== SELF && fs.existsSync(f));
    expect(files.length).toBeGreaterThan(250);
    const hits = [];
    for (const f of files) {
      const lines = fs.readFileSync(f, "utf8").split("\n");
      lines.forEach((l, i) => { for (const re of FORBIDDEN) if (re.test(l)) hits.push(`${path.relative(ROOT, f)}:${i + 1} ${re}`); });
    }
    expect(hits).toEqual([]);
  });
  it("shipped PDFs carry no personal name or employer name in their metadata", () => {
    const pdfs = ["docs", "public/docs"].flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith(".pdf")).map((f) => path.join(ROOT, d, f)));
    expect(pdfs.length).toBeGreaterThanOrEqual(5);
    const hits = pdfs.filter((f) => /Magnus|Reimann|\bERGO\b/i.test(fs.readFileSync(f, "latin1"))).map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });
  it("a new catalog starts with neutral example hub types; the marketplace design defaults to the first non-SOURCE type", () => {
    expect(DEFAULT_HUBS.map((h) => h.name)).toEqual(["Finance", "HR", "Sales"]);   /* owner's choice: domains every company has */
    const s = seed();
    expect(s.hubs.map((h) => h.name)).toEqual(["Finance", "HR", "Sales", "SOURCE"]);
    expect(s.databases[0].hubId).toBe("sales");
    expect(s.people.every((p) => p.email.endsWith("@company.example"))).toBe(true);
    expect(defaultDesignHub([{ name: "SOURCE" }, { name: "Finance" }, { name: "Sales" }])).toBe("Finance");
    expect(defaultDesignHub([])).toBe("");
  });
});
