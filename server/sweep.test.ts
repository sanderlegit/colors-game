import { describe, expect, it } from "vitest";
import type { AppDeps } from "./context";
import { memoryRepo } from "./db/memory";
import type { Repo } from "./db/repo";
import {
  CLIENT_ERROR_RETENTION_DAYS,
  DAY_MS,
  dayNumber,
  GAME_TTL_MS,
  ORPHAN_PLAYER_MAX_AGE_MS,
} from "./limits";
import { SWEEP_EVENT } from "./log";
import { createSweep, SWEEP_BATCH_LIMIT, sweep } from "./sweep";
import { dayKey } from "./telemetry";

/**
 * The sweep against `memoryRepo()`, which reproduces the bounds and the ordering
 * of the SQL in `d1.ts` deliberately — see the header of `db/memory.ts`.
 *
 * The negative cases carry the weight here. Every pass deletes real rows and one
 * of them deletes real player identities, so "it removed what it should" is only
 * half the assertion; the half worth having is that a recent active game, a
 * player who has finished a game, and today's mint bucket all survive.
 */

/** An arbitrary fixed instant, well past every retention window. */
const NOW = 1_800_000_000_000;

function stubDeps(repo: Repo, lines: string[], now = NOW): AppDeps {
  return {
    repo: (): Repo => repo,
    now: (): number => now,
    newToken: (): string => "tok",
    hashToken: (token: string): Promise<string> => Promise.resolve(`hash:${token}`),
    newSeed: (): number => 1,
    mintSalt: (): string => "salt",
    newId: (): string => "id",
    logPepper: (): string => "pepper",
    emit: (line: string): void => {
      lines.push(line);
    },
  };
}

const CONTROLLER: ScheduledController = {
  scheduledTime: NOW,
  cron: "17 4 * * *",
  noRetry: (): void => undefined,
};

/** `deps.repo` is always replaced, so nothing ever reads the binding. */
function fakeEnv(): Env {
  return {
    get DB(): D1Database {
      throw new Error("no D1 binding in unit tests");
    },
  };
}

function record(lines: readonly string[]): Record<string, unknown> {
  expect(lines).toHaveLength(1);
  const line = lines[0];
  if (line === undefined) throw new Error("no log line");
  const parsed: unknown = JSON.parse(line);
  if (typeof parsed !== "object" || parsed === null) throw new Error("not a JSON object");
  return { ...parsed };
}

async function addGame(repo: Repo, id: string, startedAt: number): Promise<void> {
  await repo.insertGame({
    id,
    playerId: null,
    seed: 1,
    difficulty: "normal",
    memorizeMs: 5000,
    kind: "open",
    startedAt,
  });
}

async function addPlayer(repo: Repo, token: string, at: number): Promise<number> {
  const player = await repo.insertPlayer({ tokenHash: token, at });
  return player.id;
}

describe("nothing to sweep", () => {
  it("still reports every pass", async () => {
    const outcome = await sweep(memoryRepo(), NOW);
    expect(outcome.counts).toEqual({
      games_expired: 0,
      mint_buckets_deleted: 0,
      client_errors_deleted: 0,
      orphan_players_deleted: 0,
    });
    expect(outcome.failed).toEqual([]);
    expect(outcome.capped).toEqual([]);
    expect(outcome.error).toBeNull();
  });

  it("still logs, because a silent run is indistinguishable from no run", async () => {
    const lines: string[] = [];
    const repo = memoryRepo();
    await createSweep(stubDeps(repo, lines))(CONTROLLER, fakeEnv());

    const logged = record(lines);
    expect(logged.event).toBe(SWEEP_EVENT);
    expect(logged.level).toBe("info");
    expect(logged["sweep.rows"]).toBe(0);
    expect(logged["sweep.cron"]).toBe("17 4 * * *");
    expect(logged["sweep.games_expired"]).toBe(0);
    // Nothing to report is a field that is absent, not one that is empty.
    expect(logged["sweep.failed"]).toBeUndefined();
    expect(logged["sweep.capped"]).toBeUndefined();
  });
});

