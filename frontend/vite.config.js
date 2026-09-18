import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite replaces CRA/craco: the `@/` alias carries over from craco's webpack
// alias; the scaffold visual-edit wrapper is intentionally dropped.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // REACT_APP_* is a temporary compatibility prefix for pre-migration
  // .env.local files; VITE_* is the canonical prefix (see .env.example).
  envPrefix: ["VITE_", "REACT_APP_"],
  // CRA allowed JSX in .js files; keep that working so pages keep their
  // filenames (sibling rebuild PRs own those files). esbuild compiles JSX in
  // both .js and .jsx source files.
  esbuild: {
    loader: "jsx",
    include: /src\/.*\.jsx?$/,
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: { ".js": "jsx" },
    },
  },
  server: {
    port: 3000,
    host: true,
    open: false,
  },
  preview: {
    port: 3000,
    // E2E: the previewed production build calls same-origin /api; this proxy
    // points it at the API under test (nginx does the same in compose).
    proxy: process.env.VITE_PREVIEW_API_TARGET
      ? { "/api": { target: process.env.VITE_PREVIEW_API_TARGET, changeOrigin: true } }
      : undefined,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.js"],
    globals: true,
  },
});
