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

type Rect = { x: number; y: number; width: number; height: number };

async function box(locator: Locator): Promise<Rect> {
  const value = await locator.boundingBox();
  if (value === null) throw new Error("element has no layout box");
  return value;
}

function expectSameRect(a: Rect, b: Rect, what: string): void {
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(Math.abs(a[key] - b[key]), `${what}: ${key}`).toBeLessThanOrEqual(1);
  }
}

test("the picker covers exactly the same rect as the swatch", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Play" }).click();

  // The rect the player is actually memorizing.
  await page.waitForTimeout(1000);
  const memorized = await box(page.locator(".swatch-fill"));

  await page.waitForTimeout(MEMORIZE_MS + DISSOLVE_MS + 250);
  const picking = await box(page.locator(".swatch-picker-slot"));

  // Two separate guarantees. The layers share a grid cell, so this one holds by
  // construction and should be exact.
  expectSameRect(await box(page.locator(".swatch-fill")), picking, "fill vs picker");

  // This one does not hold by construction — anything above the stage that
  // changes height between phases moves the memorized rect out from under the
  // picker. A phase-dependent HUD reflow did exactly that at phone widths.
  expectSameRect(memorized, picking, "memorized vs picker");
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

test("a full round: memorize, pick, confirm, score", async ({ page }) => {
  await playToPicking(page);

  const plane = page.locator(".picker-plane");
  const rect = await box(plane);

  // Drag inside the plane. Starting near the low-chroma edge keeps the whole
  // path inside the in-gamut region at any hue.
  await page.mouse.move(rect.x + rect.width * 0.2, rect.y + rect.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * 0.35, rect.y + rect.height * 0.45, { steps: 8 });
  await page.mouse.up();

  const confirm = page.locator(".hud-confirm");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  // The reveal shows both colors, the raw ΔE and the score (SPEC §6).
  await expect(page.locator(".reveal")).toBeVisible();
  const delta = await page.locator(".reveal-delta").textContent();
  const score = await page.locator(".reveal-score").textContent();

  expect(Number(delta)).toBeGreaterThanOrEqual(0);
  expect(Number(score)).toBeGreaterThanOrEqual(0);
  expect(Number(score)).toBeLessThanOrEqual(100);

  // And the target is visible again now that the round is over.
  const chipStyle = await page.locator(".reveal-chip").first().getAttribute("style");
  expect(chipStyle ?? "").toContain("oklch");

  await page.getByRole("button", { name: "Next round" }).click();
  await expect(page.locator(".hud-round")).toContainText("2");
});
