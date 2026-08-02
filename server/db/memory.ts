/**
 * The Repo test double: Maps, no SQL, no I/O.
 *
 * A double is only worth having if it fails where the real thing fails, so four
 * behaviours are reproduced deliberately rather than allowed to fall out:
 *
 * 1. **Unique violations.** `token_hash` and `games.id` reject duplicates here
 *    too. Display names are deliberately *not* among them (ADR 0024): two
 *    players may hold the same name, and the board order falls back to `id` to
 *    stay total — reproduced in `byBoardOrder` and `countPlayersAbove` below.
 * 2. **The conditional update returns false.** `finishGame` only changes a row
 *    that is still `active`, and reports whether it changed one. That is the
 *    single-use submit guard; a double that always answers `true` would let a
 *    replay bug ship with green tests.
 * 3. **The board's collation.** SQLite's default TEXT collation is BINARY,
 *    which orders by UTF-8 bytes — the same order as code points. JavaScript's
 *    `<` orders by UTF-16 code units, which disagrees for anything above the
 *    BMP against U+E000..U+FFFF. One emoji in a name is enough to hit it, so
 *    names are compared by code point below.
 * 4. **Deleting a player deletes their games**, matching what `d1.ts` does
 *    explicitly rather than what `ON DELETE CASCADE` does if the PRAGMA happens
 *    to be on.
 * 5. **The sweep passes are bounded and take the oldest rows first**, in the
 *    same order the SQL's `ORDER BY` gives. A double that swept everything in
 *    one go would make `server/sweep.test.ts`'s "the LIMIT actually bounds a
 *    large batch" case pass against a lie, which is the case most worth having.
 *
 * `Player` carries no `tokenHash` field — handlers have no use for one, and a
 * credential that is not in the object cannot be logged by accident — so the
 * lookup index is kept beside the rows here, as it is in the table.
 */

import type {
  AggregateResult,
  BoardRow,
  ClientErrorReport,
  ExpireStaleGames,
  FinishGame,
  Game,
  GameCounter,
  NewGame,
  NewPlayer,
  Player,
  PurgeClientErrors,
  PurgeMintBuckets,
  PurgeOrphanPlayers,
  RankKey,
  Repo,
  RoundCounter,
  TelemetryWrite,
} from "./repo";

/** SQLite BINARY collation: UTF-8 byte order, which is code point order. */
export function compareText(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i += 1) {
    const x = left[i];
    const y = right[i];
    if (x === undefined || y === undefined) break;
    const dx = x.codePointAt(0) ?? 0;
    const dy = y.codePointAt(0) ?? 0;
    if (dx !== dy) return dx - dy;
  }
  return left.length - right.length;
}

/** The `players_board` index's WHERE clause, in one place. */
function isRanked(player: Player): boolean {
  return player.nameKey !== null && player.bestScore > 0;
}

function byBoardOrder(a: Player, b: Player): number {
  // `id` last so the order stays total when two players share a name (ADR 0024).
  return b.bestScore - a.bestScore || compareText(a.name ?? "", b.name ?? "") || a.id - b.id;
}

/** A counter row with the count the upserts have reached. */
export type CountedRound = RoundCounter & { readonly n: number };
export type CountedGame = GameCounter & { readonly n: number };
export type StoredClientError = ClientErrorReport & { readonly n: number };

/**
 * The double, plus three readers the port deliberately does not have.
 *
 * `recordTelemetry` and `recordClientError` are write-only in `Repo` because
 * nothing in a request reads them back — the questions they answer are asked in
 * `docs/OPERATIONS.md` with SQL, days later. A test still has to be able to see
 * what was written, so the readers live on the double rather than widening the
 * port for the benefit of tests.
 */
export type MemoryRepo = Repo & {
  telemetry(): {
    readonly rounds: readonly CountedRound[];
    readonly games: readonly CountedGame[];
  };
  clientErrors(): readonly StoredClientError[];
};

/** A `mint_buckets` row. `day` is kept beside the count so the sweep can order on it. */
type MintCell = { readonly day: number; readonly count: number };

