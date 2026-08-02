import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createClient, SITE } from "./app.fixture";
import type { AppDeps, AppExecutionContext } from "./context";
import { memoryRepo } from "./db/memory";
import type { Repo } from "./db/repo";

/**
 * The cross-cutting rules `app.ts` owns — routing, CSRF, the failure boundary —
 * as opposed to what any one handler answers. Those live beside their handlers.
 */

const NOOP_CTX: AppExecutionContext = { waitUntil: (): void => {} };

const T0 = 1_700_000_000_000;

function deps(over: Partial<AppDeps> = {}): AppDeps {
  const repo = memoryRepo();
  return {
    repo: (): Repo => repo,
    now: (): number => T0,
    newToken: (): string => "t".repeat(43),
    hashToken: (token: string): Promise<string> => Promise.resolve(`hash:${token}`),
    newSeed: (): number => 41762,
    mintSalt: (day: number): string => `salt-${day}`,
    newId: (bytes: number): string => "0".repeat(bytes * 2),
    logPepper: (): string => "pepper",
    emit: (): void => {},
    ...over,
  };
}

/** Deliberately not the fixture client: these tests need requests it would fix up. */
function send(
  method: string,
  path: string,
  init: RequestInit = {},
  overrides: Partial<AppDeps> = {},
): Promise<Response> {
  return createApp(deps(overrides))(
    new Request(`${SITE}${path}`, { method, ...init }),
    {
      get DB(): D1Database {
        throw new Error("no D1 binding in unit tests — inject deps.repo instead");
      },
    },
    NOOP_CTX,
  );
}

/** Every unsafe request from the real client carries this. */
const fromSite: RequestInit = { headers: { origin: SITE } };

describe("routing", () => {
  it("serves the health check", async () => {
    const response = await send("GET", "/api/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("answers 404 for an unknown path", async () => {
    const response = await send("GET", "/api/nope");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "not_found" });
  });

  it("answers 405 with an Allow header for a known path and wrong method", async () => {
    const response = await send("POST", "/api/health", fromSite);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });

  it("lists every method a path accepts in Allow", async () => {
    // `/api/me` is GET-only now that self-serve delete is gone (ADR 0025); the
    // multi-method join is covered against the router's own fixture in
    // `router.test.ts`.
    const response = await send("PUT", "/api/me", fromSite);
    expect(response.headers.get("allow")).toBe("GET");
  });
});

describe("CSRF", () => {
  it("rejects an unsafe request with no Origin", async () => {
    const response = await send("POST", "/api/games");
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "forbidden" });
  });

  it("rejects an unsafe request from another site", async () => {
    const response = await send("POST", "/api/games", {
      headers: { origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
  });

  it("lets an unsafe same-origin request through to its handler", async () => {
    // 400 rather than 403: the guard passed and the handler read the body.
    expect((await send("POST", "/api/games", fromSite)).status).toBe(400);
  });

  it("does not require an Origin on a safe method", async () => {
    expect((await send("GET", "/api/leaderboard")).status).toBe(200);
  });

  it("runs after routing, so an unknown path is still a 404", async () => {
    expect((await send("POST", "/api/nope")).status).toBe(404);
  });
});

describe("the endpoint table", () => {
  it("routes every endpoint to something that is not a stub", async () => {
    const client = createClient();
    const answers = await Promise.all([
      client.send("GET", "/api/health"),
      client.send("GET", "/api/me"),
      client.send("POST", "/api/games", { body: { memorizeMs: 5000 } }),
      client.send("POST", "/api/games/nope/result", { body: { guesses: [] } }),
      client.send("POST", "/api/name", { body: { name: "ada" } }),
      client.send("GET", "/api/leaderboard"),
    ]);
    expect(answers.map((response) => response.status)).toEqual([200, 204, 201, 422, 401, 200]);
  });
});

describe("responses", () => {
  it("never lets a response be cached", async () => {
    // Every one of these is identity-bearing. A shared cache serving one
    // player's identity to another only shows up in production, behind a CDN.
    for (const path of ["/api/health", "/api/me", "/api/leaderboard", "/api/nope"]) {
      expect((await send("GET", path)).headers.get("cache-control")).toBe("no-store");
    }
  });

  it("is JSON", async () => {
    expect((await send("GET", "/api/health")).headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
  });
});

describe("the failure boundary", () => {
  it("turns a throw into a 500 that describes nothing", async () => {
    const response = await send(
      "GET",
      "/api/health",
      {},
      {
        repo: (): Repo => {
          throw new Error("D1_ERROR: no such table: players");
        },
      },
    );
    expect(response.status).toBe(500);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ error: "internal" });
    expect(JSON.stringify(body)).not.toContain("players");
  });
});
