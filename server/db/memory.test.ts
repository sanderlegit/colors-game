import { describe, expect, it } from "vitest";
import { compareText, memoryRepo } from "./memory";
import type { NewGame, Repo } from "./repo";

/**
 * These tests are as much a specification of the Repo port as they are a test of
 * the double. Anything asserted here is something `d1.ts` has to do too — most
 * of all the behaviours the handlers' correctness rests on: duplicate names
 * ordered by `id` so rank agrees with the board (ADR 0024), and `finishGame`
 * refusing a second submission.
 */

const T0 = 1_700_000_000_000;

const newGame = (id: string, over: Partial<NewGame> = {}): NewGame => ({
  id,
  playerId: null,
  seed: 41762,
  difficulty: "normal",
  memorizeMs: 5000,
  kind: "open",
  startedAt: T0,
  ...over,
});

async function withPlayer(repo: Repo, hash: string): Promise<number> {
  const player = await repo.insertPlayer({ tokenHash: hash, at: T0 });
  return player.id;
}

/** A named player at a score, which is what it takes to reach the board. */
async function ranked(repo: Repo, hash: string, name: string, score: number): Promise<number> {
  const id = await withPlayer(repo, hash);
  await repo.setName({ playerId: id, name, key: name.toLowerCase(), at: T0 });
  await repo.insertGame(newGame(`g-${hash}`));
  await repo.finishGame({
    gameId: `g-${hash}`,
    playerId: id,
    totalScore: score,
    guessesJson: "[]",
    flags: 0,
    finishedAt: T0,
  });
  await repo.recordFinishedGame({
    playerId: id,
    gameId: `g-${hash}`,
    totalScore: score,
    ranked: true,
    at: T0,
  });
  return id;
}

describe("compareText", () => {
  it("orders by code point, the way SQLite's BINARY collation does", () => {
    // JavaScript's `<` compares UTF-16 code units, which puts an astral
    // character below U+E000. UTF-8 bytes — and therefore SQLite — do not.
    const astral = "🎨";
    const bmp = "\ue000";
    expect(compareText(astral, bmp)).toBeGreaterThan(0);
    expect(astral < bmp).toBe(true);
  });

  it("orders a prefix before the longer string", () => {
    expect(compareText("ada", "adam")).toBeLessThan(0);
  });

  it("reports equality as zero", () => {
    expect(compareText("ada", "ada")).toBe(0);
  });
});

describe("players", () => {
  it("assigns increasing ids and finds a player by token hash", async () => {
    const repo = memoryRepo();
    const first = await repo.insertPlayer({ tokenHash: "h1", at: T0 });
    const second = await repo.insertPlayer({ tokenHash: "h2", at: T0 });
    expect(second.id).toBeGreaterThan(first.id);
    await expect(repo.findPlayerByTokenHash("h1")).resolves.toMatchObject({ id: first.id });
  });

  it("starts a player blank", async () => {
    const repo = memoryRepo();
    expect(await repo.insertPlayer({ tokenHash: "h1", at: T0 })).toMatchObject({
      name: null,
      nameKey: null,
      nameChanges: 0,
      bestScore: 0,
      bestGameId: null,
      gamesPlayed: 0,
      createdAt: T0,
      lastSeenAt: T0,
    });
  });

  it("returns null for an unknown token hash", async () => {
    await expect(memoryRepo().findPlayerByTokenHash("nope")).resolves.toBeNull();
  });

  it("reproduces the unique constraint on token_hash", async () => {
    const repo = memoryRepo();
    await repo.insertPlayer({ tokenHash: "h1", at: T0 });
    await expect(repo.insertPlayer({ tokenHash: "h1", at: T0 })).rejects.toThrow(/UNIQUE/);
  });

  it("touches last seen without disturbing anything else", async () => {
    const repo = memoryRepo();
    const id = await withPlayer(repo, "h1");
    await repo.touchPlayer(id, T0 + 5000);
    await expect(repo.findPlayerByTokenHash("h1")).resolves.toMatchObject({
      lastSeenAt: T0 + 5000,
      createdAt: T0,
    });
  });

  it("is a no-op when touching a player who is gone, like an UPDATE would be", async () => {
    await expect(memoryRepo().touchPlayer(999, T0)).resolves.toBeUndefined();
  });
});

