/**
 * The two origins the real-backend e2e run uses, shared by
 * `playwright.backend.config.ts` and the specs it runs so they cannot drift.
 *
 * **Not 5173.** `playwright.config.ts` has `reuseExistingServer` on when not CI,
 * so a `vite dev` already listening there — even one from a different checkout —
 * silently serves its code instead of yours. This run brings up its own servers
 * on their own ports and reuses nothing (`docs/history/README.md` § Environment
 * traps).
 */

/** Vite, serving the app and proxying `/api` to the Worker. */
export const APP_PORT = 5174;
/** `wrangler dev`: the Worker, its static assets and a local D1. */
export const API_PORT = 8788;

export const APP_ORIGIN = `http://localhost:${APP_PORT}`;
export const API_ORIGIN = `http://localhost:${API_PORT}`;
