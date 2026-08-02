import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { oklch } from "../../src/color/types";
import { generateTarget } from "../../src/domain/round";
import { scoreGuess } from "../../src/domain/scoring";
import { ROUNDS_PER_GAME } from "../../src/domain/state";
import {
  createClient,
  FIXTURE_SEED,
  GUESSES,
  jsonRecord,
  playGame,
  startGame,
} from "../app.fixture";
import type { FinishGame, Repo } from "../db/repo";
import { IDENTITIES_PER_BUCKET_PER_DAY, minimumElapsedMs } from "../limits";
import { FLAG_EXACT_MATCH, FLAG_IMPROBABLE_ACCURACY } from "../replay";

const MAX_TOTAL = 100 * ROUNDS_PER_GAME;

/** The five targets the fixture's seed produces, as the client would derive them. */
const targets = Array.from({ length: ROUNDS_PER_GAME }, (_, index) =>
  generateTarget(FIXTURE_SEED, index, "normal"),
);

describe("POST /api/games/:gameId/result", () => {
  it("scores a played game and answers the client's whole contract", async () => {
    const client = createClient();
    const response = await playGame(client);
    expect(response.status).toBe(200);

    const body = await jsonRecord(response);
    expect(Object.keys(body).sort()).toEqual([
      "claimed",
      "isPersonalBest",
      "name",
      "rank",
      "rounds",
      "totalScore",
    ]);
    expect(body).toMatchObject({ isPersonalBest: true, name: null, claimed: false, rank: 1 });
    expect(body.rounds).toHaveLength(ROUNDS_PER_GAME);
  });

  it("replays the server's own targets, not the client's arithmetic", async () => {
    // The guesses go in; nothing else the client sends is read. Each round has
    // to come back as the pure core scores it against the seed we issued.
    const client = createClient();
    const body = await jsonRecord(await playGame(client));
    const expected = GUESSES.map((guess, index) =>
      scoreGuess(targets[index] ?? oklch(0, 0, 0), oklch(guess.L ?? 0, guess.c ?? 0, guess.h ?? 0)),
    );
    expect(body.rounds).toEqual(expected.map(({ deltaE, score }) => ({ deltaE, score })));
  });

  it("stores the rounded total as the integer the board orders on", async () => {
    const client = createClient();
    const { gameId } = await startGame(client);
    client.setNow(client.now() + minimumElapsedMs(5000, ROUNDS_PER_GAME));
    const body = await jsonRecord(
      await client.send("POST", `/api/games/${gameId}/result`, { body: { guesses: GUESSES } }),
    );
    const stored = await client.repo.findGame(gameId);
    expect(stored?.totalScore).toBe(body.totalScore);
    expect(Number.isInteger(stored?.totalScore)).toBe(true);
    expect(stored?.status).toBe("finished");
  });

  it("mints the identity here, and only here", async () => {
    const client = createClient();
    const response = await playGame(client);
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Domain");
    // Stored as a hash, never as the token itself.
    await expect(
      client.repo.findPlayerByTokenHash(`hash:${client.token()}`),
    ).resolves.not.toBeNull();
  });

  it("reuses the identity the cookie already names", async () => {
    const client = createClient();
    await playGame(client);
    const first = client.token();
    const second = await playGame(client);
    expect(second.headers.get("set-cookie")).toBeNull();
    expect(client.token()).toBe(first);
    const player = await client.repo.findPlayerByTokenHash(`hash:${first}`);
    expect(player?.gamesPlayed).toBe(2);
  });

  it("takes the name with the submission", async () => {
    const client = createClient();
    const body = await jsonRecord(await playGame(client, { name: " Ada " }));
    expect(body).toMatchObject({ name: "Ada", claimed: true });
  });

  it("lets a name somebody else already holds be set too (ADR 0024)", async () => {
    const first = createClient();
    await playGame(first, { name: "Ada" });
    // A second player against the same database, with their own cookie jar.
    const second = createClient({ repo: () => first.repo }, "b");
    // Names are not unique, so it lands as typed — no suffix.
    const body = await jsonRecord(await playGame(second, { name: "ADA" }));
    expect(body).toMatchObject({ name: "ADA", claimed: true });
  });
});

