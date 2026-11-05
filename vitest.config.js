import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/* v1.72 (F-T4): two projects — the unit tests run in plain Node (they never render), only the component tests pay for
   jsdom; a unit test that needs a browser API opts in with `// @vitest-environment jsdom` (csrf.test.js). Timers in the
   component tests are faked where a test waits for a debounce or a toast, so the CI retry that absorbed timing flakes
   is gone. testTimeout stays generous because whole-App renders on a loaded CI runner can take a few seconds. */
const shared = { testTimeout: 30000 };
export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      { extends: true, test: { ...shared, name: "unit", include: ["test/unit/**/*.test.js"], environment: "node" } },
      { extends: true, test: { ...shared, name: "components", include: ["test/components/**/*.test.jsx"], environment: "jsdom" } },
    ],
  },
});
