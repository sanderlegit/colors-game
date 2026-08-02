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
  NameClaim,
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
  "id, player_id, status, seed, difficulty, memorize_ms, total_score, guesses_json, flags, kind, started_at, finished_at";

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
  };
}

/**
 * The orphan set, written once and interpolated into both statements of
 * `deleteOrphanedPlayers` so that they cannot select different rows. It is a
 * constant with no caller input in it; the cutoff and the limit are bound.
 */
const ORPHAN_PLAYERS = `SELECT id FROM players
   WHERE games_played = 0 AND created_at < ?1
   ORDER BY id
   LIMIT ?2`;

/** SQLite reports a partial unique index by the column it is built on. */
function isNameCollision(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("UNIQUE constraint failed") && message.includes("name_key");
}

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
                  guesses_json = ?3, flags = ?4, finished_at = ?5
            WHERE id = ?6 AND status = 'active'`,
        )
        .bind(
          input.playerId,
          input.totalScore,
          input.guessesJson,
          input.flags,
          input.finishedAt,
          input.gameId,
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

    async claimName(input: {
      readonly playerId: number;
      readonly name: string;
      readonly key: string;
      readonly at: number;
    }): Promise<NameClaim> {
      try {
        await db
          .prepare(
            `UPDATE players
                SET name = ?1, name_key = ?2,
                    name_changes = name_changes + 1, name_changed_at = ?3
              WHERE id = ?4`,
          )
          .bind(input.name, input.key, input.at, input.playerId)
          .run();
        return { ok: true };
      } catch (error) {
        // Contention on a name is an ordinary outcome the caller resolves by
        // suffixing, so it comes back as a value. Anything else is a fault.
        if (isNameCollision(error)) return { ok: false, reason: "taken" };
        throw error;
      }
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
      // `best_game_id IS NOT NULL` is implied by `best_score > 0` — a score is
      // only raised alongside the id that reached it — but it is stated so the
      // narrowing to a non-null `gameId` below is true by the query, not by
      // trust in that invariant.
      const result = await db
        .prepare(
          `SELECT id, name, best_score, best_game_id FROM players
            WHERE name_key IS NOT NULL AND best_score > 0 AND best_game_id IS NOT NULL
            ORDER BY best_score DESC, name ASC
            LIMIT ?1`,
        )
        .bind(limit)
        .all();
      return result.results.map((row) => ({
        playerId: num(row, "id"),
        name: text(row, "name"),
        bestScore: num(row, "best_score"),
        gameId: text(row, "best_game_id"),
      }));
    },

    async topPlayersBySeed(seed: number, limit: number): Promise<readonly BoardRow[]> {
      // Top game per player on this seed, then the players in board order. The
      // window picks one row per player under `total_score DESC, id ASC`, so a
      // player's own ties break deterministically and `game_id` is the game that
      // actually reached the score — not `best_game_id`, which is a global fact.
      const result = await db
        .prepare(
          `SELECT player_id, name, best_score, game_id FROM (
             SELECT g.player_id AS player_id, p.name AS name,
                    g.total_score AS best_score, g.id AS game_id,
                    ROW_NUMBER() OVER (
                      PARTITION BY g.player_id ORDER BY g.total_score DESC, g.id ASC
                    ) AS rn
               FROM games g JOIN players p ON p.id = g.player_id
              WHERE g.seed = ?1 AND g.status = 'finished' AND g.flags = 0
                AND p.name_key IS NOT NULL
           )
           WHERE rn = 1
           ORDER BY best_score DESC, name ASC
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
      return count(
        `SELECT COUNT(*) AS n FROM players
          WHERE name_key IS NOT NULL AND best_score > 0
            AND (best_score > ?1 OR (best_score = ?1 AND name < ?2))`,
        key.bestScore,
        key.name,
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