describe("setName", () => {
  it("stores the display name and the folded key", async () => {
    const repo = memoryRepo();
    const id = await withPlayer(repo, "h1");
    await expect(
      repo.setName({ playerId: id, name: "Ada", key: "ada", at: T0 }),
    ).resolves.toBeUndefined();
    await expect(repo.findPlayerByTokenHash("h1")).resolves.toMatchObject({
      name: "Ada",
      nameKey: "ada",
      nameChanges: 1,
      nameChangedAt: T0,
    });
  });

  it("lets two players hold the same name (ADR 0024)", async () => {
    // No uniqueness: both keep the name they typed. The board stays coherent
    // because its order carries an `id` tiebreak, not because names differ.
    const repo = memoryRepo();
    const first = await withPlayer(repo, "h1");
    const second = await withPlayer(repo, "h2");
    await repo.setName({ playerId: first, name: "Ada", key: "ada", at: T0 });
    await repo.setName({ playerId: second, name: "ADA", key: "ada", at: T0 });
    await expect(repo.findPlayerByTokenHash("h1")).resolves.toMatchObject({ name: "Ada" });
    await expect(repo.findPlayerByTokenHash("h2")).resolves.toMatchObject({
      name: "ADA",
      nameChanges: 1,
    });
  });

  it("overwrites a player's own name and bumps the change counter", async () => {
    const repo = memoryRepo();
    const id = await withPlayer(repo, "h1");
    await repo.setName({ playerId: id, name: "ada", key: "ada", at: T0 });
    await repo.setName({ playerId: id, name: "Ada", key: "ada", at: T0 + 1 });
    await expect(repo.findPlayerByTokenHash("h1")).resolves.toMatchObject({
      name: "Ada",
      nameChanges: 2,
      nameChangedAt: T0 + 1,
    });
  });
});

describe("games", () => {
  it("inserts an active game with no player attached", async () => {
    const repo = memoryRepo();
    await repo.insertGame(newGame("g1"));
    expect(await repo.findGame("g1")).toMatchObject({
      status: "active",
      playerId: null,
      totalScore: 0,
      guessesJson: null,
      flags: 0,
      finishedAt: null,
      seed: 41762,
      difficulty: "normal",
      memorizeMs: 5000,
    });
  });

  it("returns null for an unknown game", async () => {
    await expect(memoryRepo().findGame("nope")).resolves.toBeNull();
  });

  it("reproduces the primary-key violation on a duplicate id", async () => {
    const repo = memoryRepo();
    await repo.insertGame(newGame("g1"));
    await expect(repo.insertGame(newGame("g1"))).rejects.toThrow(/UNIQUE/);
  });
});

describe("finishGame — the single-use submit guard", () => {
  const finish = (repo: Repo, gameId: string, playerId: number): Promise<boolean> =>
    repo.finishGame({
      gameId,
      playerId,
      totalScore: 412,
      guessesJson: "[]",
      flags: 0,
      finishedAt: T0 + 60_000,
    });

  it("finalises an active game and records everything", async () => {
    const repo = memoryRepo();
    const id = await withPlayer(repo, "h1");
    await repo.insertGame(newGame("g1"));
    await expect(finish(repo, "g1", id)).resolves.toBe(true);
    expect(await repo.findGame("g1")).toMatchObject({
      status: "finished",
      playerId: id,
      totalScore: 412,
      guessesJson: "[]",
      finishedAt: T0 + 60_000,
    });
  });

  it("changes nothing on a second submission", async () => {
    // This is the whole replay defence. `false` here is the conditional UPDATE
    // matching zero rows — there is no read-then-check for a race to slip into.
    const repo = memoryRepo();
    const id = await withPlayer(repo, "h1");
    await repo.insertGame(newGame("g1"));
    await finish(repo, "g1", id);
    await expect(
      repo.finishGame({
        gameId: "g1",
        playerId: id,
        totalScore: 500,
        guessesJson: "[]",
        flags: 0,
        finishedAt: T0 + 90_000,
      }),
    ).resolves.toBe(false);
    expect(await repo.findGame("g1")).toMatchObject({ totalScore: 412, finishedAt: T0 + 60_000 });
  });

  it("refuses a game that never existed", async () => {
    const repo = memoryRepo();
    const id = await withPlayer(repo, "h1");
    await expect(finish(repo, "ghost", id)).resolves.toBe(false);
  });
});