describe("what a submission has to be", () => {
  it("refuses a game that never existed", async () => {
    const client = createClient();
    const response = await client.send("POST", "/api/games/nosuch/result", {
      body: { guesses: GUESSES },
    });
    expect(response.status).toBe(404);
  });

  it("refuses anything but exactly five in-range guesses", async () => {
    const client = createClient();
    const { gameId } = await startGame(client);
    client.setNow(client.now() + minimumElapsedMs(5000, ROUNDS_PER_GAME));
    const cases: readonly unknown[][] = [
      GUESSES.slice(0, 4),
      [...GUESSES, GUESSES[0]],
      [{ L: 2, c: 0.1, h: 10 }, ...GUESSES.slice(1)],
      [{ L: 0.5, c: 0.1, h: Number.NaN }, ...GUESSES.slice(1)],
      [{ L: 0.5, c: 0.1, h: Number.POSITIVE_INFINITY }, ...GUESSES.slice(1)],
    ];
    for (const guesses of cases) {
      const response = await client.send("POST", `/api/games/${gameId}/result`, {
        body: { guesses },
      });
      expect(response.status).toBe(422);
    }
    // No partial credit: the game is still active and still submittable.
    expect((await client.repo.findGame(gameId))?.status).toBe("active");
  });

  it("refuses a body that is not readable at all", async () => {
    const client = createClient();
    const { gameId } = await startGame(client);
    const response = await client.send("POST", `/api/games/${gameId}/result`, {
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(400);
  });

  it("refuses a game that came back faster than it can be played", async () => {
    const client = createClient();
    const { gameId } = await startGame(client, { memorizeMs: 8000 });
    client.setNow(client.now() + minimumElapsedMs(8000, ROUNDS_PER_GAME) - 1);
    const response = await client.send("POST", `/api/games/${gameId}/result`, {
      body: { guesses: GUESSES },
    });
    expect(response.status).toBe(422);
    await expect(jsonRecord(response)).resolves.toMatchObject({ error: "too_fast" });
  });

  it("measures that against the row's memorize window, never the body's", async () => {
    // The whole point of reading `memorize_ms` from the row: a client that could
    // restate it would claim 3000 for a game issued at 8000 and cut the required
    // playtime from 43 seconds to 18.
    const client = createClient();
    const { gameId } = await startGame(client, { memorizeMs: 8000 });
    client.setNow(client.now() + minimumElapsedMs(3000, ROUNDS_PER_GAME));
    const response = await client.send("POST", `/api/games/${gameId}/result`, {
      body: { guesses: GUESSES, memorizeMs: 3000 },
    });
    expect(response.status).toBe(422);
  });

  it("refuses a game older than half an hour", async () => {
    const client = createClient();
    const { gameId } = await startGame(client);
    client.setNow(client.now() + 30 * 60 * 1000 + 1);
    const response = await client.send("POST", `/api/games/${gameId}/result`, {
      body: { guesses: GUESSES },
    });
    expect(response.status).toBe(410);
  });
});

describe("submitting twice", () => {
  it("answers a retry with the identical body and counts one game", async () => {
    const client = createClient();
    const { gameId } = await startGame(client);
    client.setNow(client.now() + minimumElapsedMs(5000, ROUNDS_PER_GAME));
    const send = (): Promise<Response> =>
      client.send("POST", `/api/games/${gameId}/result`, {
        body: { guesses: GUESSES, name: "Ada" },
      });

    const first = await jsonRecord(await send());
    const second = await send();
    expect(second.status).toBe(200);
    await expect(jsonRecord(second)).resolves.toEqual(first);

    const player = await client.repo.findPlayerByTokenHash(`hash:${client.token()}`);
    expect(player?.gamesPlayed).toBe(1);
    expect(player?.nameChanges).toBe(1);
  });

  it("refuses somebody else's finished game", async () => {
    const owner = createClient();
    const { gameId } = await startGame(owner);
    owner.setNow(owner.now() + minimumElapsedMs(5000, ROUNDS_PER_GAME));
    await owner.send("POST", `/api/games/${gameId}/result`, { body: { guesses: GUESSES } });

    const thief = createClient({ repo: () => owner.repo }, "b");
    thief.setNow(owner.now());
    const response = await thief.send("POST", `/api/games/${gameId}/result`, {
      body: { guesses: GUESSES },
    });
    expect(response.status).toBe(409);
  });

  it("refuses a stranger with no cookie at all", async () => {
    const client = createClient();
    const { gameId } = await startGame(client);
    client.setNow(client.now() + minimumElapsedMs(5000, ROUNDS_PER_GAME));
    await client.send("POST", `/api/games/${gameId}/result`, { body: { guesses: GUESSES } });
    const response = await client.send("POST", `/api/games/${gameId}/result`, {
      body: { guesses: GUESSES },
      cookie: null,
    });
    expect(response.status).toBe(409);
  });
});

describe("losing the race and other unhappy paths", () => {
  it("answers 409 when another player finished the game between the read and the write", async () => {
    // `finishGame` returning false is the entire replay defence: there is no
    // read-then-check for a race to slip into, so the handler has to be able to
    // lose it and still answer sensibly.
    const shared = createClient();
    await playGame(shared, { name: "Ada" });
    const owner = await shared.repo.findPlayerByTokenHash(`hash:${shared.token()}`);

    const client = createClient(
      {
        repo: (): Repo => ({
          ...shared.repo,
          async finishGame(input: FinishGame): Promise<boolean> {
            // Somebody else got there first, with the same conditional update.
            await shared.repo.finishGame({ ...input, playerId: owner?.id ?? 0 });
            return shared.repo.finishGame(input);
          },
        }),
      },
      "r",
    );
    client.setNow(shared.now());

    const { gameId } = await startGame(client);
    client.setNow(client.now() + minimumElapsedMs(5000, ROUNDS_PER_GAME));
    const response = await client.send("POST", `/api/games/${gameId}/result`, {
      body: { guesses: GUESSES },
    });
    expect(response.status).toBe(409);
  });

  it("refuses to mint identities past the day's ceiling", async () => {
    const host = createClient();
    for (let n = 0; n < IDENTITIES_PER_BUCKET_PER_DAY; n += 1) {
      const player = createClient({ repo: (): Repo => host.repo }, `p${n}`);
      player.setNow(host.now());
      expect((await playGame(player, { ip: "203.0.113.9" })).status).toBe(200);
    }

    const oneTooMany = createClient({ repo: (): Repo => host.repo }, "last");
    oneTooMany.setNow(host.now());
    const response = await playGame(oneTooMany, { ip: "203.0.113.9" });
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("turns a corrupt stored game into a 500 rather than a wrong score", async () => {
    // We wrote `guesses_json`, so a row that will not narrow is a schema
    // divergence. Failing at the seam beats replaying whatever it parsed to.
    const client = createClient();
    await playGame(client);
    const player = await client.repo.findPlayerByTokenHash(`hash:${client.token()}`);

    await client.repo.insertGame({
      id: "corrupt",
      playerId: player?.id ?? null,
      seed: FIXTURE_SEED,
      difficulty: "normal",
      memorizeMs: 5000,
      startedAt: client.now(),
    });
    await client.repo.finishGame({
      gameId: "corrupt",
      playerId: player?.id ?? 0,
      totalScore: 500,
      guessesJson: "not json",
      flags: 0,
      finishedAt: client.now(),
    });

    const response = await client.send("POST", "/api/games/corrupt/result", {
      body: { guesses: GUESSES },
    });
    expect(response.status).toBe(500);
    await expect(jsonRecord(response)).resolves.toMatchObject({ error: "internal" });
  });
});

describe("the flags nobody is told about", () => {
  /** Submit the targets themselves for the first `n` rounds. */
  async function submitExact(rounds: number): Promise<{ flags: number; status: number }> {
    const client = createClient();
    const { gameId } = await startGame(client);
    client.setNow(client.now() + minimumElapsedMs(5000, ROUNDS_PER_GAME));
    const guesses = GUESSES.map((guess, index) => {
      const target = targets[index];
      return index < rounds && target !== undefined
        ? { L: target.L, c: target.c, h: target.h }
        : guess;
    });
    const response = await client.send("POST", `/api/games/${gameId}/result`, {
      body: { guesses },
    });
    const game = await client.repo.findGame(gameId);
    return { flags: game?.flags ?? -1, status: response.status };
  }

  it("lets one bit-exact round pass as the coincidence it might be", async () => {
    expect(await submitExact(1)).toEqual({ flags: 0, status: 200 });
  });

  it("flags two, because a hand does not do that twice", async () => {
    expect(await submitExact(2)).toEqual({ flags: FLAG_EXACT_MATCH, status: 200 });
  });

  it("flags a whole game inside the perceptibility threshold", async () => {
    const { flags } = await submitExact(ROUNDS_PER_GAME);
    expect(flags & FLAG_IMPROBABLE_ACCURACY).toBe(FLAG_IMPROBABLE_ACCURACY);
  });

  it("keeps a flagged game off the board without telling the player", async () => {
    const client = createClient();
    await playGame(client, { name: "Ada" });
    const honest = await client.repo.findPlayerByTokenHash(`hash:${client.token()}`);

    const { gameId } = await startGame(client);
    client.setNow(client.now() + minimumElapsedMs(5000, ROUNDS_PER_GAME));
    const response = await client.send("POST", `/api/games/${gameId}/result`, {
      body: { guesses: targets.map((target) => ({ L: target.L, c: target.c, h: target.h })) },
    });

    // An ordinary 200, and a perfect score that never reaches `best_score`.
    expect(response.status).toBe(200);
    await expect(jsonRecord(response)).resolves.toMatchObject({
      totalScore: MAX_TOTAL,
      isPersonalBest: false,
    });
    const after = await client.repo.findPlayerByTokenHash(`hash:${client.token()}`);
    expect(after?.bestScore).toBe(honest?.bestScore);
    expect(after?.gamesPlayed).toBe(2);
  });
});

describe("the replay is the pure core, not a copy of it", () => {
  it("scores any five in-range guesses exactly as scoreGuess does", async () => {
    // The single most likely way for client and server to diverge is a second
    // implementation of the curve. This asserts the handler *imports* the one
    // the client ran: every round, the total, and the bounds.
    const coordinate = fc.record({
      L: fc.double({ min: 0, max: 1, noNaN: true }),
      c: fc.double({ min: 0, max: 0.5, noNaN: true }),
      h: fc.double({ min: 0, max: 359.999, noNaN: true }),
    });

    await fc.assert(
      fc.asyncProperty(fc.array(coordinate, { minLength: 5, maxLength: 5 }), async (guesses) => {
        const client = createClient();
        const { gameId, seed } = await startGame(client);
        client.setNow(client.now() + minimumElapsedMs(5000, ROUNDS_PER_GAME));
        const body = await jsonRecord(
          await client.send("POST", `/api/games/${gameId}/result`, { body: { guesses } }),
        );

        const expected = guesses.map((guess, index) =>
          scoreGuess(generateTarget(seed, index, "normal"), oklch(guess.L, guess.c, guess.h)),
        );
        expect(body.rounds).toEqual(expected.map(({ deltaE, score }) => ({ deltaE, score })));
        expect(body.totalScore).toBe(
          Math.round(expected.reduce((sum, round) => sum + round.score, 0)),
        );
        expect(body.totalScore).toBeGreaterThanOrEqual(0);
        expect(body.totalScore).toBeLessThanOrEqual(MAX_TOTAL);
      }),
      { numRuns: 40 },
    );
  });
});
