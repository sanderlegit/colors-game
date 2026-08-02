import { describe, expect, it } from "vitest";
import { ROUNDS_PER_GAME } from "../../src/domain/state";
import { createClient, FIXTURE_SEED, jsonRecord, playGame, startGame } from "../app.fixture";
import { ANON_GAMES_PER_BUCKET_PER_DAY, GAMES_PER_PLAYER_PER_HOUR } from "../limits";

describe("POST /api/games", () => {
  it("issues a game the client can play", async () => {
    const client = createClient();
    const response = await client.send("POST", "/api/games", { body: { memorizeMs: 5000 } });
    expect(response.status).toBe(201);
    await expect(jsonRecord(response)).resolves.toEqual({
      gameId: "tok-1",
      seed: FIXTURE_SEED,
      // Sent rather than assumed, so a client built against a different round
      // count fails visibly instead of submitting the wrong number of guesses.
      roundsTotal: ROUNDS_PER_GAME,
    });
  });

  it("stores the settings it was asked for, and the tier it is willing to issue", async () => {
    const client = createClient();
    const { gameId } = await startGame(client, { memorizeMs: 8000 });
    expect(await client.repo.findGame(gameId)).toMatchObject({
      status: "active",
      memorizeMs: 8000,
      difficulty: "normal",
      playerId: null,
      totalScore: 0,
      flags: 0,
    });
  });

  it("refuses a memorize window that is not on offer", async () => {
    const client = createClient();
    const response = await client.send("POST", "/api/games", { body: { memorizeMs: 60_000 } });
    expect(response.status).toBe(422);
  });

  it("refuses a difficulty the client could not honour", async () => {
    const client = createClient();
    const response = await client.send("POST", "/api/games", {
      body: { memorizeMs: 5000, difficulty: "hard" },
    });
    expect(response.status).toBe(422);
  });

  it("refuses a body that is not readable", async () => {
    const client = createClient();
    const response = await client.send("POST", "/api/games", {
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(400);
  });

  it("mints no cookie and no player row", async () => {
    // The identity is created on first submission and nowhere else. A drive-by
    // visitor who starts a game and closes the tab leaves one orphan row.
    const client = createClient();
    const response = await client.send("POST", "/api/games", { body: { memorizeMs: 5000 } });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(client.token()).toBeNull();
  });

  it("attaches the player when the request already carries a cookie", async () => {
    // This is what makes the per-player start limit see a game before it is
    // submitted. Without it the counter is blind at mint time.
    const client = createClient();
    await playGame(client);
    const { gameId } = await startGame(client);
    const game = await client.repo.findGame(gameId);
    expect(game?.playerId).not.toBeNull();
    await expect(client.repo.countGamesStartedSince(game?.playerId ?? 0, 0)).resolves.toBe(2);
  });
});

describe("start limits", () => {
  it("stops a known player after their hourly allowance", async () => {
    const client = createClient();
    await playGame(client);
    for (let n = 1; n < GAMES_PER_PLAYER_PER_HOUR; n += 1) await startGame(client);

    const response = await client.send("POST", "/api/games", { body: { memorizeMs: 5000 } });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("3600");
    await expect(jsonRecord(response)).resolves.toMatchObject({ error: "rate_limited" });
  });

  it("lets the same player start again once the window has moved", async () => {
    const client = createClient();
    await playGame(client);
    for (let n = 1; n < GAMES_PER_PLAYER_PER_HOUR; n += 1) await startGame(client);
    client.setNow(client.now() + 60 * 60 * 1000 + 1);
    expect((await client.send("POST", "/api/games", { body: { memorizeMs: 5000 } })).status).toBe(
      201,
    );
  });

  it("counts an anonymous start against the day's bucket instead", async () => {
    const client = createClient();
    for (let n = 0; n < ANON_GAMES_PER_BUCKET_PER_DAY; n += 1) {
      expect((await startGame(client, { ip: "203.0.113.9" })).gameId).toBeTruthy();
    }
    const response = await client.send("POST", "/api/games", {
      body: { memorizeMs: 5000 },
      ip: "203.0.113.9",
      cookie: null,
    });
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("keeps one address's anonymous starts away from another's", async () => {
    const client = createClient();
    for (let n = 0; n < ANON_GAMES_PER_BUCKET_PER_DAY; n += 1) {
      await startGame(client, { ip: "203.0.113.9" });
    }
    expect(
      (
        await client.send("POST", "/api/games", {
          body: { memorizeMs: 5000 },
          ip: "198.51.100.4",
        })
      ).status,
    ).toBe(201);
  });

  it("rotates the bucket with the day", async () => {
    // Tomorrow's salt is a different secret, so today's count cannot follow the
    // address into it — which is the same property that stops yesterday's
    // buckets being re-derived from an address.
    const client = createClient();
    for (let n = 0; n < ANON_GAMES_PER_BUCKET_PER_DAY; n += 1) {
      await startGame(client, { ip: "203.0.113.9" });
    }
    client.setNow(client.now() + 24 * 60 * 60 * 1000);
    expect(
      (await client.send("POST", "/api/games", { body: { memorizeMs: 5000 }, ip: "203.0.113.9" }))
        .status,
    ).toBe(201);
  });
});
