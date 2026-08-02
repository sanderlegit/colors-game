import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { generateTarget } from "../src/domain/round";
import { ROUNDS_PER_GAME } from "../src/domain/state";
import { createClient, FIXTURE_SEED, GUESSES, playGame, startGame } from "./app.fixture";
import { minimumElapsedMs } from "./limits";
import {
  DELTA_E_BUCKET_CAP,
  dayKey,
  deltaEBucket,
  gameCounter,
  HUE_BUCKETS,
  hueBucket,
  submissionCounters,
} from "./telemetry";

const NORMAL = { difficulty: "normal", memorizeMs: 5000 } as const;
const AT = Date.UTC(2026, 7, 2, 13, 45);

describe("the ΔE bucket", () => {
  it("is the floor, so a bucket means [n, n+1)", () => {
    // SPEC §6 puts chance level near ΔE 11, which is only readable if 10, 11 and
    // 12 are three different buckets.
    expect(deltaEBucket(10.0)).toBe(10);
    expect(deltaEBucket(11.9999)).toBe(11);
    expect(deltaEBucket(12)).toBe(12);
  });

  it("caps rather than spreading a long tail over empty buckets", () => {
    expect(deltaEBucket(40)).toBe(DELTA_E_BUCKET_CAP);
    expect(deltaEBucket(400)).toBe(DELTA_E_BUCKET_CAP);
  });

  it("refuses to put a NaN into SQLite, which has no such value", () => {
    // A NaN stored as NULL poisons every later aggregate over the column.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY * 0, -1, -0.5]) {
      expect(deltaEBucket(bad)).toBe(0);
    }
    // Infinity is not finite, so it is corruption rather than a very bad round.
    expect(deltaEBucket(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("is monotone and always a key the table can hold", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 200, noNaN: true }), (deltaE) => {
        const bucket = deltaEBucket(deltaE);
        return Number.isInteger(bucket) && bucket >= 0 && bucket <= DELTA_E_BUCKET_CAP;
      }),
    );
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 100, noNaN: true }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        (a, b) => (a <= b ? deltaEBucket(a) <= deltaEBucket(b) : true),
      ),
    );
  });
});

describe("the hue bucket", () => {
  it("splits the wheel into twelve, so the opponent axes are pairs six apart", () => {
    expect(HUE_BUCKETS).toBe(12);
    expect(hueBucket(0)).toBe(0);
    expect(hueBucket(29.9)).toBe(0);
    expect(hueBucket(30)).toBe(1);
    // Red-ish and its opponent land six buckets apart, which is the comparison
    // ADR 0008 asked for and had no instrument for.
    expect(hueBucket(15)).toBe(0);
    expect(hueBucket(195)).toBe(6);
  });

  it("never lands outside the key range, including at the wrap point", () => {
    // 360 is the same hue as 0, and must land in that bucket rather than in a
    // thirteenth one the primary key does not expect.
    expect(hueBucket(360)).toBe(0);
    expect(hueBucket(359.9)).toBe(HUE_BUCKETS - 1);
    fc.assert(
      fc.property(fc.double({ min: -1000, max: 1000, noNaN: true }), (hue) => {
        const bucket = hueBucket(hue);
        return Number.isInteger(bucket) && bucket >= 0 && bucket < HUE_BUCKETS;
      }),
    );
    expect(hueBucket(Number.NaN)).toBe(0);
  });
});

describe("the day key", () => {
  it("is a UTC date and not a timestamp", () => {
    // A timestamp would make two games by one player on one day distinguishable,
    // which is exactly what ADR 0014 is avoiding.
    expect(dayKey(AT)).toBe("2026-08-02");
    expect(dayKey(Date.UTC(2026, 7, 2, 23, 59, 59))).toBe("2026-08-02");
    expect(dayKey(Date.UTC(2026, 7, 3, 0, 0, 0))).toBe("2026-08-03");
  });
});

