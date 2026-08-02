import { expect, test } from "@playwright/test";
import {
  board,
  box,
  DISSOLVE_MS,
  installApi,
  MEMORIZE_MS,
  pick,
  playFullGame,
  submission,
} from "./support";

/**
 * The tab bar, the board and the name claim (ADR 0012, ADR 0013).
 *
 * Everything here stubs `/api` in the browser. The point of these assertions is
 * what the player sees and can reach with a keyboard, and a real backend would
 * only make them slower and less able to fail on demand. `backend.spec.ts` is
 * the one that talks to D1.
 */

test("the tab bar exists only between games (ADR 0013)", async ({ page }) => {
  await installApi(page);
  await page.goto("/");

  // ADR 0013's named tripwire. It is what makes a future change that turns the
  // bar into persistent chrome fail loudly rather than silently eat the ~100px
  // of vertical slack that `game.spec.ts`'s "both on screen without scrolling"
  // assertion is spending.
  const tabs = page.locator(".tabs");
  await expect(tabs).toBeVisible();

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(tabs).toBeHidden(); // memorize

  await pick(page);
  await expect(page.locator(".picker-plane")).toBeVisible();
  await expect(tabs).toBeHidden(); // picking — the one the ADR names

  await page.locator(".hud-confirm").click();
  await expect(page.locator(".reveal-chip--target")).toBeVisible();
  await expect(tabs).toBeHidden(); // reveal
});

test("the tab bar never covers the menu's primary action", async ({ page }) => {
  await installApi(page);
  await page.goto("/");

  const bar = await box(page.locator(".tabs"));
  const action = await box(page.getByRole("button", { name: "Play", exact: true }));

  // The menu is a fixed overlay under the fixed bar, so nothing but its top
  // padding keeps the two apart. At the iPhone 14 viewport that padding is the
  // difference between a playable game and a Play button you cannot press.
  expect(action.y, "the primary action starts below the tab bar").toBeGreaterThanOrEqual(
    bar.y + bar.height - 1,
  );
});

test("opening the board with a pointer moves focus into it, and Escape comes back", async ({
  page,
}) => {
  const api = await installApi(page);
  await page.goto("/");
  await expect(page.locator(".game")).toBeVisible();

  await page.getByRole("tab", { name: "Leaderboard" }).click();

  await expect(page.locator(".game")).toBeHidden();
  await expect(page.getByRole("rowheader", { name: "Ada" })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "Grace" })).toBeVisible();
  expect(api.calls("leaderboard"), "the tab fetched the board").toBe(1);

  // A pointer activation leaves focus nowhere useful, so the revealed panel
  // takes it (shell.ts).
  await expect(page.locator(".leaderboard")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.locator(".game")).toBeVisible();
  await expect(page.locator(".leaderboard")).toBeHidden();
  await expect(page.getByRole("tab", { name: "Play" })).toBeFocused();
});

test("the tablist is reachable by Tab and driven entirely by the arrow keys", async ({ page }) => {
  await installApi(page);
  await page.goto("/");

  const play = page.getByRole("tab", { name: "Play" });
  const leaderboard = page.getByRole("tab", { name: "Leaderboard" });

  // Roving tabindex: the whole bar is one Tab stop.
  await page.keyboard.press("Tab");
  await expect(play).toBeFocused();

  // Two tabs, so ArrowLeft off the first one wraps to the last.
  await page.keyboard.press("ArrowLeft");
  await expect(leaderboard).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".leaderboard")).toBeVisible();
  // The load-bearing half: focus stays in the bar on a keyboard switch, or the
  // next arrow press has nothing to move. It is why `onSelect` reports a source.
  await expect(leaderboard).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await expect(play).toHaveAttribute("aria-selected", "true");
  await expect(play).toBeFocused();

  await page.keyboard.press("End");
  await expect(leaderboard).toHaveAttribute("aria-selected", "true");
  await expect(leaderboard).toBeFocused();

  await page.keyboard.press("Home");
  await expect(play).toHaveAttribute("aria-selected", "true");
  await expect(play).toBeFocused();
});

