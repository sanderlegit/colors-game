import { expect, test } from "@playwright/test";
import { REPLAY_VECTORS } from "../server/replay.vectors";
import { API_ORIGIN } from "./ports";

/**
 * The fourth of ADR 0016's engines: workerd, in the bundle `wrangler deploy`
 * would ship.
 *
 * The other three are V8 — vitest under happy-dom, vitest under Node, and
 * Chromium in `replay-vectors.spec.ts`. This one is the runtime the *authority*
 * runs on: if it disagreed about a single target, every score on the board would
 * be computed from a different colour than the one the player was shown, and
 * nothing else in the suite would notice.
 *
 * The comparison happens inside the Worker (`server/debug/replay-vectors.ts`)
 * against the same literals, with `!==` and no tolerance. That route is inert
 * unless `DEBUG_REPLAY` is `"1"`, which only `playwright.backend.config.ts`
 * supplies — see `server/env.d.ts` and `tests/debug-flag.node.test.ts`.
 *
 * Addressed directly rather than through the Vite proxy, which forwards `/api`
 * only.
 */
test("workerd reproduces every replay vector bit-for-bit (ADR 0016)", async ({ request }) => {
  const response = await request.get(`${API_ORIGIN}/debug/replay-vectors`);

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ checked: REPLAY_VECTORS.length, mismatches: [] });
});