export function memoryRepo(): MemoryRepo {
  const players = new Map<number, Player>();
  const tokenIndex = new Map<string, number>();
  const games = new Map<string, Game>();
  const mintBuckets = new Map<string, MintCell>();
  const roundStats = new Map<string, CountedRound>();
  const gameStats = new Map<string, CountedGame>();
  const errorRows = new Map<string, StoredClientError>();
  let nextPlayerId = 1;

  /**
   * A row the caller has already authenticated is missing only if the caller has
   * a bug, so this throws — which is also what the D1 adapter does when its
   * `RETURNING` clause comes back empty.
   */
  function load(playerId: number): Player {
    const player = players.get(playerId);
    if (player === undefined) throw new Error(`no such player: ${playerId}`);
    return player;
  }

  function ranked(): readonly Player[] {
    return [...players.values()].filter(isRanked).sort(byBoardOrder);
  }

  /** What `d1.ts` does in a two-statement batch: the games go with the player. */
  function removePlayer(playerId: number): void {
    for (const [id, game] of games) {
      if (game.playerId === playerId) games.delete(id);
    }
    for (const [hash, id] of tokenIndex) {
      if (id === playerId) tokenIndex.delete(hash);
    }
    players.delete(playerId);
  }

  return {
    async findPlayerByTokenHash(tokenHash: string): Promise<Player | null> {
      const id = tokenIndex.get(tokenHash);
      return id === undefined ? null : load(id);
    },

    async insertPlayer(input: NewPlayer): Promise<Player> {
      if (tokenIndex.has(input.tokenHash)) {
        throw new Error("UNIQUE constraint failed: players.token_hash");
      }
      const player: Player = {
        id: nextPlayerId,
        name: null,
        nameKey: null,
        nameChanges: 0,
        nameChangedAt: null,
        bestScore: 0,
        bestGameId: null,
        gamesPlayed: 0,
        createdAt: input.at,
        lastSeenAt: input.at,
      };
      nextPlayerId += 1;
      players.set(player.id, player);
      tokenIndex.set(input.tokenHash, player.id);
      return player;
    },

    async touchPlayer(playerId: number, at: number): Promise<void> {
      const player = players.get(playerId);
      // A no-op on a missing row, like `UPDATE ... WHERE id = ?` would be.
      if (player !== undefined) players.set(playerId, { ...player, lastSeenAt: at });
    },

    async countGamesStartedSince(playerId: number, since: number): Promise<number> {
      let count = 0;
      for (const game of games.values()) {
        if (game.playerId === playerId && game.startedAt >= since) count += 1;
      }
      return count;
    },

    async insertGame(input: NewGame): Promise<void> {
      if (games.has(input.id)) throw new Error("UNIQUE constraint failed: games.id");
      games.set(input.id, {
        id: input.id,
        playerId: input.playerId,
        status: "active",
        seed: input.seed,
        difficulty: input.difficulty,
        memorizeMs: input.memorizeMs,
        totalScore: 0,
        guessesJson: null,
        flags: 0,
        kind: input.kind,
        startedAt: input.startedAt,
        finishedAt: null,
      });
    },

    async findGame(gameId: string): Promise<Game | null> {
      return games.get(gameId) ?? null;
    },

    async finishGame(input: FinishGame): Promise<boolean> {
      const game = games.get(input.gameId);
      if (game === undefined || game.status !== "active") return false;
      games.set(input.gameId, {
        ...game,
        playerId: input.playerId,
        status: "finished",
        totalScore: input.totalScore,
        guessesJson: input.guessesJson,
        flags: input.flags,
        finishedAt: input.finishedAt,
      });
      return true;
    },

    async recordFinishedGame(input: {
      readonly playerId: number;
      readonly gameId: string;
      readonly totalScore: number;
      readonly ranked: boolean;
      readonly at: number;
    }): Promise<AggregateResult> {
      const player = load(input.playerId);
      // Strictly greater: equalling your own best is not a new best, which is
      // also what keeps `best_game_id` pointing at the first game to reach it.
      const isPersonalBest = input.ranked && input.totalScore > player.bestScore;
      const updated: Player = {
        ...player,
        gamesPlayed: player.gamesPlayed + 1,
        bestScore: isPersonalBest ? input.totalScore : player.bestScore,
        bestGameId: isPersonalBest ? input.gameId : player.bestGameId,
        lastSeenAt: input.at,
      };
      players.set(updated.id, updated);
      return { bestScore: updated.bestScore, isPersonalBest };
    },

    async setName(input: {
      readonly playerId: number;
      readonly name: string;
      readonly key: string;
      readonly at: number;
    }): Promise<void> {
      // No uniqueness check: names may repeat (ADR 0024). A player overwriting
      // their own name still bumps the change counter, matching the UPDATE.
      const player = load(input.playerId);
      players.set(player.id, {
        ...player,
        name: input.name,
        nameKey: input.key,
        nameChanges: player.nameChanges + 1,
        nameChangedAt: input.at,
      });
    },

    async deletePlayer(playerId: number): Promise<void> {
      removePlayer(playerId);
    },

    async topPlayers(limit: number): Promise<readonly BoardRow[]> {
      const max = Math.max(0, limit);
      const rows: BoardRow[] = [];
      for (const player of ranked()) {
        if (rows.length >= max) break;
        // `bestGameId` is non-null whenever `bestScore > 0` — the two move
        // together in `recordFinishedGame` — but the filter makes that a fact of
        // this query rather than a trusted invariant, matching `d1.ts`.
        if (player.bestGameId === null) continue;
        rows.push({
          playerId: player.id,
          name: player.name ?? "",
          bestScore: player.bestScore,
          gameId: player.bestGameId,
        });
      }
      return rows;
    },

    async topPlayersBySeed(seed: number, limit: number): Promise<readonly BoardRow[]> {
      // Best finished, unflagged game per named player on this seed, ties broken
      // by game id ascending — the same order the D1 window uses.
      const best = new Map<number, Game>();
      for (const game of games.values()) {
        if (game.seed !== seed || game.status !== "finished" || game.flags !== 0) continue;
        if (game.playerId === null) continue;
        const player = players.get(game.playerId);
        if (player === undefined || player.nameKey === null) continue;
        const current = best.get(game.playerId);
        const better =
          current === undefined ||
          game.totalScore > current.totalScore ||
          (game.totalScore === current.totalScore && compareText(game.id, current.id) < 0);
        if (better) best.set(game.playerId, game);
      }
      return (
        [...best.values()]
          .map((game) => ({
            playerId: game.playerId ?? 0,
            name: players.get(game.playerId ?? 0)?.name ?? "",
            bestScore: game.totalScore,
            gameId: game.id,
          }))
          // `playerId` last, the same total order the global board uses now that
          // names repeat (ADR 0024 on main).
          .sort(
            (a, b) =>
              b.bestScore - a.bestScore || compareText(a.name, b.name) || a.playerId - b.playerId,
          )
          .slice(0, Math.max(0, limit))
      );
    },

    async countPlayersAbove(key: RankKey): Promise<number> {
      let count = 0;
      for (const player of ranked()) {
        const sameScore = player.bestScore === key.bestScore;
        const better =
          player.bestScore > key.bestScore ||
          (sameScore && compareText(player.name ?? "", key.name) < 0) ||
          // Names are not unique (ADR 0024); `id` breaks a same-name tie so this
          // count agrees with the board row's position.
          (sameScore && compareText(player.name ?? "", key.name) === 0 && player.id < key.id);
        if (better) count += 1;
      }
      return count;
    },

    async bumpMintBucket(bucket: string, day: number): Promise<number> {
      const key = `${day}:${bucket}`;
      const count = (mintBuckets.get(key)?.count ?? 0) + 1;
      mintBuckets.set(key, { day, count });
      return count;
    },

    async recordTelemetry(input: TelemetryWrite): Promise<void> {
      for (const round of input.rounds) {
        const key = [
          round.day,
          round.difficulty,
          round.memorizeMs,
          round.roundIndex,
          round.deltaEBucket,
          round.hueBucket,
        ].join("/");
        roundStats.set(key, { ...round, n: (roundStats.get(key)?.n ?? 0) + 1 });
      }
      for (const game of input.games) {
        const key = [game.day, game.difficulty, game.memorizeMs, game.event].join("/");
        gameStats.set(key, { ...game, n: (gameStats.get(key)?.n ?? 0) + 1 });
      }
    },

    async recordClientError(input: ClientErrorReport): Promise<number> {
      // The purge is reproduced because it is what makes the 30-day retention
      // true; a double that kept everything would let a leak ship green.
      for (const [key, stored] of errorRows) {
        if (stored.day < input.keepFromDay) errorRows.delete(key);
      }
      const key = `${input.day}/${input.fingerprint}`;
      const existing = errorRows.get(key);
      const n = (existing?.n ?? 0) + 1;
      errorRows.set(key, { ...(existing ?? input), at: input.at, n });
      return n;
    },

    async expireStaleGames(input: ExpireStaleGames): Promise<number> {
      const stale = [...games.values()]
        .filter((game) => game.status === "active" && game.startedAt < input.startedBefore)
        .sort((a, b) => a.startedAt - b.startedAt)
        .slice(0, input.limit);
      for (const game of stale) games.set(game.id, { ...game, status: "expired" });
      return stale.length;
    },

    async deleteMintBucketsBefore(input: PurgeMintBuckets): Promise<number> {
      const past = [...mintBuckets.entries()]
        .filter(([, cell]) => cell.day < input.beforeDay)
        .sort(([, a], [, b]) => a.day - b.day)
        .slice(0, input.limit);
      for (const [key] of past) mintBuckets.delete(key);
      return past.length;
    },

    async deleteClientErrorsBefore(input: PurgeClientErrors): Promise<number> {
      const past = [...errorRows.entries()]
        .filter(([, row]) => row.day < input.beforeDay)
        .sort(([, a], [, b]) => compareText(a.day, b.day))
        .slice(0, input.limit);
      for (const [key] of past) errorRows.delete(key);
      return past.length;
    },

    async deleteOrphanedPlayers(input: PurgeOrphanPlayers): Promise<number> {
      const orphans = [...players.values()]
        .filter((player) => player.gamesPlayed === 0 && player.createdAt < input.createdBefore)
        .sort((a, b) => a.id - b.id)
        .slice(0, input.limit);
      for (const orphan of orphans) removePlayer(orphan.id);
      return orphans.length;
    },

    async ping(): Promise<boolean> {
      return true;
    },

    telemetry: (): {
      readonly rounds: readonly CountedRound[];
      readonly games: readonly CountedGame[];
    } => ({ rounds: [...roundStats.values()], games: [...gameStats.values()] }),

    clientErrors: (): readonly StoredClientError[] => [...errorRows.values()],
  };
}