test("a board that fails offers a retry, and the retry re-requests", async ({ page }) => {
  const api = await installApi(page, { leaderboard: { status: 500, body: { message: "boom" } } });
  await page.goto("/");
  await page.getByRole("tab", { name: "Leaderboard" }).click();

  await expect(page.getByText("The server had a problem")).toBeVisible();
  const retry = page.getByRole("button", { name: "Try again" });
  await expect(retry).toBeVisible();
  expect(api.calls("leaderboard")).toBe(1);

  api.set(
    "leaderboard",
    board([{ rank: 1, name: "Ada", score: 468, isYou: false, gameId: "g-ada" }]),
  );
  await retry.click();

  await expect(page.getByRole("rowheader", { name: "Ada" })).toBeVisible();
  await expect(retry).toBeHidden();
  expect(api.calls("leaderboard")).toBe(2);
});

test("an empty board says so rather than rendering an empty table", async ({ page }) => {
  await installApi(page, { leaderboard: board([]) });
  await page.goto("/");
  await page.getByRole("tab", { name: "Leaderboard" }).click();

  await expect(page.getByText("Nobody has finished a game yet")).toBeVisible();
  // An empty board is a *successful* response, so there is nothing to retry and
  // no table to read.
  await expect(page.getByRole("row")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toBeHidden();
});

test("your own row is marked in text, not only in colour", async ({ page }) => {
  await installApi(page, {
    leaderboard: board([
      { rank: 1, name: "Ada", score: 468, isYou: false, gameId: "g-ada" },
      { rank: 2, name: "Grace", score: 431, isYou: true, gameId: "g-grace" },
    ]),
  });
  await page.goto("/");
  await page.getByRole("tab", { name: "Leaderboard" }).click();

  // SPEC §8: the tint is the third channel, never the only one.
  const mine = page.getByRole("row").filter({ hasText: "Grace" });
  await expect(mine).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("rowheader", { name: "Grace (you)" })).toBeVisible();

  const theirs = page.getByRole("row").filter({ hasText: "Ada" });
  await expect(theirs).not.toHaveAttribute("aria-current", "true");
  await expect(theirs).not.toContainText("(you)");
});

test("a long board scrolls inside its own panel and the page does not", async ({ page }) => {
  const entries = Array.from({ length: 50 }, (_, index) => ({
    rank: index + 1,
    name: `Player ${index + 1}`,
    score: 500 - index,
    isYou: false,
    gameId: `g-${index + 1}`,
  }));
  await installApi(page, { leaderboard: board(entries) });
  await page.goto("/");
  await page.getByRole("tab", { name: "Leaderboard" }).click();
  // The name cell now wraps its text in the expander button, so target the text.
  await expect(page.getByText("Player 1", { exact: true })).toBeVisible();

  const panel = page.locator(".leaderboard");
  expect(
    await panel.evaluate((element) => element.scrollHeight > element.clientHeight + 1),
    "the board overflows its panel",
  ).toBe(true);

  await panel.evaluate((element) => {
    element.scrollTop = 200;
  });
  expect(await panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  // SPEC §4's rule holds on the Leaderboard tab too: the page itself never grows
  // a scrollbar, so the tab bar cannot be scrolled off the top.
  const pageScrolls = await page.evaluate(
    () => document.documentElement.scrollHeight > window.innerHeight + 1,
  );
  expect(pageScrolls).toBe(false);
});

test("a taken name is reported with the name that actually landed", async ({ page }) => {
  // Five memorize windows, and there is no back door past them.
  test.slow();

  const api = await installApi(page, {
    result: submission({ name: null, rank: 4 }),
    claim: { status: 200, body: { name: "Ada2" } },
  });
  await page.goto("/");
  await playFullGame(page);

  // Submitting is what mints the identity (ADR 0011), so the form is honest only
  // from here.
  await expect(page.getByText("That puts you 4th")).toBeVisible();

  await page.getByLabel("Claim a name for the board").fill("Ada");
  await page.getByRole("button", { name: "Claim", exact: true }).click();

  await expect(page.getByText("Ada was taken, so you are Ada2.")).toBeVisible();
  await expect(page.getByText("Playing as")).toBeVisible();
  expect(api.calls("claim")).toBe(1);
});

test("a round still plays through to a score with every API request refused", async ({ page }) => {
  // The promise the whole seed-replay design was chosen to keep: the API is a
  // place to put a score, never a thing the game needs in order to be played.
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    (route) => route.abort(),
  );
  await page.goto("/");

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await pick(page);
  await page.locator(".hud-confirm").click();

  await expect(page.locator(".reveal")).toBeVisible();
  const score = Number(await page.locator(".reveal-score").textContent());
  expect(score).toBeGreaterThanOrEqual(0);
  expect(score).toBeLessThanOrEqual(100);

  // And the game carries on rather than wedging on the failed submission.
  await page.getByRole("button", { name: "Next round" }).click();
  await expect(page.locator(".hud-round")).toContainText("2");
  await page.waitForTimeout(MEMORIZE_MS + DISSOLVE_MS + 250);
  await expect(page.locator(".picker-plane")).toBeVisible();
});