describe("stale active games", () => {
  it("expires a game past the submit TTL", async () => {
    const repo = memoryRepo();
    await addGame(repo, "old", NOW - GAME_TTL_MS - 1);

    const outcome = await sweep(repo, NOW);

    expect(outcome.counts.games_expired).toBe(1);
    expect((await repo.findGame("old"))?.status).toBe("expired");
  });

  it("leaves a game still inside its TTL alone", async () => {
    const repo = memoryRepo();
    await addGame(repo, "fresh", NOW - GAME_TTL_MS + 1000);

    const outcome = await sweep(repo, NOW);

    expect(outcome.counts.games_expired).toBe(0);
    expect((await repo.findGame("fresh"))?.status).toBe("active");
  });

  it("does not touch a finished game, however old", async () => {
    const repo = memoryRepo();
    const at = NOW - 400 * DAY_MS;
    await addGame(repo, "done", at);
    const playerId = await addPlayer(repo, "hash:done", at);
    await repo.finishGame({
      gameId: "done",
      playerId,
      totalScore: 300,
      guessesJson: "[]",
      flags: 0,
      finishedAt: at,
    });
    // The second half of what `handlers/submit.ts` does. Without it the player
    // is an orphan and the orphan pass takes the game with them — which is the
    // right outcome, and not what this test is about.
    await repo.recordFinishedGame({ playerId, gameId: "done", totalScore: 300, ranked: true, at });

    await sweep(repo, NOW);

    expect((await repo.findGame("done"))?.status).toBe("finished");
  });

  it("expires rather than deletes, so the row is still readable", async () => {
    // The submit path answers 410 from `started_at`; the status is what makes
    // the state visible to anything that looks at the table.
    const repo = memoryRepo();
    await addGame(repo, "old", NOW - GAME_TTL_MS - 1);

    await sweep(repo, NOW);

    expect(await repo.findGame("old")).not.toBeNull();
  });
});

describe("mint buckets", () => {
  it("deletes a past day's buckets", async () => {
    const repo = memoryRepo();
    await repo.bumpMintBucket("bucket-a", dayNumber(NOW) - 1);
    await repo.bumpMintBucket("bucket-b", dayNumber(NOW) - 30);

    const outcome = await sweep(repo, NOW);

    expect(outcome.counts.mint_buckets_deleted).toBe(2);
  });

  it("keeps today's, which is the one still being counted against", async () => {
    const repo = memoryRepo();
    const today = dayNumber(NOW);
    await repo.bumpMintBucket("bucket-a", today);
    await repo.bumpMintBucket("bucket-a", today);

    const outcome = await sweep(repo, NOW);

    expect(outcome.counts.mint_buckets_deleted).toBe(0);
    // The counter is intact, not reset: a swept ceiling is a lifted rate limit.
    expect(await repo.bumpMintBucket("bucket-a", today)).toBe(3);
  });
});

describe("client errors", () => {
  const report = (day: string, fingerprint: string) => ({
    fingerprint,
    day,
    message: "boom",
    stack: null,
    at: NOW,
    // Past everything, so the write-side purge in `recordClientError` cannot be
    // what removes the rows and the sweep is the only thing under test.
    keepFromDay: "1970-01-01",
  });

  it("deletes rows past the retention window", async () => {
    const repo = memoryRepo();
    await repo.recordClientError(
      report(dayKey(NOW - (CLIENT_ERROR_RETENTION_DAYS + 1) * DAY_MS), "a"),
    );

    const outcome = await sweep(repo, NOW);

    expect(outcome.counts.client_errors_deleted).toBe(1);
    expect(await repo.clientErrors()).toEqual([]);
  });

  it("keeps rows inside it", async () => {
    const repo = memoryRepo();
    await repo.recordClientError(report(dayKey(NOW - 2 * DAY_MS), "b"));

    const outcome = await sweep(repo, NOW);

    expect(outcome.counts.client_errors_deleted).toBe(0);
    expect(await repo.clientErrors()).toHaveLength(1);
  });
});

