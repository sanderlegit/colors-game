/**
 * The Repo port.
 *
 * Same move as Clock, Rng, Storage and SeedSource in `src/platform/**`: the
 * handlers depend on this file and nothing else, so a handler test needs no D1,
 * no `wrangler dev`, and no network. `memory.ts` is the double, `d1.ts` is the
 * adapter, and **every SQL statement in the system lives in `d1.ts`** — a query
 * built anywhere else is a query that no test double can be made to reproduce.
 *
 * ## Methods are named for what they do
 *
 * `recordFinishedGame`, not `updatePlayersSetGamesPlayed`. Two of them are
 * load-bearing beyond their names and are worth reading twice:
 *
 * - **`finishGame` is the single-use guard.** It is a conditional update — the
 *   row must still be `active` — and it reports whether it changed anything. A
 *   second submission of the same game id changes zero rows and gets `false`,
 *   which is the entire replay defence. Nothing checks-then-writes; the check
 *   *is* the write.
 * - **`setName` always lands.** Names are not unique (ADR 0024), so setting one
 *   is a plain write with no contention to report — unlike its predecessor
 *   `claimName`, which returned `{ ok: false, reason: "taken" }` on a collision.
 *
 * ## Ordering
 *
 * The board is ordered `total_score DESC, name ASC, player_id ASC` over the game
 * entries `BOARD_ENTRIES` builds (ADR 0029). `countPlayersAbove` counts under
 * that same order, so a player's rank and their row's position on the board
 * cannot disagree. The `player_id` tiebreak is load-bearing now that names
 * repeat: without it two equal-scoring `ada`s would tie and the counted rank
 * would disagree with the board. See the
 * note on `countPlayersAbove`.
 */

import type { Difficulty } from "../../src/domain/round";

export type GameStatus = "active" | "finished" | "expired";

/**
 * Whether the seed was minted for this game or chosen from an existing one
 * (ADR 0026). Only `open` games may raise `players.best_score`; a `challenge`
 * game ranks solely on its seed's board, because a chosen seed the player could
 * pick for being easy must not reach the global board.
 */
export type GameKind = "open" | "challenge";

export type Player = {
  readonly id: number;
  readonly name: string | null;
  readonly nameKey: string | null;
  readonly nameChanges: number;
  readonly nameChangedAt: number | null;
  readonly bestScore: number;
  readonly bestGameId: string | null;
  readonly gamesPlayed: number;
  readonly createdAt: number;
  readonly lastSeenAt: number;
};

export type Game = {
  readonly id: string;
  readonly playerId: number | null;
  readonly status: GameStatus;
  readonly seed: number;
  readonly difficulty: Difficulty;
  readonly memorizeMs: number;
  readonly totalScore: number;
  readonly guessesJson: string | null;
  readonly flags: number;
  readonly kind: GameKind;
  readonly startedAt: number;
  readonly finishedAt: number | null;
  /**
   * The display name the game was submitted under, snapshotted at finish, and
   * its folded key (ADR 0029). Null on an active game and on a game finished
   * before the player had a name. This — not the mutable `players.name` — is
   * what the board displays, so a later rename cannot rewrite it.
   */
  readonly name: string | null;
  readonly nameKey: string | null;
};

export type NewPlayer = {
  readonly tokenHash: string;
  readonly at: number;
};

export type NewGame = {
  readonly id: string;
  /**
   * The player the game is minted for, or `null` for a caller with no cookie yet.
   *
   * Attaching it at mint time is what lets `countGamesStartedSince` see a game
   * before it is submitted, and therefore what makes the per-player start limit
   * work at all. A first-time visitor still gets `null`: minting a game must not
   * require an identity, so they are not made to accept a cookie before they
   * have played. Their ceiling is the mint bucket instead.
   */
  readonly playerId: number | null;
  readonly seed: number;
  readonly difficulty: Difficulty;
  readonly memorizeMs: number;
  /** `open` for a self-minted seed, `challenge` for one chosen from a share link. */
  readonly kind: GameKind;
  readonly startedAt: number;
};

