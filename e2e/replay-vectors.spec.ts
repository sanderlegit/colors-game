import { expect, test } from "@playwright/test";

import { REPLAY_VECTORS } from "../server/replay.vectors";

/**
 * The third of ADR 0016's four engines: a real browser.
 *
 * The claim the whole server-authority design rests on is that the client and
 * the Worker compute *the same* target from a seed — not a close one. happy-dom
 * and Node cover V8 under vitest; this covers the engine the player actually
 * runs, with the real module graph and the real `@/` resolution rather than a
 * test runner's.
 *
 * The comparison happens in the page (`e2e/browser/replay-probe.ts`), so a
 * number never crosses the CDP boundary and cannot be rounded on the way.
 */
test("a real browser reproduces every replay vector bit-for-bit (ADR 0016)", async ({ page }) => {
  await page.goto("/");
  await page.addScriptTag({ url: "/e2e/browser/replay-probe.ts", type: "module" });
  await page.waitForFunction(() => document.body.dataset.replayVectors !== undefined);

  const reported = await page.evaluate(() => document.body.dataset.replayVectors ?? "");

  expect(JSON.parse(reported)).toEqual({ checked: REPLAY_VECTORS.length, mismatches: [] });
});
