/**
 * The D1 adapter. **Every SQL statement in this system lives in this file.**
 *
 * That is the rule that makes `memory.ts` a legitimate double: a query built in
 * a handler is a query no test can reproduce, and the first one to appear there
 * quietly turns the handler suite into decoration.
 *
 * ## Rows are narrowed, not asserted
 *
 * D1 hands back `Record<string, unknown>`. The tempting move is
 * `first<PlayerRow>()`, which type-checks and is a lie — the generic asserts a
 * shape nobody verified. Instead each column is read through a narrowing helper
 * that throws on a mismatch. We wrote these rows, so a row that fails to narrow
 * means the schema and this file have diverged, and failing loudly at the seam
 * beats a `NaN` propagating into a score.
 *
 * ## Not covered by unit tests
 *
 * This file is excluded from the coverage floor in `vitest.config.ts`: it is
 * reachable only with a real D1 binding, so it is exercised by `wrangler dev`
 * and e2e rather than by vitest. Everything with a decision in it lives behind
 * the Repo port in code that *is* covered.
 */

import type { Difficulty } from "../../src/domain/round";
import { asEnum, asFiniteNumber } from "../../src/shared/decode";
import type {
  AggregateResult,
  BoardRow,
  ClientErrorReport,
  ExpireStaleGames,
  FinishGame,
  Game,
  GameKind,
  GameStatus,
  NewGame,
  NewPlayer,
  Player,
  PurgeClientErrors,
  PurgeMintBuckets,
  PurgeOrphanPlayers,
  RankKey,
  Repo,
  TelemetryWrite,
} from "./repo";

const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];
const STATUSES: readonly GameStatus[] = ["active", "finished", "expired"];
const KINDS: readonly GameKind[] = ["open", "challenge"];

const PLAYER_COLUMNS =
  "id, name, name_key, name_changes, name_changed_at, best_score, best_game_id, games_played, created_at, last_seen_at";
const GAME_COLUMNS =
  "id, player_id, status, seed, difficulty, memorize_ms, total_score, guesses_json, flags, kind, started_at, finished_at, name, name_key";

function corrupt(column: string): never {
  throw new Error(`unreadable column from D1: ${column}`);
}

function num(row: Record<string, unknown>, column: string): number {
  return asFiniteNumber(row[column]) ?? corrupt(column);
}

function nullableNum(row: Record<string, unknown>, column: string): number | null {
  return row[column] === null ? null : num(row, column);
}

function text(row: Record<string, unknown>, column: string): string {
  const value = row[column];
  return typeof value === "string" ? value : corrupt(column);
}

function nullableText(row: Record<string, unknown>, column: string): string | null {
  return row[column] === null ? null : text(row, column);
}

function toPlayer(row: Record<string, unknown>): Player {
  return {
    id: num(row, "id"),
    name: nullableText(row, "name"),
    nameKey: nullableText(row, "name_key"),
    nameChanges: num(row, "name_changes"),
    nameChangedAt: nullableNum(row, "name_changed_at"),
    bestScore: num(row, "best_score"),
    bestGameId: nullableText(row, "best_game_id"),
    gamesPlayed: num(row, "games_played"),
    createdAt: num(row, "created_at"),
    lastSeenAt: num(row, "last_seen_at"),
  };
}

function toGame(row: Record<string, unknown>): Game {
  return {
    id: text(row, "id"),
    playerId: nullableNum(row, "player_id"),
    status: asEnum(row.status, STATUSES) ?? corrupt("status"),
    seed: num(row, "seed"),
    difficulty: asEnum(row.difficulty, DIFFICULTIES) ?? corrupt("difficulty"),
    memorizeMs: num(row, "memorize_ms"),
    totalScore: num(row, "total_score"),
    guessesJson: nullableText(row, "guesses_json"),
    flags: num(row, "flags"),
    kind: asEnum(row.kind, KINDS) ?? corrupt("kind"),
    startedAt: num(row, "started_at"),
    finishedAt: nullableNum(row, "finished_at"),
    name: nullableText(row, "name"),
    nameKey: nullableText(row, "name_key"),
  };
}

