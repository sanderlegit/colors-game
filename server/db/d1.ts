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
import { nameKey } from "../decode";
import { placeholderName } from "../placeholder";
import type {
  AggregateResult,
  BoardRow,
  BoardView,
  ClientErrorReport,
  ExpireStaleGames,
  FinishGame,
  Game,
  GameKind,
  GameStatus,
  NameChange,
  NewGame,
  NewPlayer,
  Player,
  PurgeClientErrors,
  PurgeMintBuckets,
  PurgeNameChanges,
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
 * The `all` board (ADR 0033): every finished, unflagged, `open`, named game
 * scoring above zero, one game per row. The name comes from the game (`g.name`,
 * ADR 0029), never the mutable `players` row, so a rename cannot relabel a row.
 * `kind = 'open'` keeps challenge games off the global board (ADR 0026); the seed
 * board drops that filter and adds `g.seed`. The caller supplies the outer order.
 *
 * This predicate is the partial index `games_name_board` (migration 0006).
 */
const BOARD_FILTER =
  "g.status = 'finished' AND g.flags = 0 AND g.kind = 'open' AND g.name_key IS NOT NULL AND g.total_score > 0";

const BOARD_ENTRIES = `SELECT g.player_id AS player_id, g.name AS name,
         g.total_score AS best_score, g.id AS game_id
    FROM games g
   WHERE ${BOARD_FILTER}`;

/**
 * The `best` board (ADR 0033): one row per NAME across all players — the single
 * best game played under each `name_key`, whoever played it. Two different
 * accounts that both played as `ada` collapse to one `ada` row. The window picks
 * the best game per name (`total_score DESC, g.id ASC`); `player_id` on the
 * surviving row is that game's player, which `isYou` compares against — so a
 * weaker same-name player does not see themselves highlighted.
 */
const BEST_PER_NAME = `SELECT player_id, name, best_score, game_id FROM (
    SELECT g.player_id AS player_id, g.name AS name,
           g.total_score AS best_score, g.id AS game_id,
           ROW_NUMBER() OVER (
             PARTITION BY g.name_key ORDER BY g.total_score DESC, g.id ASC
           ) AS rn
      FROM games g
     WHERE ${BOARD_FILTER}
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
      // Three writes, atomically (ADR 0029, 0032). Names are not unique
      // (ADR 0024), so there is no index to violate. The first records the audit
      // row; the second sets the identity's prefill name; the third claims the
      // player's *unclaimed* games onto the new name — the ones with no name, the
      // ones still under this player's placeholder handle, and the game just
      // finished (which may carry an inherited name). Games under some *other*
      // real name are left alone, so a rename never rewrites the board's history.
      const placeholderKey = nameKey(placeholderName(input.playerId));
      await db.batch([
        // First, so it reads the *old* key before the UPDATE overwrites it. The
        // `IS NOT` guard records a first claim (null → key) and a real rename, but
        // not a no-op set of the same name (ADR 0031). Folded keys only.
        db
          .prepare(
            `INSERT INTO name_changes_audit (player_id, at, old_name_key, new_name_key)
               SELECT id, ?1, name_key, ?2 FROM players
                WHERE id = ?3 AND name_key IS NOT ?2`,
          )
          .bind(input.at, input.key, input.playerId),
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
              WHERE player_id = ?3 AND status = 'finished'
                AND (name_key IS NULL OR name_key = ?4 OR id = (
                  SELECT id FROM games
                   WHERE player_id = ?3 AND status = 'finished'
                   ORDER BY finished_at DESC, id DESC LIMIT 1
                ))`,
          )
          .bind(input.name, input.key, input.playerId, placeholderKey),
      ]);
    },

    async deletePlayer(playerId: number): Promise<void> {
      // The games are deleted explicitly rather than left to ON DELETE CASCADE.
      // Cascades only fire when foreign keys are enforced, and a forget request
      // that silently orphans a player's games is a privacy failure, not a bug
      // report — so it does not depend on a PRAGMA being what we expect.
      await db.batch([
        db.prepare("DELETE FROM games WHERE player_id = ?1").bind(playerId),
        // The name-change audit names this player (ADR 0031), so a forget deletes
        // it too — explicitly, not on a cascade that only fires with FK enforced.
        db.prepare("DELETE FROM name_changes_audit WHERE player_id = ?1").bind(playerId),
        db.prepare("DELETE FROM players WHERE id = ?1").bind(playerId),
      ]);
    },

    async nameChangesFor(playerId: number): Promise<readonly NameChange[]> {
      const result = await db
        .prepare(
          `SELECT at, old_name_key, new_name_key FROM name_changes_audit
            WHERE player_id = ?1 ORDER BY at, rowid`,
        )
        .bind(playerId)
        .all();
      return result.results.map((row) => ({
        at: num(row, "at"),
        oldNameKey: nullableText(row, "old_name_key"),
        newNameKey: text(row, "new_name_key"),
      }));
    },

    async purgeNameChanges(input: PurgeNameChanges): Promise<number> {
      const result = await db
        .prepare(
          `DELETE FROM name_changes_audit
            WHERE rowid IN (
              SELECT rowid FROM name_changes_audit
               WHERE at < ?1 ORDER BY at, rowid LIMIT ?2)`,
        )
        .bind(input.before, input.limit)
        .run();
      return result.meta.changes;
    },

    async topPlayers(limit: number, view: BoardView): Promise<readonly BoardRow[]> {
      // `best` = one row per name across players; `all` = one row per game
      // (ADR 0033). Both share the order and the game-snapshot name (ADR 0029),
      // so a rename never relabels a row.
      const result = await db
        .prepare(
          `${view === "all" ? BOARD_ENTRIES : BEST_PER_NAME}
            ORDER BY best_score DESC, name ASC, game_id ASC
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

    async topPlayersBySeed(
      seed: number,
      limit: number,
      view: BoardView,
    ): Promise<readonly BoardRow[]> {
      // The seed board (ADR 0026, 0033) in the requested view. Both `open` and
      // `challenge` games count — the `open` filter is dropped and `g.seed` added
      // — so the query is built here rather than from the global constants.
      const filter =
        "g.seed = ?1 AND g.status = 'finished' AND g.flags = 0 AND g.name_key IS NOT NULL AND g.total_score > 0";
      const board =
        view === "all"
          ? `SELECT g.player_id AS player_id, g.name AS name,
                    g.total_score AS best_score, g.id AS game_id
               FROM games g WHERE ${filter}`
          : `SELECT player_id, name, best_score, game_id FROM (
               SELECT g.player_id AS player_id, g.name AS name,
                      g.total_score AS best_score, g.id AS game_id,
                      ROW_NUMBER() OVER (
                        PARTITION BY g.name_key ORDER BY g.total_score DESC, g.id ASC
                      ) AS rn
                 FROM games g WHERE ${filter}
             ) WHERE rn = 1`;
      const result = await db
        .prepare(`${board} ORDER BY best_score DESC, name ASC, game_id ASC LIMIT ?2`)
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
      // Rank always tracks the DEFAULT `best` board (ADR 0033): count the name
      // rows whose best game outranks `key` under `total_score DESC, name ASC,
      // game_id ASC`. `key` is a name's own best game (`bestGameForName`).
      return count(
        `SELECT COUNT(*) AS n FROM (${BEST_PER_NAME})
          WHERE best_score > ?1
             OR (best_score = ?1 AND name < ?2)
             OR (best_score = ?1 AND name = ?2 AND game_id < ?3)`,
        key.bestScore,
        key.name,
        key.gameId,
      );
    },

    async bestGameForName(nameKey: string): Promise<RankKey | null> {
      // The row a name occupies on the `best` board: its best finished, unflagged,
      // open game (ADR 0033). Same order as BEST_PER_NAME's window, so this key is
      // exactly that name's surviving row.
      const row = await firstRow(
        `SELECT total_score AS best_score, name, id AS game_id FROM games g
          WHERE ${BOARD_FILTER} AND g.name_key = ?1
          ORDER BY total_score DESC, id ASC LIMIT 1`,
        nameKey,
      );
      return row === null
        ? null
        : {
            bestScore: num(row, "best_score"),
            name: text(row, "name"),
            gameId: text(row, "game_id"),
          };
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