describe("recordFinishedGame", () => {
  it("counts the game and takes the first best score", async () => {
    const repo = memoryRepo();
    const id = await withPlayer(repo, "h1");
    await expect(
      repo.recordFinishedGame({
        playerId: id,
        gameId: "g1",
        totalScore: 300,
        ranked: true,
        at: T0,
      }),
    ).resolves.toEqual({ bestScore: 300, isPersonalBest: true });
    await expect(repo.findPlayerByTokenHash("h1")).resolves.toMatchObject({
      gamesPlayed: 1,
      bestScore: 300,
      bestGameId: "g1",
    });
  });

  it("raises the best score and repoints best_game_id", async () => {
    const repo = memoryRepo();
    const id = await withPlayer(repo, "h1");
    await repo.recordFinishedGame({
      playerId: id,
      gameId: "g1",
      totalScore: 300,
      ranked: true,
      at: T0,
    });
    await expect(
      repo.recordFinishedGame({
        playerId: id,
        gameId: "g2",
        totalScore: 420,
        ranked: true,
        at: T0,
      }),
    ).resolves.toEqual({ bestScore: 420, isPersonalBest: true });
    await expect(repo.findPlayerByTokenHash("h1")).resolves.toMatchObject({
      gamesPlayed: 2,
      bestGameId: "g2",
    });
  });

  it("counts a worse game without touching the best", async () => {
    const repo = memoryRepo();
    const id = await withPlayer(repo, "h1");
    await repo.recordFinishedGame({
      playerId: id,
      gameId: "g1",
      totalScore: 300,
      ranked: true,
      at: T0,
    });
    await expect(
      repo.recordFinishedGame({
        playerId: id,
        gameId: "g2",
        totalScore: 100,
        ranked: true,
        at: T0,
      }),
    ).resolves.toEqual({ bestScore: 300, isPersonalBest: false });
    await expect(repo.findPlayerByTokenHash("h1")).resolves.toMatchObject({
      gamesPlayed: 2,
      bestGameId: "g1",
    });
  });

  it("does not treat equalling your own best as a new best", async () => {
    // Strictly greater is what keeps best_game_id on the first game to reach the
    // score, which is the only place the "first to achieve" idea survives.
    const repo = memoryRepo();
    const id = await withPlayer(repo, "h1");
    await repo.recordFinishedGame({
      playerId: id,
      gameId: "g1",
      totalScore: 300,
      ranked: true,
      at: T0,
    });
    await expect(
      repo.recordFinishedGame({
        playerId: id,
        gameId: "g2",
        totalScore: 300,
        ranked: true,
        at: T0,
      }),
    ).resolves.toEqual({ bestScore: 300, isPersonalBest: false });
  });

  it("counts a flagged game as played without letting it reach the board", async () => {
    // `players.best_score` is what the board is built from, so keeping a
    // flagged game off the board means keeping it out of that column — while
    // it stays on the player's own history.
    const repo = memoryRepo();
    const id = await withPlayer(repo, "h1");
    await repo.recordFinishedGame({
      playerId: id,
      gameId: "g1",
      totalScore: 300,
      ranked: true,
      at: T0,
    });
    await expect(
      repo.recordFinishedGame({
        playerId: id,
        gameId: "g2",
        totalScore: 500,
        ranked: false,
        at: T0,
      }),
    ).resolves.toEqual({ bestScore: 300, isPersonalBest: false });
    await expect(repo.findPlayerByTokenHash("h1")).resolves.toMatchObject({
      gamesPlayed: 2,
      bestScore: 300,
      bestGameId: "g1",
    });
  });

  it("advances last seen", async () => {
    const repo = memoryRepo();
    const id = await withPlayer(repo, "h1");
    await repo.recordFinishedGame({
      playerId: id,
      gameId: "g1",
      totalScore: 1,
      ranked: true,
      at: T0 + 999,
    });
    await expect(repo.findPlayerByTokenHash("h1")).resolves.toMatchObject({
      lastSeenAt: T0 + 999,
    });
  });

  it("throws for a player who does not exist", async () => {
    await expect(
      memoryRepo().recordFinishedGame({
        playerId: 42,
        gameId: "g1",
        totalScore: 1,
        ranked: true,
        at: T0,
      }),
    ).rejects.toThrow(/no such player/);
  });
});