export type FinishGame = {
  readonly gameId: string;
  readonly playerId: number;
  /** Rounded to an integer by the caller; the column is INTEGER. */
  readonly totalScore: number;
  readonly guessesJson: string;
  readonly flags: number;
  readonly finishedAt: number;
  /**
   * The name (and folded key) to snapshot onto this game — the name it is being
   * submitted under (ADR 0029). Null when the submitter has no name yet; a later
   * `setName` does not backfill it, which is the point.
   */
  readonly name: string | null;
  readonly nameKey: string | null;
};

/** What the aggregate update reports back, so the caller need not re-read the row. */
export type AggregateResult = {
  readonly bestScore: number;
  readonly isPersonalBest: boolean;
};

export type BoardRow = {
  readonly playerId: number;
  readonly name: string;
  readonly bestScore: number;
  /**
   * The game the row's score belongs to. For the global board it is the player's
   * `best_game_id`; for a per-seed board it is the game that reached that score
   * on the seed. It is what the client fetches an attempt breakdown from, and
   * what a share link and the "only this seed" filter reference — a stable,
   * already-public handle that lets the raw `seed` stay server-side (ADR 0026).
   */
  readonly gameId: string;
};

/** The order both the board and the rank count are computed in. */
export type RankKey = {
  readonly bestScore: number;
  /** First tiebreak: name, ascending. See `countPlayersAbove`. */
  readonly name: string;
  /**
   * Final tiebreak: player id, ascending. Names are not unique (ADR 0024), so
   * `(bestScore, name)` alone is not a total order — two players called `ada` on
   * the same score would tie, and the rank counted here would disagree with the
   * board row's position. `id` is the unique primary key, so it makes the order
   * total again; the earlier account sorts first.
   */
  readonly id: number;
};

/**
 * One increment of `round_stats` (ADR 0014). Every field is part of the primary
 * key; `n` is the count the upsert bumps.
 */
export type RoundCounter = {
  /** UTC `YYYY-MM-DD`. A date, never a timestamp — see `server/telemetry.ts`. */
  readonly day: string;
  readonly difficulty: Difficulty;
  readonly memorizeMs: number;
  readonly roundIndex: number;
  readonly deltaEBucket: number;
  readonly hueBucket: number;
};

/** One increment of `game_stats`. `event` is the observed game-level event. */
export type GameCounter = {
  readonly day: string;
  readonly difficulty: Difficulty;
  readonly memorizeMs: number;
  readonly event: string;
};

export type TelemetryWrite = {
  readonly rounds: readonly RoundCounter[];
  readonly games: readonly GameCounter[];
};

/**
 * A deduplicated client error. `fingerprint` is a hash of message + stack, so
 * one broken browser reloading in a loop increments a counter instead of adding
 * rows.
 */
export type ClientErrorReport = {
  readonly fingerprint: string;
  readonly day: string;
  readonly message: string;
  readonly stack: string | null;
  readonly at: number;
  /** Rows dated before this are dropped in the same write. 30-day retention. */
  readonly keepFromDay: string;
};

/**
 * ## The four sweep passes
 *
 * Each one is a **single bounded pass**, and every one of them takes a `limit`.
 * That is not an optimisation. These statements run against tables that have
 * been growing unattended since the schema was written, on a scheduled job with
 * nobody watching: an unbounded `DELETE` on the first run after a long backlog
 * is how a cron takes out a database. Each returns the number of rows it
 * touched, so a run that hits its ceiling is visible in the log and the next run
 * continues from where it stopped — see `server/sweep.ts`.
 *
 * The oldest rows go first (`ORDER BY` on the cutoff column), so a capped pass
 * makes progress rather than churning the same window.
 */