test.describe("expanding a row into its attempt (ADR 0024)", () => {
  test("shows the round breakdown, and closes again on a second tap", async ({ page }) => {
    await installApi(page);
    await page.goto("/");
    await page.getByRole("tab", { name: "Leaderboard" }).click();

    const row = page.locator(".leaderboard-row", { hasText: "Ada" });
    const detail = page.locator("#attempt-g-ada");
    await row.locator(".leaderboard-expander").click();

    await expect(detail.locator(".attempt-total")).toContainText("372");
    await expect(detail.locator(".breakdown-round")).toHaveCount(5);
    await expect(row.locator(".leaderboard-expander")).toHaveAttribute("aria-expanded", "true");

    await row.locator(".leaderboard-expander").click();
    await expect(row.locator(".leaderboard-expander")).toHaveAttribute("aria-expanded", "false");
    await expect(detail).toBeHidden();
  });

  test("lets several rows stay open at once, and closes from the panel", async ({ page }) => {
    await installApi(page);
    await page.goto("/");
    await page.getByRole("tab", { name: "Leaderboard" }).click();

    await page
      .locator(".leaderboard-row", { hasText: "Ada" })
      .locator(".leaderboard-expander")
      .click();
    await page
      .locator(".leaderboard-row", { hasText: "Grace" })
      .locator(".leaderboard-expander")
      .click();
    await expect(page.locator(".leaderboard-detail:not([hidden])")).toHaveCount(2);

    await page
      .locator("#attempt-g-ada")
      .getByRole("button", { name: "Close this breakdown" })
      .click();
    await expect(page.locator("#attempt-g-ada")).toBeHidden();
    await expect(page.locator("#attempt-g-grace")).toBeVisible();
  });

  test("copies a share link to the seed", async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await installApi(page);
    await page.goto("/");
    await page.getByRole("tab", { name: "Leaderboard" }).click();

    await page
      .locator(".leaderboard-row", { hasText: "Ada" })
      .locator(".leaderboard-expander")
      .click();
    await page.locator("#attempt-g-ada").getByRole("button", { name: "Copy link" }).click();

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("/?board=g-ada");
  });

  test("filters the board to one seed, then clears back to everyone", async ({ page }) => {
    const api = await installApi(page);
    await page.goto("/");
    await page.getByRole("tab", { name: "Leaderboard" }).click();
    expect(api.calls("leaderboard")).toBe(1);

    await page
      .locator(".leaderboard-row", { hasText: "Ada" })
      .locator(".leaderboard-expander")
      .click();
    await page.locator("#attempt-g-ada").getByRole("button", { name: "Only this seed" }).click();

    const banner = page.locator(".leaderboard-filter");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Ada");
    expect(api.calls("leaderboard")).toBe(2);

    await banner.getByRole("button", { name: "Show everyone" }).click();
    await expect(banner).toBeHidden();
    expect(api.calls("leaderboard")).toBe(3);
  });
});

test("a shared /?board= link opens straight onto the seed board", async ({ page }) => {
  const api = await installApi(page);
  await page.goto("/?board=g-ada");

  await expect(page.locator(".leaderboard")).toBeVisible();
  await expect(page.locator(".leaderboard-filter")).toBeVisible();
  await expect(page.getByText("Showing this seed")).toBeVisible();
  expect(api.calls("leaderboard")).toBeGreaterThanOrEqual(1);
});
