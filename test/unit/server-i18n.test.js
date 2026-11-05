import { describe, it, expect } from "vitest";
import { renderMessage, statusText, STATUS_TEXT_L10N, count } from "../../server/i18n.js";
import { STATUS_TEXT } from "../../server/design-workflow.js";
import { UI_LANGS } from "../../server/config.js";
import { LANGS } from "../../src/i18n.jsx";
import { HELP } from "../../src/help-content.js";
import { dictionaryFor } from "../../src/i18n.jsx";

const LANGS6 = ["en", "de", "pl", "es", "fr", "it"];
describe("server-side notification texts", () => {
  it("renders every message key in every language with the parameters filled in", () => {
    const params = { requester: "Anna", path: "GOLD.claims.fct", n: 12, note: "please", name: "Claims Product", hub: "Health", product: "GOLD › claims", purpose: "reporting", status: "owner_review", reason: "", review: true,
      reviews: [{ path: "GOLD.claims.fct", status: "overdue", nextAt: Date.UTC(2026, 0, 15) }], attestations: [{ kind: "database", path: "GOLD", lastAt: null }] };
    for (const key of ["describe_attrs_steward", "assign_steward_owner", "name_owner_admin", "design_submitted", "design_refine", "access_request", "access_decided", "design_status", "stewardship_reminder"]) {
      const seen = new Set();
      for (const l of LANGS6) {
        const m = renderMessage(key, l, params);
        expect(m.subject.length).toBeGreaterThan(5); expect(m.body.length).toBeGreaterThan(10);
        expect(m.subject + m.body).not.toMatch(/undefined|\[object/);
        seen.add(m.subject);
      }
      expect(seen.size, `${key} should differ between languages`).toBeGreaterThanOrEqual(5);
    }
    expect(renderMessage("design_status", "de", params).subject).toBe("Datenprodukt „Claims Product“: wartet auf die Freigabe des Data Owners");
    expect(renderMessage("stewardship_reminder", "fr", params).body).toMatch(/revue en retard depuis le 15\/01\/2026/);
    expect(renderMessage("stewardship_reminder", "it", params).body).toMatch(/database GOLD — mai confermata/);
    expect(renderMessage("access_decided", "xx", { product: "P", status: "approved" }).subject).toBe("Your access request is approved");   /* unknown language → English */
    expect(() => renderMessage("nope", "en", {})).toThrow(/unknown message key/);
  });
  it("keeps the workflow status texts complete for all six languages", () => {
    const keys = Object.keys(STATUS_TEXT_L10N.en);
    for (const l of LANGS6) { expect(UI_LANGS).toContain(l); for (const k of keys) expect(statusText(l, k), `${l}.${k}`).toBeTruthy(); }
    expect(statusText("pl", "done")).toBe("zakończony"); expect(statusText("de", "nope")).toBe("nope");
    expect(STATUS_TEXT).toBe(STATUS_TEXT_L10N.en);   /* v1.70: the workflow module no longer keeps its own English copy */
  });
  it("v1.70: one pluralisation helper; reminder and drift subjects use it; drift bodies follow the language argument", () => {
    expect(count(1, "review", "reviews")).toBe("1 review"); expect(count(3, "review", "reviews")).toBe("3 reviews"); expect(count(1, "difference", "differences", { plus: true })).toBe("1+ differences");
    const rem = { reviews: [{ path: "A", status: "overdue", nextAt: 0 }], attestations: [{ kind: "database", path: "GOLD", lastAt: null }, { kind: "schema", path: "GOLD.s", lastAt: null }] };
    expect(renderMessage("stewardship_reminder", "en", rem).subject).toBe("Stewardship: 1 review due, 2 ownership attestations due");
    expect(renderMessage("stewardship_reminder", "de", rem).subject).toBe("Stewardship: 1 Review fällig, 2 Ownership-Bestätigungen fällig");
    expect(renderMessage("stewardship_reminder", "it", { ...rem, attestations: [] }).subject).toBe("Stewardship: 1 revisione in scadenza");
    const drift = { profile: "nightly", catalog: "main", mode: "report", items: [{ path: "s.t", kind: "newTable" }, { path: "s.t.c", kind: "changedType", from: "int", to: "string" }], more: 0 };
    expect(renderMessage("uc_drift", "en", drift).subject).toBe("Unity Catalog drift: main (2 differences)");
    expect(renderMessage("uc_drift", "de", { ...drift, items: drift.items.slice(0, 1), more: 5 }).subject).toBe("Unity-Catalog-Abweichung: main (1+ Unterschiede)");
    expect(renderMessage("uc_drift", "fr", drift).body).toMatch(/- s\.t: nouvelle table/); expect(renderMessage("uc_drift", "fr", drift).body).toMatch(/type modifié \(int → string\)/);
  });
});

describe("UI languages", () => {
  it("offers six languages with complete dictionaries and help texts", () => {
    expect(LANGS.map(([k]) => k)).toEqual(LANGS6);
    const en = HELP.en.sections.length;
    for (const l of LANGS6) { expect(Object.keys(HELP[l] || {})).toContain("sections"); expect(HELP[l].sections.length).toBe(en); }
    const fr = dictionaryFor("fr"), it = dictionaryFor("it"), de = dictionaryFor("de");
    for (const k of Object.keys(de)) { expect(fr[k], `fr: ${k}`).toBeTruthy(); expect(it[k], `it: ${k}`).toBeTruthy(); }
    expect(fr["My Dashboard"]).toBe("Mon tableau de bord"); expect(it["Backups & jobs"]).toBe("Backup e job"); expect(de["Stewardship tasks"]).toBe("Stewardship-Aufgaben");
  });
});

describe("help chapters (v1.62)", () => {
  it("compose every feature section exactly once per language and carry a guide for every role", async () => {
    const { helpChapters, CHAPTERS, ROLE_IDS } = await import("../../src/help-chapters.js");
    const used = CHAPTERS.flatMap((c) => c.sections);
    expect(new Set(used).size).toBe(used.length);
    expect([...used].sort((a, b) => a - b)).toEqual(HELP.en.sections.map((_, i) => i));
    for (const l of LANGS6) {
      const h = helpChapters(l);
      expect(h.chapters.map((c) => c.id)).toEqual(CHAPTERS.map((c) => c.id));
      for (const c of h.chapters) { expect(c.title.length).toBeGreaterThan(3); expect(c.intro.length).toBeGreaterThan(20); for (const s of c.sections) { expect(s.title.length).toBeGreaterThan(3); expect(s.body.length).toBeGreaterThan(50); } }
      const roles = h.chapters.find((c) => c.id === "roles");
      expect(roles.sections.map((s) => s.role)).toEqual(ROLE_IDS);
      for (const s of roles.sections) expect(s.body).toMatch(/\n1\. /);
      expect(Object.keys(h.ui)).toEqual(["search", "noHits", "role", "yourRoles", "allRoles", "results"]);
    }
  });
});

describe("entity-modal phrases (v1.63)", () => {
  it("has New / Edit / Create for every object kind in all five dictionaries", async () => {
    const { MODAL_PHRASES } = await import("../../src/i18n-dict-ext.js");
    const { dictionaryFor } = await import("../../src/i18n.jsx");
    expect(MODAL_PHRASES).toHaveLength(27);
    for (const l of ["de", "pl", "es", "fr", "it"]) for (const k of [...MODAL_PHRASES, "Save changes", "Retention"]) expect(dictionaryFor(l)[k], `${l}: ${k}`).toBeTruthy();
  });
});