describe("orphaned players", () => {
  it("deletes a player who never finished a game", async () => {
    const repo = memoryRepo();
    await addPlayer(repo, "hash:orphan", NOW - ORPHAN_PLAYER_MAX_AGE_MS - 1);

    const outcome = await sweep(repo, NOW);

    expect(outcome.counts.orphan_players_deleted).toBe(1);
    expect(await repo.findPlayerByTokenHash("hash:orphan")).toBeNull();
  });

  it("never deletes a player with a game played, however idle", async () => {
    const repo = memoryRepo();
    const playerId = await addPlayer(repo, "hash:real", NOW - 400 * DAY_MS);
    await repo.recordFinishedGame({
      playerId,
      gameId: "g",
      totalScore: 400,
      ranked: true,
      at: NOW - 400 * DAY_MS,
    });

    const outcome = await sweep(repo, NOW);

    expect(outcome.counts.orphan_players_deleted).toBe(0);
    expect(await repo.findPlayerByTokenHash("hash:real")).not.toBeNull();
  });

  it("never deletes a named player, even at zero games (the reset landmine)", async () => {
    // A bulk `UPDATE players SET games_played = 0` (migrations/0005, the score
    // retune's board reset) leaves real, named identities at zero games. Without
    // the `name_key` guard the orphan pass reaps them along with their name — the
    // opposite of what the reset promised to keep. See ADR 0011/0023.
    const repo = memoryRepo();
    const playerId = await addPlayer(repo, "hash:named", NOW - 400 * DAY_MS);
    await repo.setName({ playerId, name: "Ada", key: "ada", at: NOW - 400 * DAY_MS });

    const outcome = await sweep(repo, NOW);

    expect(outcome.counts.orphan_players_deleted).toBe(0);
    expect(await repo.findPlayerByTokenHash("hash:named")).not.toBeNull();
  });

  it("keeps a fresh orphan inside the 7-day window", async () => {
    const repo = memoryRepo();
    await addPlayer(repo, "hash:new", NOW - ORPHAN_PLAYER_MAX_AGE_MS + 1000);

    const outcome = await sweep(repo, NOW);

    expect(outcome.counts.orphan_players_deleted).toBe(0);
    expect(await repo.findPlayerByTokenHash("hash:new")).not.toBeNull();
  });

  it("takes the orphan's games with it", async () => {
    const repo = memoryRepo();
    const at = NOW - ORPHAN_PLAYER_MAX_AGE_MS - 1;
    const playerId = await addPlayer(repo, "hash:orphan", at);
    await repo.insertGame({
      id: "abandoned",
      playerId,
      seed: 1,
      difficulty: "normal",
      memorizeMs: 5000,
      kind: "open",
      startedAt: at,
    });

    await sweep(repo, NOW);

    expect(await repo.findGame("abandoned")).toBeNull();
  });
});

describe("the batch limit", () => {
  it("bounds a large batch and says it was capped", async () => {
    const repo = memoryRepo();
    const day = dayNumber(NOW) - 1;
    for (let i = 0; i < SWEEP_BATCH_LIMIT + 25; i += 1) {
      await repo.bumpMintBucket(`bucket-${i}`, day);
    }

    const first = await sweep(repo, NOW);
    expect(first.counts.mint_buckets_deleted).toBe(SWEEP_BATCH_LIMIT);
    expect(first.capped).toEqual(["mint_buckets_deleted"]);

    // And the next run finishes the backlog rather than starting it again.
    const second = await sweep(repo, NOW);
    expect(second.counts.mint_buckets_deleted).toBe(25);
    expect(second.capped).toEqual([]);
  });

  it("reports the cap in the log line", async () => {
    const repo = memoryRepo();
    const day = dayNumber(NOW) - 1;
    for (let i = 0; i < SWEEP_BATCH_LIMIT; i += 1) {
      await repo.bumpMintBucket(`bucket-${i}`, day);
    }
    const lines: string[] = [];

    await createSweep(stubDeps(repo, lines))(CONTROLLER, fakeEnv());

    expect(record(lines)["sweep.capped"]).toBe("mint_buckets_deleted");
  });

  it("takes the oldest rows first, so a capped pass makes progress", async () => {
    const repo = memoryRepo();
    // Two days' worth, more than one pass can take. The older day must go first
    // or a permanently capped sweep would never reach it.
    for (let i = 0; i < SWEEP_BATCH_LIMIT; i += 1) {
      await repo.bumpMintBucket(`new-${i}`, dayNumber(NOW) - 1);
    }
    for (let i = 0; i < 10; i += 1) {
      await repo.bumpMintBucket(`old-${i}`, dayNumber(NOW) - 90);
    }

    await sweep(repo, NOW);

    // The ten old rows are gone; ten of the newer ones are left behind.
    const left = await sweep(repo, NOW);
    expect(left.counts.mint_buckets_deleted).toBe(10);
  });
});