describe("countGamesStartedSince", () => {
  it("counts only this player's games, and only since the cutoff", async () => {
    const repo = memoryRepo();
    const mine = await withPlayer(repo, "h1");
    const theirs = await withPlayer(repo, "h2");
    const attach = async (id: string, playerId: number, startedAt: number): Promise<void> => {
      await repo.insertGame(newGame(id, { startedAt }));
      await repo.finishGame({
        gameId: id,
        playerId,
        totalScore: 1,
        guessesJson: "[]",
        flags: 0,
        finishedAt: startedAt,
      });
    };
    await attach("old", mine, T0 - 100);
    await attach("new", mine, T0 + 100);
    await attach("other", theirs, T0 + 100);
    await expect(repo.countGamesStartedSince(mine, T0)).resolves.toBe(1);
    await expect(repo.countGamesStartedSince(mine, T0 - 1000)).resolves.toBe(2);
  });

  it("counts a game attached at mint time, before it is ever submitted", async () => {
    // This is what makes the per-player start limit a limit on *starting*. A
    // game minted for a known cookie is attributable immediately.
    const repo = memoryRepo();
    const id = await withPlayer(repo, "h1");
    await repo.insertGame(newGame("g1", { playerId: id }));
    await expect(repo.countGamesStartedSince(id, 0)).resolves.toBe(1);
  });

  it("sees nothing for a game minted without a cookie", async () => {
    // A first-time visitor owns nothing yet, so their starts are attributable
    // to nobody and the mint bucket is the only ceiling they have.
    const repo = memoryRepo();
    const id = await withPlayer(repo, "h1");
    await repo.insertGame(newGame("g1"));
    await expect(repo.countGamesStartedSince(id, 0)).resolves.toBe(0);
  });
});

describe("deletePlayer", () => {
  it("removes the player, their games, and their token", async () => {
    const repo = memoryRepo();
    const id = await ranked(repo, "h1", "Ada", 400);
    await repo.deletePlayer(id);
    await expect(repo.findPlayerByTokenHash("h1")).resolves.toBeNull();
    await expect(repo.findGame("g-h1")).resolves.toBeNull();
    await expect(repo.topPlayers(10)).resolves.toEqual([]);
  });

  it("leaves other players' games alone", async () => {
    const repo = memoryRepo();
    const first = await ranked(repo, "h1", "Ada", 400);
    await ranked(repo, "h2", "Grace", 460);
    await repo.deletePlayer(first);
    await expect(repo.findGame("g-h2")).resolves.not.toBeNull();
  });
});

