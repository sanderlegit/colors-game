import { expect, test } from "@playwright/test";

import { playFullGame } from "./support";

/**
 * The only spec that talks to a real backend: `wrangler dev` over
 * miniflare's SQLite, with `server/db/d1.ts` executing every statement for real.
 *
 * That file is excluded from the coverage floor because it needs a D1 binding,
 * and until this spec existed it had only ever been run by hand — so a column
 * typo in a statement no handler test can reach would have shipped. One round
 * trip through start → submit → claim → board touches `insertGame`,
 * `findGame`, `finishGame`, `insertPlayer`, `findPlayerByTokenHash`,
 * `recordFinishedGame`, `claimName`, `topPlayers` and `countPlayersAbove`.
 * Expanding the row and filtering to its seed adds the ADR 0024 statements:
 * the attempt replay's `findGame`, and `topPlayersBySeed`'s window query — the
 * one bit of SQL a memory double cannot vet.
 *
 * Everything else about the board and the tab bar is asserted with intercepted
 * responses in `leaderboard.spec.ts`; this one stubs nothing.
 */

/**
 * The database is wiped before the server starts (`npm run d1:reset`), so this
 * name lands unsuffixed — and asserting that it did is what proves the wipe, the
 * unique index and `claimAvailableName` all did their jobs.
 */
const NAME = "Ada Lovelace";

test("start → submit → claim → board, against a real D1", async ({ page }) => {
  // Five memorize windows plus the server's own floor on elapsed time.
  test.slow();

  await page.goto("/");

  // `src/main.ts` mints the ranked game at boot, and `server/limits.ts` refuses a
  // submission that arrives sooner than `rounds × memorizeMs + rounds × 600ms`
  // after that mint. Playing the game takes about that long on its own, so this
  // is the margin — without it the spec is a coin flip against a 422.
  await page.waitForTimeout(2000);

  await playFullGame(page);

  const heading = await page.getByRole("heading", { level: 1 }).textContent();
  const total = Number(/^(\d+) of/.exec(heading ?? "")?.[1]);
  expect(total, "the summary shows a total").toBeGreaterThanOrEqual(0);

  // The server replayed the seed and ranked us. ADR 0015 ranks every submission,
  // so an unnamed player still gets a place.
  await expect(page.getByText(/That puts you \d+/)).toBeVisible();

  await page.getByLabel("Claim a name for the board").fill(NAME);
  await page.getByRole("button", { name: "Claim", exact: true }).click();
  await expect(page.getByText(`Playing as ${NAME}`)).toBeVisible();

  await page.getByRole("tab", { name: "Leaderboard" }).click();

  const mine = page.getByRole("row").filter({ hasText: NAME });
  await expect(mine).toBeVisible();
  // `isYou` is only true if the identity cookie came back — which it only does
  // because the browser saw one origin. The cookie is `SameSite=Strict` and
  // host-only and the Worker enforces an `Origin` check, so a proxy that rewrote
  // the `Host` header would break exactly here and nowhere in unit tests.
  await expect(mine).toHaveAttribute("aria-current", "true");

  // ADR 0016's whole claim, end to end: the score the Worker computed by
  // replaying the seed is the score the client showed. Both are `Math.round` of
  // the same sum of the same pure `scoreGuess` calls, so anything but equality
  // means the two engines disagreed about a target.
  await expect(mine.getByRole("cell").nth(1)).toHaveText(String(total));

  // And it survives a reload: `GET /api/me` and the board both read the same
  // `players` row back.
  await page.reload();
  await page.getByRole("tab", { name: "Leaderboard" }).click();
  await expect(page.getByRole("rowheader", { name: `${NAME} (you)` })).toBeVisible();

  // ADR 0024: the row expands into the attempt the Worker replayed from the
  // stored `seed` and `guesses_json`. Five rounds and the same total prove the
  // replay read a real row back and re-derived the colours.
  await page
    .locator(".leaderboard-row", { hasText: NAME })
    .locator(".leaderboard-expander")
    .click();
  const detail = page.locator(".leaderboard-detail:not([hidden])");
  await expect(detail.locator(".breakdown-round")).toHaveCount(5);
  await expect(detail.locator(".attempt-total")).toContainText(String(total));

  // Filtering to this seed runs `topPlayersBySeed`'s window query on real D1 —
  // and our own game, the only one on this seed, is on the board it returns.
  await detail.getByRole("button", { name: "Only this seed" }).click();
  await expect(page.locator(".leaderboard-filter")).toBeVisible();
  await expect(page.getByRole("rowheader", { name: new RegExp(NAME) })).toBeVisible();
});
