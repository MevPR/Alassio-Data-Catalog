import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // During development, forward Databricks calls to the local proxy (npm run proxy)
    proxy: { "/databricks": "http://127.0.0.1:3000" },
  },
});