describe("the board", () => {
  it("orders by score descending, then name ascending", async () => {
    const repo = memoryRepo();
    await ranked(repo, "h1", "Ada", 400);
    await ranked(repo, "h2", "Grace", 460);
    await ranked(repo, "h3", "Alan", 400);
    expect((await repo.topPlayers(10)).map((row) => row.name)).toEqual(["Grace", "Ada", "Alan"]);
  });

  it("honours the limit", async () => {
    const repo = memoryRepo();
    await ranked(repo, "h1", "Ada", 400);
    await ranked(repo, "h2", "Grace", 460);
    expect(await repo.topPlayers(1)).toHaveLength(1);
    expect(await repo.topPlayers(0)).toHaveLength(0);
  });

  it("excludes the unnamed and the scoreless, matching the partial index", async () => {
    const repo = memoryRepo();
    const nameless = await withPlayer(repo, "h1");
    await repo.recordFinishedGame({
      playerId: nameless,
      gameId: "g1",
      totalScore: 500,
      ranked: true,
      at: T0,
    });
    await ranked(repo, "h2", "Zero", 0);
    await ranked(repo, "h3", "Ada", 400);
    expect((await repo.topPlayers(10)).map((row) => row.name)).toEqual(["Ada"]);
  });

  it("carries the player id and best game, so a caller can mark and open its own row", async () => {
    const repo = memoryRepo();
    const id = await ranked(repo, "h1", "Ada", 400);
    expect(await repo.topPlayers(10)).toEqual([
      { playerId: id, name: "Ada", bestScore: 400, gameId: "g-h1" },
    ]);
  });
});

describe("the per-seed board (ADR 0026)", () => {
  /** A named player who finished one game on `seed`, scoring `score`. */
  async function onSeed(
    repo: Repo,
    hash: string,
    name: string,
    seed: number,
    score: number,
    over: { readonly id?: string; readonly kind?: "open" | "challenge" } = {},
  ): Promise<string> {
    const id = await withPlayer(repo, hash);
    await repo.setName({ playerId: id, name, key: name.toLowerCase(), at: T0 });
    const gameId = over.id ?? `g-${hash}-${seed}`;
    await repo.insertGame(newGame(gameId, { seed, kind: over.kind ?? "challenge" }));
    await repo.finishGame({
      gameId,
      playerId: id,
      totalScore: score,
      guessesJson: "[]",
      flags: 0,
      finishedAt: T0,
    });
    return gameId;
  }

  it("shows every player who played the seed, best score first, whatever the kind", async () => {
    const repo = memoryRepo();
    await onSeed(repo, "h1", "Ada", 100, 300, { kind: "challenge" });
    await onSeed(repo, "h2", "Grace", 100, 460, { kind: "open" });
    await onSeed(repo, "h3", "Alan", 999, 500, { kind: "challenge" }); // a different seed
    const board = await repo.topPlayersBySeed(100, 10);
    expect(board.map((row) => row.name)).toEqual(["Grace", "Ada"]);
  });

  it("keeps each player's best game on the seed, and names that game not their global best", async () => {
    const repo = memoryRepo();
    const id = await withPlayer(repo, "h1");
    await repo.setName({ playerId: id, name: "Ada", key: "ada", at: T0 });
    for (const [gameId, score] of [
      ["low", 200],
      ["high", 480],
    ] as const) {
      await repo.insertGame(newGame(gameId, { seed: 55, kind: "challenge" }));
      await repo.finishGame({
        gameId,
        playerId: id,
        totalScore: score,
        guessesJson: "[]",
        flags: 0,
        finishedAt: T0,
      });
    }
    expect(await repo.topPlayersBySeed(55, 10)).toEqual([
      { playerId: id, name: "Ada", bestScore: 480, gameId: "high" },
    ]);
  });

  it("excludes flagged and unnamed games, matching the global board's rules", async () => {
    const repo = memoryRepo();
    // Flagged: on the seed but off the board.
    const flagged = await withPlayer(repo, "h1");
    await repo.setName({ playerId: flagged, name: "Cheat", key: "cheat", at: T0 });
    await repo.insertGame(newGame("f1", { seed: 7, kind: "challenge" }));
    await repo.finishGame({
      gameId: "f1",
      playerId: flagged,
      totalScore: 500,
      guessesJson: "[]",
      flags: 1,
      finishedAt: T0,
    });
    // Unnamed: played the seed but has no name to show.
    const nameless = await withPlayer(repo, "h2");
    await repo.insertGame(newGame("n1", { seed: 7, kind: "challenge" }));
    await repo.finishGame({
      gameId: "n1",
      playerId: nameless,
      totalScore: 400,
      guessesJson: "[]",
      flags: 0,
      finishedAt: T0,
    });
    await onSeed(repo, "h3", "Ada", 7, 300);
    expect((await repo.topPlayersBySeed(7, 10)).map((row) => row.name)).toEqual(["Ada"]);
  });
});

