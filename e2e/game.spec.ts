import { expect, type Locator, type Page, test } from "@playwright/test";

/**
 * SPEC §9.4. These are the assertions that cannot be made anywhere else: the
 * dissolve's geometry, what is really in the DOM, and whether the layout holds up
 * at a phone viewport. Everything provable from a state object is a unit test.
 */

const MEMORIZE_MS = 5000;
const DISSOLVE_MS = 450 + 400 + 450; // fade, mask hold, fade (ADR 0006)

/** Start a game and wait until the picker is live. */
async function playToPicking(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(MEMORIZE_MS + DISSOLVE_MS + 250);
}

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (value === null) throw new Error("element has no layout box");
  return value;
}

test("the picker covers exactly the same rect as the swatch", async ({ page }) => {
  await page.goto("/");

  const fill = page.locator(".swatch-fill");
  const slot = page.locator(".swatch-picker-slot");
  await expect(fill).toBeAttached();

  // Measured before the dissolve so this is the *memorized* rect, which is the
  // one the requirement is about.
  const before = await box(fill);

  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(MEMORIZE_MS + DISSOLVE_MS + 250);

  const after = await box(slot);

  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
});

test("the target color is not in the DOM once picking starts", async ({ page }) => {
  await playToPicking(page);

  // The fill layer's color is dropped as soon as the mask covers it (ADR 0006).
  const fillStyle = await page.locator(".swatch-fill").getAttribute("style");
  expect(fillStyle ?? "").not.toContain("oklch");

  // The reveal chips must not be pre-populated either.
  const revealChip = page.locator(".reveal-chip").first();
  if (await revealChip.count()) {
    expect((await revealChip.getAttribute("style")) ?? "").not.toContain("oklch");
  }
});

test("the picker is inert during the dissolve", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Play" }).click();
  // Mid-dissolve: the player is looking at a half-faded target, not a picker.
  await page.waitForTimeout(MEMORIZE_MS + 200);

  await expect(page.locator(".swatch-picker-slot")).toHaveCSS("pointer-events", "none");

  await page.waitForTimeout(DISSOLVE_MS + 250);
  await expect(page.locator(".swatch-picker-slot")).toHaveCSS("pointer-events", "auto");
});

test("swatch and preview are both on screen without scrolling", async ({ page }) => {
  await playToPicking(page);

  const viewport = page.viewportSize();
  if (viewport === null) throw new Error("no viewport");

  const swatch = await box(page.locator(".swatch-stack"));
  const preview = await box(page.locator(".preview"));

  for (const [name, rect] of [
    ["swatch", swatch],
    ["preview", preview],
  ] as const) {
    expect(rect.y, `${name} top`).toBeGreaterThanOrEqual(-1);
    expect(rect.y + rect.height, `${name} bottom`).toBeLessThanOrEqual(viewport.height + 1);
  }

  // SPEC §4: the requirement is that neither is reachable only by scrolling.
  const scrollable = await page.evaluate(
    () => document.documentElement.scrollHeight > window.innerHeight + 1,
  );
  expect(scrollable).toBe(false);
});

test("the confirm button is unavailable until the picker has been moved", async ({ page }) => {
  await playToPicking(page);
  await expect(page.locator(".hud-confirm")).toBeDisabled();
});
