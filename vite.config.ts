import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

// Pure-TypeScript app: no framework plugins on purpose.
// Vite is used only as a dev server + bundler.
export default defineConfig({
  resolve: {
    alias: {
      // Keep in sync with tsconfig.json `paths` and vitest.config.ts.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  server: {
    port: 5173,
    // Bind on all interfaces so real iOS/Android devices on the LAN can hit the dev server.
    host: true,
  },
  preview: {
    port: 4173,
  },
});
