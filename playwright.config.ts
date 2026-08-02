import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  /**
   * The two specs that need a real Worker and a real D1 live in the same
   * directory but belong to `playwright.backend.config.ts`, which brings up
   * `wrangler dev` and a migrated database for them. Running them here
   * would fail against a Vite dev server that serves neither.
   */
  testIgnore: /(backend|replay-workerd)\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // `exactOptionalPropertyTypes` forbids an explicit `undefined` here, so use a value.
  workers: isCI ? 1 : "50%",
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop-chrome",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Mobile viewport coverage is a hard requirement for this project.
      // We take the `iPhone 14` descriptor (viewport, DPR, touch, mobile UA) but pin the
      // engine to chromium so CI only has to install one browser (`playwright install
      // --with-deps chromium`). For real WebKit/iOS-Safari fidelity, drop the
      // `browserName` override and add `webkit` to the CI install step.
      name: "mobile-iphone-14",
      use: { ...devices["iPhone 14"], browserName: "chromium" },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !isCI,
    stdout: "ignore",
    stderr: "pipe",
    timeout: 120_000,
  },
});
