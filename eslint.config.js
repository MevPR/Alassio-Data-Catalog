import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

/* pattern groups of the dependency guards — combined per file group below */
const SERVER_UI_GUARD = [
  { group: ["**/src/components/*", "**/src/views/*", "**/src/hooks/*", "**/src/App.jsx", "**/src/*.jsx", "**/src/lib/api.js", "**/src/lib/download.js", "**/src/lib/csrf.js", "**/src/lib/usage.js"], message: "the server may import only the pure modules of src/lib" },
];
const DOMAIN_GUARD = [
  { group: ["../mcp.js", "../../mcp.js"], message: "the catalog domain must not depend on mcp.js — shared change logic lives in catalog-diff.js" },
  { group: ["./routes/*", "../routes/*"], message: "domain modules must not import route modules — move the logic into server/ and let the route call it" },
];
const ROUTE_GUARD = [
  { group: ["./*.js"], message: "route modules must not import each other — shared logic lives in server/*.js" },
  { group: ["../../mcp.js"], message: "routes must not depend on the MCP adapter" },
];
const MCP_GUARD = [
  { group: ["**/server/routes/*"], message: "the MCP adapter calls domain modules, never route modules" },
];

export default [
  { ignores: ["dist/**", "node_modules/**", "inspector/**"] },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx,mjs}"],
    languageOptions: {
      ecmaVersion: 2023, sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node, ...globals.es2021, CSS: "off" },
    },
    rules: {
      "no-undef": "error",              /* also reports undefined JSX components (<Foo />) */
      /* v1.72 (F-F12): on — dead imports and variables are errors; a deliberately unused parameter starts with "_" */
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true }],
      "no-empty": "off",
      "no-prototype-builtins": "off",
      "no-useless-escape": "off",
      "no-control-regex": "off",
      "no-cond-assign": "off",
    },
  },
  /* v1.71 (F-F1): hooks rules — rules-of-hooks everywhere in the UI; exhaustive-deps is an error in the
     composition root and the hooks (where a wrong dependency array silently breaks memoisation), a warning elsewhere */
  { files: ["src/**/*.{js,jsx}"], plugins: { "react-hooks": reactHooks }, rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn" } },
  { files: ["src/App.jsx", "src/hooks/*.js", "src/toast-context.jsx"], rules: { "react-hooks/exhaustive-deps": "error" } },
  /* Dependency direction guards (v1.68 / v1.70 / v1.72; v1.74 F-S1: one block per file group).
     ESLint flat config merges rule *settings* per rule, not per pattern: a later block that also sets
     no-restricted-imports replaces the earlier one completely. So every file group gets exactly one block that
     carries all of its patterns, and the groups do not overlap. test/unit/lint-guards.test.js lints fixture files
     that must fail, so a config change that silently switches a guard off turns the suite red. */
  { files: ["server/*.js", "server/connectors/*.js"], rules: { "no-restricted-imports": ["error", { patterns: [...DOMAIN_GUARD, ...SERVER_UI_GUARD] }] } },
  { files: ["server/routes/*.js"], rules: { "no-restricted-imports": ["error", { patterns: [...ROUTE_GUARD, ...SERVER_UI_GUARD] }] } },
  { files: ["mcp/**/*.js"], rules: { "no-restricted-imports": ["error", { patterns: [...MCP_GUARD, ...SERVER_UI_GUARD] }] } },
  { files: ["*.js"], ignores: ["vite.config.js", "vitest.config.js", "eslint.config.js"], rules: { "no-restricted-imports": ["error", { patterns: SERVER_UI_GUARD }] } },
  { files: ["src/components/*.jsx", "src/views/*.jsx", "src/hooks/*.js"], rules: { "no-restricted-imports": ["error", { patterns: [
    { group: ["../components/marketplace.jsx", "./marketplace.jsx"], importNames: ["PHASE_OF", "WAITING_FOR", "PHASES", "PROCESS_STEPS", "STEP_DIALOGS"], message: "workflow vocabulary comes from src/lib/design-workflow.js" } ] }] } },
  /* v1.72 (F-S4): src/lib is shared with the server — it stays pure: no React, no browser-only client modules */
  { files: ["src/lib/**/*.js"], ignores: ["src/lib/api.js", "src/lib/download.js", "src/lib/csrf.js", "src/lib/usage.js"], rules: { "no-restricted-imports": ["error", { patterns: [
    { group: ["react", "react-dom", "lucide-react"], message: "src/lib is shared with the server — no UI libraries here" },
    { group: ["./api.js", "./download.js", "./csrf.js", "./usage.js"], message: "src/lib is shared with the server — browser-only client modules (api, download, csrf, usage) must not be imported from the pure modules" } ] }] } },
];