describe("one failing pass", () => {
  /** A repo whose mint-bucket purge is broken and whose other three are not. */
  function brokenRepo(): Repo {
    const repo = memoryRepo();
    return {
      ...repo,
      deleteMintBucketsBefore: (): Promise<number> => {
        throw new Error("D1_ERROR: no such table: mint_buckets");
      },
    };
  }

  it("does not stop the others", async () => {
    const repo = brokenRepo();
    await addGame(repo, "old", NOW - GAME_TTL_MS - 1);
    await addPlayer(repo, "hash:orphan", NOW - ORPHAN_PLAYER_MAX_AGE_MS - 1);

    const outcome = await sweep(repo, NOW);

    expect(outcome.failed).toEqual(["mint_buckets_deleted"]);
    expect(outcome.counts.mint_buckets_deleted).toBe(0);
    // The two passes on either side of the broken one both ran.
    expect(outcome.counts.games_expired).toBe(1);
    expect(outcome.counts.orphan_players_deleted).toBe(1);
  });

  it("logs at error level, names the pass and carries the message", async () => {
    const lines: string[] = [];

    await createSweep(stubDeps(brokenRepo(), lines))(CONTROLLER, fakeEnv());

    const logged = record(lines);
    expect(logged.level).toBe("error");
    expect(logged["sweep.failed"]).toBe("mint_buckets_deleted");
    expect(logged["sweep.error"]).toBe("D1_ERROR: no such table: mint_buckets");
  });

  it("does not throw out of the handler", async () => {
    const lines: string[] = [];
    const sweeper = createSweep(stubDeps(brokenRepo(), lines));

    await expect(sweeper(CONTROLLER, fakeEnv())).resolves.toBeUndefined();
  });
});

describe("a repo that cannot be built at all", () => {
  it("is one log line, not an unhandled rejection", async () => {
    const lines: string[] = [];
    const deps: AppDeps = {
      ...stubDeps(memoryRepo(), lines),
      repo: (): Repo => {
        throw new Error("no D1 binding");
      },
    };

    await expect(createSweep(deps)(CONTROLLER, fakeEnv())).resolves.toBeUndefined();

    const logged = record(lines);
    expect(logged.level).toBe("error");
    expect(logged["sweep.failed"]).toBe(
      "games_expired,mint_buckets_deleted,client_errors_deleted,orphan_players_deleted",
    );
    expect(logged["sweep.error"]).toBe("no D1 binding");
  });
});

describe("the log line carries nothing a request would", () => {
  it("has no player key, no path and no headers", async () => {
    const lines: string[] = [];
    const repo = memoryRepo();
    await addPlayer(repo, "hash:orphan", NOW - ORPHAN_PLAYER_MAX_AGE_MS - 1);

    await createSweep(stubDeps(repo, lines))(CONTROLLER, fakeEnv());

    const logged = record(lines);
    // A sweep touches every row of a table and belongs to nobody. Anything
    // per-caller in here would be a field with no honest value to hold.
    expect(logged["player.key"]).toBeUndefined();
    expect(logged["url.path"]).toBeUndefined();
    expect(logged["user_agent.original"]).toBeUndefined();
    expect(JSON.stringify(logged)).not.toContain("hash:");
  });
});
