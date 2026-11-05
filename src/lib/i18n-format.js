/* Pure i18n formatting helpers (v1.73 — finding F-F7: `fill` used to live in the toast context module, so a hook that
   only needed string formatting imported a React context). No React, no dictionary — safe for src/lib and unit tests. */

/* "{name}" placeholders → values; unknown placeholders stay visible so a typo is noticed */
export const fill = (s, vars) => (vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : String(s));

/* tn(): picks the singular key for exactly one and the plural key otherwise. Every dictionary key stays a full English
   sentence ("{n} table" / "{n} tables"), so translators see both forms and the coverage test can check them. Languages
   with more forms (Polish) use the plural entry for 0 and 2+ — best effort, as elsewhere in the dictionaries. */
export const pluralKey = (one, other, n) => (Number(n) === 1 ? one : other);