describe("countPlayersAbove", () => {
  // A score that outsorts nobody, standing in for a hypothetical query row.
  const LAST = Number.MAX_SAFE_INTEGER;

  it("agrees with the board's own order for every row", async () => {
    // Rank and board position are displayed next to each other. If they can
    // disagree, that is a bug report — so the invariant is asserted directly.
    const repo = memoryRepo();
    await ranked(repo, "h1", "Ada", 400);
    await ranked(repo, "h2", "Grace", 460);
    await ranked(repo, "h3", "Alan", 400);
    await ranked(repo, "h4", "Bob", 120);
    const board = await repo.topPlayers(10);
    for (const [index, row] of board.entries()) {
      const above = await repo.countPlayersAbove({
        bestScore: row.bestScore,
        name: row.name,
        id: row.playerId,
      });
      expect(above).toBe(index);
    }
  });

  it("breaks a same-name, same-score tie by id, agreeing with the board (ADR 0024)", async () => {
    // Two players called `ada` on the same score. Without the `id` tiebreak
    // they would tie: both would count the same number above them, and the
    // counted rank would disagree with the two distinct board rows.
    const repo = memoryRepo();
    const first = await ranked(repo, "h1", "ada", 400);
    const second = await ranked(repo, "h2", "ada", 400);
    const board = await repo.topPlayers(10);
    expect(board.map((row) => row.playerId)).toEqual([first, second]);
    for (const [index, row] of board.entries()) {
      const above = await repo.countPlayersAbove({
        bestScore: row.bestScore,
        name: row.name,
        id: row.playerId,
      });
      expect(above).toBe(index);
    }
  });

  it("counts everybody for a score below the board", async () => {
    const repo = memoryRepo();
    await ranked(repo, "h1", "Ada", 400);
    await ranked(repo, "h2", "Grace", 460);
    await expect(repo.countPlayersAbove({ bestScore: 1, name: "zz", id: LAST })).resolves.toBe(2);
  });

  it("counts nobody for a score above the board", async () => {
    const repo = memoryRepo();
    await ranked(repo, "h1", "Ada", 400);
    await expect(repo.countPlayersAbove({ bestScore: 500, name: "Ada", id: LAST })).resolves.toBe(
      0,
    );
  });

  it("ignores players who are not on the board", async () => {
    const repo = memoryRepo();
    const nameless = await withPlayer(repo, "h1");
    await repo.recordFinishedGame({
      playerId: nameless,
      gameId: "g1",
      totalScore: 500,
      ranked: true,
      at: T0,
    });
    await expect(repo.countPlayersAbove({ bestScore: 10, name: "Ada", id: LAST })).resolves.toBe(0);
  });
});

describe("bumpMintBucket", () => {
  it("counts up within one bucket and day", async () => {
    const repo = memoryRepo();
    await expect(repo.bumpMintBucket("b", 20300)).resolves.toBe(1);
    await expect(repo.bumpMintBucket("b", 20300)).resolves.toBe(2);
  });

  it("keeps buckets and days apart", async () => {
    const repo = memoryRepo();
    await repo.bumpMintBucket("b", 20300);
    await expect(repo.bumpMintBucket("c", 20300)).resolves.toBe(1);
    await expect(repo.bumpMintBucket("b", 20301)).resolves.toBe(1);
  });

  it("does not let a bucket name collide across the key separator", async () => {
    const repo = memoryRepo();
    await repo.bumpMintBucket("a:1", 2);
    await expect(repo.bumpMintBucket("a", 12)).resolves.toBe(1);
  });
});
