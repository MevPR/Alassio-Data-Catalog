/* v1.62 — translation audit as a permanent guard: every literal passed to t() / tr() / flash() / confirm() / prompt() in the UI sources has a
   translation in all five non-English dictionaries. Technical placeholders (host names, e-mails, class names, URLs, ids)
   are exempt. */
import { describe, it, expect } from "vitest";
import fs from "node:fs"; import path from "node:path";
import { dictionaryFor, LANGS } from "../../src/i18n.jsx";

const ROOT = path.resolve(import.meta.dirname, "../../src");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : /\.(jsx|js)$/.test(e.name) ? [path.join(d, e.name)] : []);
const technical = (k) => k.includes("@") || k.includes("://") || /^[a-z0-9.]+\.(jar|example\.com)$/.test(k) || /^[a-z0-9]{16}$/.test(k) || /^x{4,}/.test(k) || /^(com\.|org\.)/.test(k) || /^dapi/.test(k) || k === "Jane Doe" || k === "Sales Gold.churn_list (Churn list)" || k === "core, golden-record";

/* v1.73 (F-F9): helpers for the three implementation-independent patterns below */
const UI_FILES = () => walk(ROOT).filter((f) => !/i18n|help-|styles\.js/.test(path.basename(f)));
const lineOf = (src, i) => src.slice(0, i).split("\n").length;
/* string contents masked (same length) so parentheses inside literals do not count */
const mask = (line) => line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (m) => m[0] + "x".repeat(m.length - 2) + m[0]);
/* true when position `col` of `line` sits inside the argument list of t( / tr( / tn( / flash( / confirm( / prompt( on the
   same line — such literals are dictionary keys (checked for translations), not raw text */
