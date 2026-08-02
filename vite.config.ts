import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

/**
 * Where `/api` goes when there is a real backend to send it to.
 *
 * Unset for `npm run dev` and for the ordinary e2e run — those stub the API in
 * the browser and must not depend on wrangler being up. `playwright.backend.config.ts`
 * sets it to the `wrangler dev` origin.
 *
 * **`changeOrigin: false` is load-bearing, not cosmetic.** It leaves the `Host`
 * header naming the Vite origin, so the Worker builds `request.url` from it and
 * `isSameOrigin` compares the browser's `Origin` against the same value. Point
 * the browser at two origins instead and the identity cookie — `SameSite=Strict`
 * and host-only — stops being sent and every unsafe method 403s, which is dev
 * diverging from production in exactly the place that matters.
 */
const apiOrigin = process.env.API_ORIGIN;

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
    // Bind on all interfaces so a device on the LAN can hit the dev server. That is
    // for looking at the UI only: a LAN address is not a secure context, so the
    // `Secure` identity cookie is silently discarded and anything involving the
    // player's name is broken. Real-device testing goes over `just tailnet`
    // (ADR 0020). Reaching this by *hostname* would additionally need
    // `allowedHosts`, which ADR 0020 declines to add.
    host: true,
    // `exactOptionalPropertyTypes` forbids `proxy: undefined`, so omit the key.
    ...(apiOrigin === undefined
      ? {}
      : { proxy: { "/api": { target: apiOrigin, changeOrigin: false } } }),
  },
  preview: {
    port: 4173,
  },
});
