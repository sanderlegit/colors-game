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
 * - **`claimName` surfaces contention as a value.** A name collision is an
 *   ordinary outcome (the caller auto-suffixes), so it comes back as
 *   `{ ok: false, reason: "taken" }` rather than as an exception. `memory.ts`
 *   has to reproduce that faithfully or the handler tests pass against a lie.
 *
 * ## Ordering
 *
 * The board is ordered `best_score DESC, name ASC`, which is exactly the
 * `players_board` index. `countPlayersAbove` counts under that same order, so a
 * player's rank and their row's position on the board cannot disagree. See the
 * note on `countPlayersAbove` — this is not the tiebreak the brief asked for,
 * and the reason is recorded there.
 */

import type { Difficulty } from "../../src/domain/round";

export type GameStatus = "active" | "finished" | "expired";

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
  readonly startedAt: number;
  readonly finishedAt: number | null;
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
};

/** What the aggregate update reports back, so the caller need not re-read the row. */
export type AggregateResult = {
  readonly bestScore: number;
  readonly isPersonalBest: boolean;
};

export type NameClaim = { readonly ok: true } | { readonly ok: false; readonly reason: "taken" };

export type BoardRow = {
  readonly playerId: number;
  readonly name: string;
  readonly bestScore: number;
};

/** The order both the board and the rank count are computed in. */
export type RankKey = {
  readonly bestScore: number;
  /** Ties are broken by name, ascending. See `countPlayersAbove`. */
  readonly name: string;
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

export type PurgeOrphanPlayers = {
  /** Only rows with `games_played = 0` are eligible, and only past this. */
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

  claimName(input: {
    readonly playerId: number;
    readonly name: string;
    readonly key: string;
    readonly at: number;
  }): Promise<NameClaim>;

  /** Removes the player and every game they played. */
  deletePlayer(playerId: number): Promise<void>;

  topPlayers(limit: number): Promise<readonly BoardRow[]>;

  /**
   * How many ranked players sort above `key`. Rank is that plus one.
   *
   * **The tiebreak is name, not `finished_at`.** The brief specified
   * "first to achieve ranks higher", but `players` stores no timestamp for the
   * best game — only `best_game_id` — so that order would need a join through
   * `games` on every rank query, and it would not agree with the
   * `players_board` index, which is `(best_score DESC, name)`. A rank that
   * disagrees with the board it is displayed next to is a bug report. If the
   * `finished_at` tiebreak is wanted, add `best_finished_at` to `players` and
   * change the index, `topPlayers` and this method in one commit.
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

  /**
   * Delete players who never finished a game, and their games with them.
   * Returns the number of *players* removed.
   *
   * Deliberately narrow: `games_played = 0` only. A player who has finished one
   * game may own a name and a board position, and deleting either is not
   * recoverable. ADR 0011 also asks for names idle over 12 months to be
   * released; that half is **not** implemented and `server/sweep.ts` records why.
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
