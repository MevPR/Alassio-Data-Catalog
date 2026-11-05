/* v1.65 — handbook layer: figures, examples and tips exist in all six languages with identical structure */
import { describe, it, expect } from "vitest";
import { MANUAL, FIG_LABELS, MANUAL_UI, manualFor } from "../../src/help-manual.js";
import { FIGURES } from "../../src/help-figures.jsx";
import { helpChapters, CHAPTERS } from "../../src/help-chapters.js";
import { LANGS } from "../../src/i18n.jsx";
import { HELP } from "../../src/help-content.js";

const langs = LANGS.map(([l]) => l);
describe("help handbook content", () => {
  it("every language carries the same sections, figures, examples and tips", () => {
    const ref = MANUAL.en;
    for (const l of langs) {
      expect(Object.keys(MANUAL[l]).sort(), l).toEqual(Object.keys(ref).sort());
      for (const [idx, sec] of Object.entries(ref)) {
        const m = MANUAL[l][idx];
        expect(m.figures || [], `${l} ${idx} figures`).toEqual(sec.figures || []);
        expect(!!m.example, `${l} ${idx} example`).toBe(!!sec.example);
        if (sec.example) { expect(m.example.title.length).toBeGreaterThan(3); expect(m.example.body.length).toBeGreaterThan(40); }
        expect((m.tips || []).length, `${l} ${idx} tips`).toBe((sec.tips || []).length);
      }
      expect(Object.keys(FIG_LABELS[l]).sort()).toEqual(Object.keys(FIG_LABELS.en).sort());
      for (const fig of Object.keys(FIG_LABELS.en)) expect(Object.keys(FIG_LABELS[l][fig]).sort(), `${l} ${fig}`).toEqual(Object.keys(FIG_LABELS.en[fig]).sort());
      expect(Object.keys(MANUAL_UI[l]).sort()).toEqual(Object.keys(MANUAL_UI.en).sort());
    }
  });
  it("every referenced figure exists and every figure has labels; section indexes are valid and reachable from a chapter", () => {
    const used = new Set();
    for (const [idx, sec] of Object.entries(MANUAL.en)) {
      expect(Number(idx)).toBeLessThan(HELP.en.sections.length);
      expect(CHAPTERS.some((c) => c.sections.includes(Number(idx))), `section ${idx} in a chapter`).toBe(true);
      for (const f of sec.figures || []) { expect(FIGURES[f], f).toBeTruthy(); expect(FIG_LABELS.en[f], f).toBeTruthy(); used.add(f); }
    }
    expect([...used].sort()).toEqual(Object.keys(FIGURES).sort());   /* no orphan figures */
  });
  it("helpChapters merges the handbook extras into the sections", () => {
    const de = helpChapters("de");
    const hier = de.chapters.find((c) => c.id === "catalog").sections[0];
    expect(hier.figures).toEqual(["hierarchy", "layers"]); expect(hier.example.title).toMatch(/Data Hub/); expect(hier.tips).toHaveLength(3);
    expect(de.manual.handbook).toBe("Als Handbuch öffnen"); expect(de.figLabels.workflow.p1).toMatch(/Phase 1/);
    expect(manualFor("xx").ui).toBe(MANUAL_UI.en);
  });
});
