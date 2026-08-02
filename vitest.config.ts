import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Two projects, because the backend and the browser code need different globals.
 *
 * The `server` project runs in Node with no DOM: a server test that passes only
 * because happy-dom supplied a `window` is a test that lies about the Worker.
 * Node 26 provides `Request`, `Response` and `crypto.subtle` globally, so
 * nothing needs polyfilling — see docs/history/README.md § Environment traps
 * before adding one.
 *
 * Both projects need the `@/` alias. `server/**` imports the pure core with
 * relative paths, but the core's own imports use the alias.
 */
const alias = {
  // Keep in sync with tsconfig.json `paths`, tsconfig.server.json and vite.config.ts.
  "@": fileURLToPath(new URL("./src", import.meta.url)),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "app",
          environment: "happy-dom",
          // Explicit imports from 'vitest' are required — no ambient globals.
          globals: false,
          include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
          setupFiles: ["./tests/setup.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "server",
          environment: "node",
          globals: false,
          include: ["server/**/*.test.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts", "server/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/main.ts",
        "server/**/*.test.ts",
        // Reachable only with a real D1 binding, so it is covered by
        // `wrangler dev` and e2e rather than by vitest. Everything with a
        // decision in it lives behind the Repo port, which is covered.
        "server/db/d1.ts",
      ],
      // Per-glob thresholds: only the pure logic layers and the backend are held
      // to 90%. The rest of src/ (DOM wiring, rendering) is intentionally
      // unthresholded — coverage there is a vanity metric.
      thresholds: {
        "src/domain/**": {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        "src/color/**": {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        "server/**": {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
      },
    },
  },
});