/**
 * The orphan set, written once and interpolated into both statements of
 * `deleteOrphanedPlayers` so that they cannot select different rows. It is a
 * constant with no caller input in it; the cutoff and the limit are bound.
 *
 * `name_key IS NULL` is load-bearing, not belt-and-braces. ADR 0011/0023 justify
 * this pass on the premise that a `games_played = 0` row "holds no name and no
 * board position, so nothing is lost". That premise held only because a name can
 * only be claimed after a finished game (`handlers/name.ts`). A bulk
 * `UPDATE players SET games_played = 0` — as the leaderboard reset does
 * (`migrations/0005`) — breaks it, leaving named identities that would otherwise
 * be swept. Gating on `name_key` restores the invariant the pass claims to have.
 */
const ORPHAN_PLAYERS = `SELECT id FROM players
   WHERE games_played = 0 AND name_key IS NULL AND created_at < ?1
   ORDER BY id
   LIMIT ?2`;

/**
 * A leaderboard entry set (ADR 0029). One row per `(player_id, name_key)`: the
 * best finished, unflagged, `open` game a player played *under a given name*. The
 * name comes from the game (`g.name`), snapshotted at submission, never from the
 * mutable `players` row — so a rename cannot rewrite an entry, and two names on
 * one identity (a shared device) are two entries. `kind = 'open'` keeps
 * challenge games off the global board (ADR 0026); the seed board drops that
 * filter and adds `g.seed`. The window's `total_score DESC, g.id ASC` picks one
 * game per group deterministically; the caller supplies the outer order.
 *
 * This exact predicate is the partial index `games_name_board` (migration 0006).
 */
const BOARD_ENTRIES = `SELECT player_id, name, best_score, game_id FROM (
    SELECT g.player_id AS player_id, g.name AS name,
           g.total_score AS best_score, g.id AS game_id,
           ROW_NUMBER() OVER (
             PARTITION BY g.player_id, g.name_key ORDER BY g.total_score DESC, g.id ASC
           ) AS rn
      FROM games g
     WHERE g.status = 'finished' AND g.flags = 0 AND g.kind = 'open'
       AND g.name_key IS NOT NULL AND g.total_score > 0
  ) WHERE rn = 1`;

