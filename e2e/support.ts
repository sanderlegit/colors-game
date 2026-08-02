/**
 * Shared e2e scaffolding: driving a round, and standing in for the API.
 *
 * **Why `page.route` and not a real backend for most of this.** The tab bar, the
 * board and the name claim are UI assertions. Interception needs no wrangler in
 * CI, and it lets a 500, an empty board or a name collision be injected exactly
 * — none of which a real server will produce on request. The one spec that must
 * exercise real SQL is `backend.spec.ts`, which runs against `wrangler dev`
 * under `playwright.backend.config.ts` and stubs nothing.
 *
 * Not a `*.spec.ts`, so Playwright's default `testMatch` does not collect it.
 */

import { expect, type Locator, type Page } from "@playwright/test";

/** SPEC §8's default memorize window, and the dissolve that follows it. */
export const MEMORIZE_MS = 5000;
export const DISSOLVE_MS = 450;
/** `ROUNDS_PER_GAME` in `src/domain/state.ts`. */
export const ROUNDS_PER_GAME = 5;

export type Rect = { x: number; y: number; width: number; height: number };

export async function box(locator: Locator): Promise<Rect> {
  const value = await locator.boundingBox();
  if (value === null) throw new Error("element has no layout box");
  return value;
}

// ── Driving the game ────────────────────────────────────────────────────────

/** Wait out the memorize window and the dissolve, then move the picker. */
export async function pick(page: Page): Promise<void> {
  await page.waitForTimeout(MEMORIZE_MS + DISSOLVE_MS + 250);
  const rect = await box(page.locator(".picker-plane"));
  // Every point on the plane is in gamut since ADR 0007, so any path works.
  await page.mouse.move(rect.x + rect.width * 0.3, rect.y + rect.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * 0.45, rect.y + rect.height * 0.4, { steps: 8 });
  await page.mouse.up();
}

/** One whole round: memorize, pick, confirm. Leaves the reveal on screen. */
export async function playRound(page: Page): Promise<void> {
  await pick(page);
  const confirm = page.locator(".hud-confirm");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.locator(".reveal-chip--target")).toBeVisible();
}

/**
 * Press Play and see all five rounds through to the summary.
 *
 * This costs `ROUNDS_PER_GAME` memorize windows and there is no back door: the
 * timer lives in the reducer, the reducer is driven by a real rAF clock, and the
 * server's own floor on elapsed time (`server/limits.ts`) is calibrated to it.
 * Every caller marks its test `test.slow()`.
 */
export async function playFullGame(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Play" }).click();
  for (let round = 1; round <= ROUNDS_PER_GAME; round += 1) {
    await playRound(page);
    const label = round === ROUNDS_PER_GAME ? "See summary" : "Next round";
    await page.getByRole("button", { name: label }).click();
  }
  await expect(page.getByRole("button", { name: "Play again" })).toBeVisible();
}

// ── Standing in for the API ─────────────────────────────────────────────────

export type Reply = { readonly status: number; readonly body?: unknown };

/** One key per endpoint `src/platform/api.ts` can reach. */
export type ApiKey = "me" | "games" | "result" | "attempt" | "claim" | "leaderboard" | "forget";

export type BoardEntry = {
  readonly rank: number;
  readonly name: string;
  readonly score: number;
  readonly isYou: boolean;
  readonly gameId: string;
};

export type ApiStub = {
  /** Replace an endpoint's reply from now on. */
  set(key: ApiKey, reply: Reply): void;
  /** How many times the client has reached an endpoint. */
  calls(key: ApiKey): number;
};

export function board(entries: readonly BoardEntry[]): Reply {
  return { status: 200, body: { entries } };
}

/** An attempt the decoder in `src/platform/api.ts` will accept, with colours. */
export function attempt(): Reply {
  return {
    status: 200,
    body: {
      totalScore: 372,
      rounds: Array.from({ length: ROUNDS_PER_GAME }, (_, index) => ({
        deltaE: 3.5,
        score: 74,
        target: { L: 0.5, c: 0.1, h: (index * 60) % 360 },
        guess: { L: 0.52, c: 0.09, h: (index * 60 + 8) % 360 },
      })),
    },
  };
}

/** A submission the decoder in `src/platform/api.ts` will accept. */
export function submission(over: { readonly name: string | null; readonly rank: number }): Reply {
  return {
    status: 200,
    body: {
      totalScore: 372,
      rounds: Array.from({ length: ROUNDS_PER_GAME }, () => ({ deltaE: 3.5, score: 74 })),
      rank: over.rank,
      isPersonalBest: true,
      name: over.name,
      claimed: false,
    },
  };
}

function defaults(): Record<ApiKey, Reply> {
  return {
    me: { status: 204 },
    games: { status: 201, body: { gameId: "e2e-game", seed: 1337, roundsTotal: ROUNDS_PER_GAME } },
    result: submission({ name: null, rank: 3 }),
    attempt: attempt(),
    claim: { status: 200, body: { name: "Ada" } },
    leaderboard: board([
      { rank: 1, name: "Ada", score: 468, isYou: false, gameId: "g-ada" },
      { rank: 2, name: "Grace", score: 431, isYou: false, gameId: "g-grace" },
    ]),
    forget: { status: 204 },
  };
}

function keyFor(method: string, pathname: string): ApiKey | null {
  if (pathname === "/api/me") return method === "DELETE" ? "forget" : "me";
  if (pathname === "/api/games") return "games";
  if (pathname.endsWith("/attempt")) return "attempt";
  if (pathname.startsWith("/api/games/")) return "result";
  if (pathname === "/api/name") return "claim";
  if (pathname === "/api/leaderboard") return "leaderboard";
  return null;
}

/**
 * Intercept every `/api` call. Install before `page.goto` — `src/main.ts` fires
 * `me()` and the first ranked game at boot, without awaiting either.
 */
export async function installApi(
  page: Page,
  overrides: Partial<Record<ApiKey, Reply>> = {},
): Promise<ApiStub> {
  const replies: Record<ApiKey, Reply> = { ...defaults(), ...overrides };
  const counts = new Map<ApiKey, number>();

  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const request = route.request();
      const key = keyFor(request.method(), new URL(request.url()).pathname);
      // `/api/client-error` and anything else: accepted and ignored, so a stray
      // beacon cannot fail a test that is not about it.
      if (key === null) {
        await route.fulfill({ status: 204 });
        return;
      }
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const reply = replies[key];
      await route.fulfill({
        status: reply.status,
        ...(reply.body === undefined
          ? {}
          : { contentType: "application/json", body: JSON.stringify(reply.body) }),
      });
    },
  );

  return {
    set(key: ApiKey, reply: Reply): void {
      replies[key] = reply;
    },
    calls(key: ApiKey): number {
      return counts.get(key) ?? 0;
    },
  };
}
