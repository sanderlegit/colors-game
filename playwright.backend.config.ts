import { defineConfig, devices } from "@playwright/test";

import { API_ORIGIN, API_PORT, APP_ORIGIN, APP_PORT } from "./e2e/ports";

/**
 * The real-backend run: `wrangler dev` with a local D1, behind a Vite dev server
 * that proxies `/api` to it.
 *
 * Separate from `playwright.config.ts` on purpose. That one is the UI suite and
 * must stay runnable with nothing but a browser; this one costs a build, a
 * migration and a Worker boot, and it is what proves `server/db/d1.ts` — the one
 * file with no unit coverage, because it needs a binding — actually executes.
 *
 * ## Two servers, one origin
 *
 * The browser only ever sees `APP_ORIGIN`. Vite forwards `/api` with
 * `changeOrigin: false`, so the `Host` the Worker sees is the one the browser
 * used and `isSameOrigin` compares like with like. Pointing the browser at two
 * origins instead would make the `SameSite=Strict`, host-only identity cookie
 * stop being sent and every POST 403 — dev diverging from production exactly
 * where it matters. See `vite.config.ts`.
 *
 * ## Nothing is reused
 *
 * `reuseExistingServer: false` on both. A stale server on either port is the
 * recorded trap in `docs/history/README.md` § Environment traps, and here it
 * would additionally mean running against a D1 that was never wiped — so the
 * name claim collides and the failure looks like a bug in the name code.
 *
 * `retries: 0` for the same reason: a retry would meet the row the first attempt
 * inserted.
 */

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  testMatch: /(backend|replay-workerd)\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: isCI,
  retries: 0,
  workers: 1,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: APP_ORIGIN,
    trace: "on-first-retry",
  },
  projects: [{ name: "backend-chrome" }],
  webServer: [
    {
      // `dist` has to exist before `[assets]` will serve it, and the database
      // has to be empty and migrated before the Worker opens it.
      // `--var DEBUG_REPLAY:1` is what turns on the workerd replay route; it
      // exists nowhere else, least of all in `wrangler.toml`. Note the colon —
      // `wrangler dev` takes `--var KEY:VALUE`, where `wrangler pages dev` took
      // `--binding KEY=VALUE`, and the wrong punctuation is accepted as part of
      // the key rather than refused.
      command: [
        "npm run build",
        "npm run d1:reset",
        `npx wrangler dev --port ${API_PORT} --var DEBUG_REPLAY:1`,
      ].join(" && "),
      url: `${API_ORIGIN}/api/health`,
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
      timeout: 180_000,
    },
    {
      command: `npx vite --port ${APP_PORT} --strictPort`,
      env: { API_ORIGIN },
      url: APP_ORIGIN,
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
      timeout: 120_000,
    },
  ],
});