const insideKeyCall = (line, col) => {
  const m = mask(line); let depth = 0;
  for (let i = col - 1; i >= 0; i--) {
    if (m[i] === ")") depth++;
    else if (m[i] === "(") { if (depth === 0) { if (/\b(?:t|tr|tn|flash|confirm|prompt)\s*$/.test(m.slice(0, i))) return true; } else depth--; }
  }
  return false;
};
/* `|| "No description yet."` fallbacks, `? "Abc" : "Def"` ternaries — both capitalised English — outside a key call */
const STR = String.raw`"([A-Z][a-z](?:[^"\\\n]|\\.)*)"`;   /* a capitalised double-quoted literal, escapes allowed */
const LITERAL_PATTERNS = [
  ["fallback", new RegExp(String.raw`\|\|\s*` + STR, "g")],
  ["ternary", new RegExp(String.raw`\?\s*` + STR + String.raw`\s*:\s*` + STR, "g")],
];
const unescape = (k) => k.replace(/\\"/g, '"');
/* a line may opt out with the marker  i18n: data  — for model values (e.g. the default sensitivity "Internal") that
   are stored, not shown as prose */
const dataLine = (line) => /i18n: data/.test(line);
const stripTemplate = (s) => { let prev; do { prev = s; s = s.replace(/\$\{[^{}]*\}/g, ""); } while (s !== prev); return s; };

describe("translation coverage", () => {
  it("every UI literal has a translation in de/pl/es/fr/it", () => {
    const keys = new Map();
    for (const f of walk(ROOT)) {
      if (/i18n|help-/.test(path.basename(f))) continue;
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/\b(?:t|tr|flash|confirm|prompt)\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*[,)]/g)) {   /* v1.70: confirm() / prompt() keys too */
        const k = (m[1] ?? m[2]).replace(/\\"/g, '"').replace(/\\'/g, "'");
        if (!technical(k)) keys.set(k, path.relative(ROOT, f));
      }
    }
    expect(keys.size).toBeGreaterThan(500);
    const missing = {};
    for (const [l] of LANGS) { if (l === "en") continue; const d = dictionaryFor(l); const m = [...keys.keys()].filter((k) => d[k] === undefined); if (m.length) missing[l] = m.map((k) => `${k}  (${keys.get(k)})`); }
    expect(missing).toEqual({});
  });
  /* v1.64.1: plain JSX text nodes (outside t()) slipped past the check above — flag any English sentence of three or
     more words that is rendered as-is. Brand names and code-like fragments are allowed. */
  it("no untranslated JSX text nodes of three or more words", () => {
    const allowed = /^(Alassio Data Catalog|COMPANY Group|Authorization: Bearer|Client config|Data Owner|Data Steward|Data Domain|MCP|URL|BPMN|UC|SQL)/;
    const found = [];
    for (const f of walk(ROOT)) {
      if (/i18n|help-|styles\.js/.test(path.basename(f))) continue;
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/(?:>|\})\s*([A-Z][a-z]+(?: [A-Za-z&/’'(),.+:-]+){2,}[^<{\n]*)(?=<|\{)/g)) {
        const txt = m[1].trim();
        if (allowed.test(txt) || /^[A-Z][A-Za-z]+ (size|className|style|value|onClick)=/.test(txt)) continue;
        found.push(`${path.relative(ROOT, f)}: ${txt.slice(0, 80)}`);
      }
    }
    expect(found).toEqual([]);
  });
  /* v1.73 (F-F9): three gaps the checks above could not see. Fallback and ternary literals inside a t()/flash()/… call
     on the same line are keys (they must be translated, see the last test); anywhere else they are rendered raw. */
  it("no raw `|| \"Text\"` fallbacks or `? \"Text\" : \"Text\"` ternaries outside t()", () => {
    const found = [];
    for (const f of UI_FILES()) {
      const src = fs.readFileSync(f, "utf8"); const lines = src.split("\n");
      for (const [kind, re] of LITERAL_PATTERNS) for (const m of src.matchAll(re)) {
        const ln = lineOf(src, m.index); const line = lines[ln - 1]; const col = m.index - src.lastIndexOf("\n", m.index - 1) - 1;
        if (/^\s*(\/\/|\/?\*)/.test(line) || dataLine(line) || insideKeyCall(line, col)) continue;
        if ([m[1], m[2]].filter(Boolean).every(technical)) continue;
        found.push(`${path.relative(ROOT, f)}:${ln} ${kind}: ${m[0].slice(0, 90)}`);
      }
    }
    expect(found).toEqual([]);
  });
  it("no untranslated title= / aria-label= texts (string or template literals)", () => {
    const found = [];
    for (const f of UI_FILES()) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/\b(?:title|aria-label)=(?:"([^"]*)"|\{\s*`([^`]*)`\s*\})/g)) {
        const text = m[1] !== undefined ? m[1] : stripTemplate(m[2]);
        if (!/[A-Za-z]{2,}/.test(text) || technical(text.trim())) continue;
        found.push(`${path.relative(ROOT, f)}:${lineOf(src, m.index)} ${m[0].slice(0, 90)}`);
      }
    }
    expect(found).toEqual([]);
  });
  it("fallback / ternary keys inside t()-calls and tn() singular / plural pairs are translated", () => {
    const keys = new Map();
    for (const f of UI_FILES()) {
      const src = fs.readFileSync(f, "utf8"); const lines = src.split("\n");
      for (const [, re] of LITERAL_PATTERNS) for (const m of src.matchAll(re)) {
        const ln = lineOf(src, m.index); const col = m.index - src.lastIndexOf("\n", m.index - 1) - 1;
        if (insideKeyCall(lines[ln - 1], col)) for (const k of [m[1], m[2]].filter(Boolean).map(unescape)) if (!technical(k)) keys.set(k, path.relative(ROOT, f));
      }
      for (const m of src.matchAll(/\btn\(\s*\[\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\]/g)) for (const k of [m[1], m[2]]) keys.set(k.replace(/\\"/g, '"'), path.relative(ROOT, f));
    }
    expect(keys.size).toBeGreaterThan(10);
    const missing = {};
    for (const [l] of LANGS) { if (l === "en") continue; const d = dictionaryFor(l); const m = [...keys.keys()].filter((k) => d[k] === undefined); if (m.length) missing[l] = m.map((k) => `${k}  (${keys.get(k)})`); }
    expect(missing).toEqual({});
  });
});