export function d1Repo(db: D1Database): Repo {
  /** `first()` without a type argument is already `Record<string, unknown>` — no assertion. */
  function firstRow(
    query: string,
    ...bindings: readonly unknown[]
  ): Promise<Record<string, unknown> | null> {
    return db
      .prepare(query)
      .bind(...bindings)
      .first();
  }

  async function count(query: string, ...bindings: readonly unknown[]): Promise<number> {
    const row = await firstRow(query, ...bindings);
    return row === null ? 0 : num(row, "n");
  }

  return {
    async findPlayerByTokenHash(tokenHash: string): Promise<Player | null> {
      const row = await firstRow(
        `SELECT ${PLAYER_COLUMNS} FROM players WHERE token_hash = ?1`,
        tokenHash,
      );
      return row === null ? null : toPlayer(row);
    },

    async insertPlayer(input: NewPlayer): Promise<Player> {
      const row = await firstRow(
        `INSERT INTO players (token_hash, created_at, last_seen_at)
         VALUES (?1, ?2, ?2) RETURNING ${PLAYER_COLUMNS}`,
        input.tokenHash,
        input.at,
      );
      return row === null ? corrupt("players.RETURNING") : toPlayer(row);
    },

    async touchPlayer(playerId: number, at: number): Promise<void> {
      await db
        .prepare("UPDATE players SET last_seen_at = ?1 WHERE id = ?2")
        .bind(at, playerId)
        .run();
    },

    countGamesStartedSince(playerId: number, since: number): Promise<number> {
      return count(
        "SELECT COUNT(*) AS n FROM games WHERE player_id = ?1 AND started_at >= ?2",
        playerId,
        since,
      );
    },

    async insertGame(input: NewGame): Promise<void> {
      await db
        .prepare(
          `INSERT INTO games (id, player_id, status, seed, difficulty, memorize_ms, kind, started_at)
           VALUES (?1, ?2, 'active', ?3, ?4, ?5, ?6, ?7)`,
        )
        .bind(
          input.id,
          input.playerId,
          input.seed,
          input.difficulty,
          input.memorizeMs,
          input.kind,
          input.startedAt,
        )
        .run();
    },

    async findGame(gameId: string): Promise<Game | null> {
      const row = await firstRow(`SELECT ${GAME_COLUMNS} FROM games WHERE id = ?1`, gameId);
      return row === null ? null : toGame(row);
    },

    async finishGame(input: FinishGame): Promise<boolean> {
      // The single-use guard. `status = 'active'` in the WHERE clause means a
      // replay changes nothing and `meta.changes` reports zero — no read, no
      // check-then-write, no window between them.
      const result = await db
        .prepare(
          `UPDATE games
              SET player_id = ?1, status = 'finished', total_score = ?2,
                  guesses_json = ?3, flags = ?4, finished_at = ?5,
                  name = ?7, name_key = ?8
            WHERE id = ?6 AND status = 'active'`,
        )
        .bind(
          input.playerId,
          input.totalScore,
          input.guessesJson,
          input.flags,
          input.finishedAt,
          input.gameId,
          input.name,
          input.nameKey,
        )
        .run();
      return result.meta.changes > 0;
    },

    async recordFinishedGame(input: {
      readonly playerId: number;
      readonly gameId: string;
      readonly totalScore: number;
      readonly ranked: boolean;
      readonly at: number;
    }): Promise<AggregateResult> {
      // One statement, so the read-modify-write of `best_score` has no window in
      // it. SQLite evaluates every assignment against the pre-update row, which
      // is what lets `best_game_id` test the old `best_score`.
      const row = await firstRow(
        `UPDATE players
            SET games_played = games_played + 1,
                best_score = CASE WHEN ?5 = 1 AND ?1 > best_score THEN ?1 ELSE best_score END,
                best_game_id = CASE WHEN ?5 = 1 AND ?1 > best_score THEN ?2 ELSE best_game_id END,
                last_seen_at = ?3
          WHERE id = ?4
        RETURNING best_score, COALESCE(best_game_id = ?2, 0) AS is_best`,
        input.totalScore,
        input.gameId,
        input.at,
        input.playerId,
        input.ranked ? 1 : 0,
      );
      if (row === null) return corrupt("players.RETURNING");
      return { bestScore: num(row, "best_score"), isPersonalBest: num(row, "is_best") === 1 };
    },

    async setName(input: {
      readonly playerId: number;
      readonly name: string;
      readonly key: string;
      readonly at: number;
    }): Promise<void> {
      // Two writes, atomically (ADR 0029). Names are not unique (ADR 0024), so
      // there is no index to violate. The first sets the identity's prefill name.
      // The second names the game the player just finished — the board reads the
      // game's own name, so "set username" names the game you just played. Older
      // games keep the name they were played under; only the most recent moves,
      // which is what stops a rename from rewriting the board.
      await db.batch([
        db
          .prepare(
            `UPDATE players
                SET name = ?1, name_key = ?2,
                    name_changes = name_changes + 1, name_changed_at = ?3
              WHERE id = ?4`,
          )
          .bind(input.name, input.key, input.at, input.playerId),
        db
          .prepare(
            `UPDATE games SET name = ?1, name_key = ?2
              WHERE id = (
                SELECT id FROM games
                 WHERE player_id = ?3 AND status = 'finished'
                 ORDER BY finished_at DESC, id DESC LIMIT 1
              )`,
          )
          .bind(input.name, input.key, input.playerId),
      ]);
    },

    async deletePlayer(playerId: number): Promise<void> {
      // The games are deleted explicitly rather than left to ON DELETE CASCADE.
      // Cascades only fire when foreign keys are enforced, and a forget request
      // that silently orphans a player's games is a privacy failure, not a bug
      // report — so it does not depend on a PRAGMA being what we expect.
      await db.batch([
        db.prepare("DELETE FROM games WHERE player_id = ?1").bind(playerId),
        db.prepare("DELETE FROM players WHERE id = ?1").bind(playerId),
      ]);
    },

    async topPlayers(limit: number): Promise<readonly BoardRow[]> {
      // The global board is the best game per `(player, name)` (ADR 0029), read
      // from `games` so a rename cannot relabel a past entry — see BOARD_ENTRIES.
      const result = await db
        .prepare(
          `${BOARD_ENTRIES}
            ORDER BY best_score DESC, name ASC, player_id ASC
            LIMIT ?1`,
        )
        .bind(limit)
        .all();
      return result.results.map((row) => ({
        playerId: num(row, "player_id"),
        name: text(row, "name"),
        bestScore: num(row, "best_score"),
        gameId: text(row, "game_id"),
      }));
    },

    async topPlayersBySeed(seed: number, limit: number): Promise<readonly BoardRow[]> {
      // The same entry shape as the global board, filtered to one seed and
      // *including* challenge games (ADR 0026) — the open game that originated the
      // seed competes on it too. The name is the game's own snapshot (`g.name`,
      // ADR 0029), so a rename does not relabel a seed entry either. One row per
      // `(player, name)`, ties broken by `total_score DESC, g.id ASC`.
      const result = await db
        .prepare(
          `SELECT player_id, name, best_score, game_id FROM (
             SELECT g.player_id AS player_id, g.name AS name,
                    g.total_score AS best_score, g.id AS game_id,
                    ROW_NUMBER() OVER (
                      PARTITION BY g.player_id, g.name_key ORDER BY g.total_score DESC, g.id ASC
                    ) AS rn
               FROM games g
              WHERE g.seed = ?1 AND g.status = 'finished' AND g.flags = 0
                AND g.name_key IS NOT NULL AND g.total_score > 0
           )
           WHERE rn = 1
           ORDER BY best_score DESC, name ASC, player_id ASC
           LIMIT ?2`,
        )
        .bind(seed, limit)
        .all();
      return result.results.map((row) => ({
        playerId: num(row, "player_id"),
        name: text(row, "name"),
        bestScore: num(row, "best_score"),
        gameId: text(row, "game_id"),
      }));
    },

    countPlayersAbove(key: RankKey): Promise<number> {
      // Rank against the same entry set the board is drawn from (ADR 0029), so a
      // counted rank and a board position cannot disagree. `key` is the entry
      // being ranked: its score, the name its best game was played under, and the
      // player id as the final tiebreak — the outer order of BOARD_ENTRIES.
      return count(
        `SELECT COUNT(*) AS n FROM (${BOARD_ENTRIES})
          WHERE best_score > ?1
             OR (best_score = ?1 AND name < ?2)
             OR (best_score = ?1 AND name = ?2 AND player_id < ?3)`,
        key.bestScore,
        key.name,
        key.id,
      );
    },

    async bumpMintBucket(bucket: string, day: number): Promise<number> {
      const row = await firstRow(
        `INSERT INTO mint_buckets (bucket, day, count) VALUES (?1, ?2, 1)
         ON CONFLICT(bucket, day) DO UPDATE SET count = count + 1
         RETURNING count AS n`,
        bucket,
        day,
      );
      return row === null ? corrupt("mint_buckets.RETURNING") : num(row, "n");
    },

    async recordTelemetry(input: TelemetryWrite): Promise<void> {
      const statements: D1PreparedStatement[] = [];
      for (const round of input.rounds) {
        statements.push(
          db
            .prepare(
              `INSERT INTO round_stats
                 (day, difficulty, memorize_ms, round_index, delta_e_bucket, hue_bucket, n)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)
               ON CONFLICT(day, difficulty, memorize_ms, round_index, delta_e_bucket, hue_bucket)
                 DO UPDATE SET n = n + 1`,
            )
            .bind(
              round.day,
              round.difficulty,
              round.memorizeMs,
              round.roundIndex,
              round.deltaEBucket,
              round.hueBucket,
            ),
        );
      }
      for (const game of input.games) {
        statements.push(
          db
            .prepare(
              `INSERT INTO game_stats (day, difficulty, memorize_ms, event, n)
               VALUES (?1, ?2, ?3, ?4, 1)
               ON CONFLICT(day, difficulty, memorize_ms, event) DO UPDATE SET n = n + 1`,
            )
            .bind(game.day, game.difficulty, game.memorizeMs, game.event),
        );
      }
      // D1 rejects an empty batch, and "nothing to count" is an ordinary call.
      if (statements.length === 0) return;
      await db.batch(statements);
    },

    async recordClientError(input: ClientErrorReport): Promise<number> {
      // Retention is enforced here *and* by the daily sweep. This half keeps the
      // promise true while reports are arriving and costs nothing — it is off
      // the response path and the table is small. It cannot keep it true once
      // they stop, which is what `deleteClientErrorsBefore` is for.
      await db.prepare("DELETE FROM client_errors WHERE day < ?1").bind(input.keepFromDay).run();
      const row = await firstRow(
        `INSERT INTO client_errors
           (fingerprint, day, message, stack, n, first_seen_at, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)
         ON CONFLICT(fingerprint, day)
           DO UPDATE SET n = n + 1, last_seen_at = ?5
         RETURNING n`,
        input.fingerprint,
        input.day,
        input.message,
        input.stack,
        input.at,
      );
      return row === null ? corrupt("client_errors.RETURNING") : num(row, "n");
    },

    async expireStaleGames(input: ExpireStaleGames): Promise<number> {
      // `UPDATE … LIMIT` needs SQLITE_ENABLE_UPDATE_DELETE_LIMIT at compile
      // time, which is not something to bet a scheduled job on. The subquery
      // form is bounded on every build of SQLite there is.
      const result = await db
        .prepare(
          `UPDATE games SET status = 'expired'
            WHERE id IN (
              SELECT id FROM games
               WHERE status = 'active' AND started_at < ?1
               ORDER BY started_at
               LIMIT ?2)`,
        )
        .bind(input.startedBefore, input.limit)
        .run();
      return result.meta.changes;
    },

    async deleteMintBucketsBefore(input: PurgeMintBuckets): Promise<number> {
      // `mint_buckets` is WITHOUT ROWID, so there is no `rowid` to bound the
      // delete by. SQLite's row-value syntax takes the primary key instead —
      // verified against the real local D1, not assumed.
      const result = await db
        .prepare(
          `DELETE FROM mint_buckets
            WHERE (bucket, day) IN (
              SELECT bucket, day FROM mint_buckets
               WHERE day < ?1
               ORDER BY day
               LIMIT ?2)`,
        )
        .bind(input.beforeDay, input.limit)
        .run();
      return result.meta.changes;
    },

    async deleteClientErrorsBefore(input: PurgeClientErrors): Promise<number> {
      // WITHOUT ROWID again; same row-value bound. `day` is TEXT `YYYY-MM-DD`,
      // which compares correctly as text, and `client_errors_day` indexes it.
      const result = await db
        .prepare(
          `DELETE FROM client_errors
            WHERE (fingerprint, day) IN (
              SELECT fingerprint, day FROM client_errors
               WHERE day < ?1
               ORDER BY day
               LIMIT ?2)`,
        )
        .bind(input.beforeDay, input.limit)
        .run();
      return result.meta.changes;
    },

    async deleteOrphanedPlayers(input: PurgeOrphanPlayers): Promise<number> {
      // The two statements select the same rows because they interpolate the
      // *same* subquery text, and `ORDER BY id` makes it deterministic — a
      // `LIMIT` without an order could hand the second statement a different
      // set, orphaning games whose player is gone. `batch` is one transaction,
      // so nothing can change between them either.
      //
      // Games are deleted explicitly rather than left to ON DELETE CASCADE, for
      // the reason `deletePlayer` gives: cascades only fire when foreign keys
      // are enforced.
      const results = await db.batch([
        db
          .prepare(`DELETE FROM games WHERE player_id IN (${ORPHAN_PLAYERS})`)
          .bind(input.createdBefore, input.limit),
        db
          .prepare(`DELETE FROM players WHERE id IN (${ORPHAN_PLAYERS})`)
          .bind(input.createdBefore, input.limit),
      ]);
      const removed = results[1];
      return removed === undefined ? corrupt("players.batch") : removed.meta.changes;
    },

    async ping(): Promise<boolean> {
      try {
        const row = await firstRow("SELECT 1 AS n");
        return row !== null && num(row, "n") === 1;
      } catch {
        // The deep health check's whole job is to report this as a value.
        return false;
      }
    },
  };
}