export type ExpireStaleGames = {
  /** Games minted before this are past `GAME_TTL_MS` and can never be submitted. */
  readonly startedBefore: number;
  readonly limit: number;
};

export type PurgeMintBuckets = {
  /** `dayNumber()`, exclusive. Today's counters are the ones still being read. */
  readonly beforeDay: number;
  readonly limit: number;
};

export type PurgeClientErrors = {
  /** `dayKey()` — a UTC `YYYY-MM-DD`, exclusive, matching the column. */
  readonly beforeDay: string;
  readonly limit: number;
};

export type PurgeNameChanges = {
  /** Rows older than this `at` (ms) are eligible, oldest first. */
  readonly before: number;
  readonly limit: number;
};

/**
 * One row of the name-change audit (ADR 0031). Folded keys, never display names:
 * `oldNameKey` is null on a first claim, `newNameKey` is always present.
 */
export type NameChange = {
  readonly at: number;
  readonly oldNameKey: string | null;
  readonly newNameKey: string;
};

export type PurgeOrphanPlayers = {
  /** Only nameless rows with `games_played = 0` are eligible, and only past this. */
  readonly createdBefore: number;
  readonly limit: number;
};

export type Repo = {
  findPlayerByTokenHash(tokenHash: string): Promise<Player | null>;
  insertPlayer(input: NewPlayer): Promise<Player>;
  /** Cheap enough to defer with `waitUntil`; nothing reads it in the same request. */
  touchPlayer(playerId: number, at: number): Promise<void>;

  /** Mint-rate check for an identified player. Anonymous mints use `bumpMintBucket`. */
  countGamesStartedSince(playerId: number, since: number): Promise<number>;

  insertGame(input: NewGame): Promise<void>;
  findGame(gameId: string): Promise<Game | null>;

  /**
   * Finalise an active game. `false` means the row was not active — already
   * submitted, expired, or never existed — and the caller must not score it.
   */
  finishGame(input: FinishGame): Promise<boolean>;

  /** One statement: increments games played and raises the best score if beaten. */
  recordFinishedGame(input: {
    readonly playerId: number;
    readonly gameId: string;
    readonly totalScore: number;
    /**
     * False for a game carrying anti-abuse flags. It still counts as played —
     * it stays on the player's history — but it may not raise `best_score`,
     * which is the number the board is built from. Required rather than
     * defaulted so that a caller cannot forget to say.
     */
    readonly ranked: boolean;
    readonly at: number;
  }): Promise<AggregateResult>;

  /**
   * Set a player's display name. Names are not unique (ADR 0024), so this always
   * lands — there is no contention to report. `key` is the folded form stored
   * alongside for display consistency and to mark the row as named
   * (`name_key IS NOT NULL` is the board's "has a name" predicate).
   */
  setName(input: {
    readonly playerId: number;
    readonly name: string;
    readonly key: string;
    readonly at: number;
  }): Promise<void>;

  /**
   * The player's name changes, oldest first (ADR 0031). Written by `setName`
   * whenever the folded key actually changes; read for forensics and by tests.
   */
  nameChangesFor(playerId: number): Promise<readonly NameChange[]>;

  /**
   * Removes the player and every game they played.
   *
   * No handler calls this: there is no self-serve delete (ADR 0025). It stays as
   * the canonical single-player delete — the two-statement shape the operator
   * script (`just delete-player`) mirrors in raw SQL, and the primitive tests and
   * fixtures reach for to make a fresh row. Deletion of a real player happens out
   * of band, not through the API.
   */
  deletePlayer(playerId: number): Promise<void>;

  topPlayers(limit: number): Promise<readonly BoardRow[]>;

  /**
   * The board for one seed (ADR 0026): each named player's best finished,
   * unflagged game on `seed`, ordered `total_score DESC, name ASC` — the same
   * order as the global board, so a rank shown here cannot disagree with the
   * row it sits on. Both `open` and `challenge` games count, so the player who
   * originated the seed competes on it too. `gameId` on each row is the specific
   * game that reached the score, not `best_game_id`.
   */
  topPlayersBySeed(seed: number, limit: number): Promise<readonly BoardRow[]>;

  /**
   * How many ranked players sort above `key`. Rank is that plus one.
   *
   * **The tiebreaks are name then id, not `finished_at`.** The brief specified
   * "first to achieve ranks higher", but a game entry is ordered
   * `total_score DESC, name ASC, player_id ASC` (ADR 0029) — `finished_at` is not
   * in that order, so a rank counted here agrees with the board position by
   * construction. `player_id` is the final tiebreak because names are not unique
   * (ADR 0024) and `name` alone no longer breaks every tie; it is unique and
   * stable, so the order is total. A `finished_at` ("first to achieve") tiebreak
   * would mean threading it through `BOARD_ENTRIES` and this method together.
   */
  countPlayersAbove(key: RankKey): Promise<number>;

  /** Upserts the bucket and returns the count *after* the increment. */
  bumpMintBucket(bucket: string, day: number): Promise<number>;

  /**
   * Bump the ADR 0014 counters. Deferred with `waitUntil` by every caller —
   * nothing in a response reads them, and a player must never wait on analytics.
   */
  recordTelemetry(input: TelemetryWrite): Promise<void>;

  /**
   * Upsert one client error and drop anything older than `keepFromDay`. Returns
   * the count *after* the increment, so a caller can log how often this
   * fingerprint has been seen today without a second read.
   */
  recordClientError(input: ClientErrorReport): Promise<number>;

  /**
   * Move stale `active` games to `expired`. Returns rows changed.
   *
   * Until something did this the `expired` status was unreachable: a submission
   * past the TTL is refused from the row's `started_at`, so nothing ever wrote
   * the column the `games_sweep` index exists to serve.
   */
  expireStaleGames(input: ExpireStaleGames): Promise<number>;

  /**
   * Delete `mint_buckets` rows for days that are over. Returns rows deleted.
   *
   * **This one is a privacy obligation, not a disk one.** These are the only
   * per-IP-derived rows in the system, and ADR 0015 justifies keeping them at
   * all partly on their being short-lived. Nothing can read a past day's bucket
   * — `bumpMintBucket` only ever touches today's — so a row that outlives its
   * day is retained data with no purpose.
   */
  deleteMintBucketsBefore(input: PurgeMintBuckets): Promise<number>;

  /** Delete `client_errors` older than the retention window. Returns rows deleted. */
  deleteClientErrorsBefore(input: PurgeClientErrors): Promise<number>;

  /** Delete `name_changes_audit` rows older than the retention window (ADR 0031). */
  purgeNameChanges(input: PurgeNameChanges): Promise<number>;

  /**
   * Delete players who never finished a game, and their games with them.
   * Returns the number of *players* removed.
   *
   * Deliberately narrow: `games_played = 0` **and `name_key IS NULL`**. A player
   * who has finished a game — or who holds a name — may own a board position, and
   * deleting either is not recoverable. The name guard is not redundant: a bulk
   * reset of `games_played` (`migrations/0005`) can leave named rows at zero
   * games, and without it this pass would delete them. ADR 0011 also asks for
   * names idle over 12 months to be released; that half is **not** implemented
   * and `server/sweep.ts` records why.
   */
  deleteOrphanedPlayers(input: PurgeOrphanPlayers): Promise<number>;

  /**
   * Is the database answering? For the deep health check and nothing else —
   * `/api/health` stays shallow on purpose, because a probe that queries D1
   * makes one D1 blip look like every edge location failing at once.
   *
   * Answers `false` rather than throwing: "the database is unreachable" is the
   * result this endpoint exists to report, not a fault to hide behind a 500.
   */
  ping(): Promise<boolean>;
};