describe("a submission's counters", () => {
  const scored = submissionCounters({
    ...NORMAL,
    at: AT,
    deltaEs: [0.4, 5.2, 11.8, 24, 51],
    targetHues: [10, 100, 190, 280, 350],
    flags: 0,
  });

  it("writes one row per round, carrying the round index", () => {
    expect(scored.rounds).toHaveLength(5);
    expect(scored.rounds.map((row) => row.roundIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(scored.rounds.map((row) => row.deltaEBucket)).toEqual([0, 5, 11, 24, 40]);
    expect(scored.rounds.map((row) => row.hueBucket)).toEqual([0, 3, 6, 9, 11]);
  });

  it("carries the memorize window, which is the only difficulty knob v1 exposes", () => {
    // `decodeStartGame` refuses any tier but `normal`, so without this column
    // "does the memorize setting change anything" is unanswerable.
    for (const row of scored.rounds) {
      expect(row).toMatchObject({ day: "2026-08-02", difficulty: "normal", memorizeMs: 5000 });
    }
  });

  it("counts the completion once and says nothing about who", () => {
    expect(scored.games).toEqual([
      { day: "2026-08-02", difficulty: "normal", memorizeMs: 5000, event: "completed" },
    ]);
  });

  it("counts a flagged game alongside the completion, never instead of it", () => {
    // ADR 0015: a flagged game still counts as played. It is only kept out of
    // `players.best_score`.
    const flagged = submissionCounters({
      ...NORMAL,
      at: AT,
      deltaEs: [0.1],
      targetHues: [1],
      flags: 3,
    });
    expect(flagged.games.map((row) => row.event)).toEqual(["completed", "flagged"]);
  });

  it("drops a round whose target hue is missing rather than inventing one", () => {
    const short = submissionCounters({
      ...NORMAL,
      at: AT,
      deltaEs: [1, 2, 3],
      targetHues: [10],
      flags: 0,
    });
    expect(short.rounds).toHaveLength(1);
  });
});

describe("a game counter", () => {
  it("names the day, the tier and the window", () => {
    expect(gameCounter(NORMAL, AT, "started")).toEqual({
      day: "2026-08-02",
      difficulty: "normal",
      memorizeMs: 5000,
      event: "started",
    });
  });
});

/**
 * The counters as the handlers actually write them.
 *
 * The unit tests above prove the buckets; these prove the *wiring*, which is the
 * half that has been missing since ADR 0014 was accepted — `round_stats` existed
 * as a decision and as nothing else, so ADR 0008's "look here if scores skew"
 * had nothing to look at.
 */
describe("written from the handlers", () => {
  it("counts a mint as started and a submission as completed", async () => {
    const client = createClient();
    await playGame(client);
    const { games } = client.repo.telemetry();
    expect(games.map((row) => [row.event, row.n])).toEqual([
      ["started", 1],
      ["completed", 1],
    ]);
  });

  it("writes one round row per round, from the row's own tier and window", async () => {
    const client = createClient();
    await playGame(client, { memorizeMs: 8000 });
    const { rounds } = client.repo.telemetry();
    expect(rounds).toHaveLength(ROUNDS_PER_GAME);
    expect(rounds.map((row) => row.roundIndex).sort()).toEqual([0, 1, 2, 3, 4]);
    for (const row of rounds) {
      expect(row.memorizeMs).toBe(8000);
      expect(row.difficulty).toBe("normal");
      expect(row.hueBucket).toBeGreaterThanOrEqual(0);
      expect(row.hueBucket).toBeLessThan(HUE_BUCKETS);
    }
  });

  it("buckets the target hue, not the guess", async () => {
    // The instrument only detects an afterimage skew if it is keyed by what the
    // player was shown. Bucketing the guess would measure the bias by the thing
    // the bias moves.
    const client = createClient();
    await playGame(client);
    const expected = Array.from({ length: ROUNDS_PER_GAME }, (_unused, index) =>
      hueBucket(generateTarget(FIXTURE_SEED, index, "normal").h),
    );
    const written = client.repo
      .telemetry()
      .rounds.slice()
      .sort((a, b) => a.roundIndex - b.roundIndex)
      .map((row) => row.hueBucket);
    expect(written).toEqual(expected);
  });

  it("does not count a resubmitted game twice", async () => {
    // A dropped response is indistinguishable from a lost request, so the client
    // may retry — and a completion rate that counted the retry would be wrong in
    // exactly the population that had a bad connection.
    const client = createClient();
    const { gameId } = await startGame(client);
    client.setNow(client.now() + minimumElapsedMs(5000, ROUNDS_PER_GAME));
    for (let n = 0; n < 3; n += 1) {
      const response = await client.send("POST", `/api/games/${gameId}/result`, {
        body: { guesses: GUESSES },
      });
      expect(response.status).toBe(200);
    }
    const { games, rounds } = client.repo.telemetry();
    expect(games.find((row) => row.event === "completed")?.n).toBe(1);
    expect(rounds.every((row) => row.n === 1)).toBe(true);
  });

  it("counts a flagged game as completed and as flagged", async () => {
    const client = createClient();
    // Every guess exactly on the target: two exact rounds is FLAG_EXACT_MATCH.
    const exact = Array.from({ length: ROUNDS_PER_GAME }, (_unused, index) =>
      generateTarget(FIXTURE_SEED, index, "normal"),
    );
    await playGame(client, { guesses: exact });
    const events = client.repo.telemetry().games.map((row) => row.event);
    expect(events).toContain("completed");
    expect(events).toContain("flagged");
  });

  it("records nothing at all for a submission that was refused", async () => {
    const client = createClient();
    const { gameId } = await startGame(client);
    // Submitted immediately: too fast to have been played.
    expect(
      (await client.send("POST", `/api/games/${gameId}/result`, { body: { guesses: GUESSES } }))
        .status,
    ).toBe(422);
    expect(client.repo.telemetry().rounds).toHaveLength(0);
    expect(client.repo.telemetry().games.map((row) => row.event)).toEqual(["started"]);
  });

  it("aggregates rather than accumulating rows", async () => {
    // The property the whole design rests on: write volume tracks distinct
    // buckets, not games played.
    const client = createClient();
    for (let n = 0; n < 5; n += 1) await playGame(client);
    const { games } = client.repo.telemetry();
    expect(games.find((row) => row.event === "completed")).toMatchObject({ n: 5 });
    // Five identical games hit the same five buckets.
    expect(client.repo.telemetry().rounds).toHaveLength(ROUNDS_PER_GAME);
  });
});
