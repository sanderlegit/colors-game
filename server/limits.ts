/**
 * The rate limits and the plausibility bounds — ADR 0015.
 *
 * Two different jobs live here because they are the same idea at two time
 * scales: a submission has to be *possible*, and a caller has to be *bounded*.
 *
 * ## The minimum elapsed time is measured on our clock, from our row
 *
 * `memorize_ms` is read from the `games` row written at issue time, never from
 * the submit body. That is the load-bearing half: the client picks the memorize
 * window when it starts the game, and a body that could restate it would let a
 * caller claim 3000 for a game issued at 8000 and cut the required playtime from
 * 43 seconds to 18. Both timestamps are ours as well — `started_at` from the
 * mint, `finished_at` from the submit — so nothing a client sends enters the
 * arithmetic at all.
 *
 * ## The mint bucket is an equivalence class, not an identifier
 *
 * `SHA-256(kind ‖ ip ‖ salt-of-the-day)`. The raw address is never stored and
 * never logged: it exists inside one request, becomes 32 bytes, and is gone. The
 * salt rotates daily, so yesterday's buckets cannot be re-derived from an
 * address even with the table in hand — an unsalted hash of an IPv4 address is
 * 2^32 guesses, which is not a privacy measure.
 *
 * The two kinds are counted separately, in the same table, because they bound
 * different things: how many games a caller with no cookie may mint, and how
 * many identities may be created. Sharing one counter would let a burst of
 * anonymous starts lock out the new players behind the same NAT.
 */

import type { AppDeps } from "./context";

/**
 * The floor on one round's picking time.
 *
 * Deliberately far below anything a human does — the point is to reject a script
 * that posts five guesses the instant it is handed a seed, not to argue with a
 * fast player. `docs/TUNING.md` has the observed numbers.
 */
export const MIN_PICK_MS = 600;

/**
 * How long a minted game stays submittable. Past this the seed is stale enough
 * that the row is a liability rather than a game in progress, and the answer is
 * 410 — a status the client can distinguish from "you cheated".
 */
export const GAME_TTL_MS = 30 * 60 * 1000;

export const GAMES_PER_PLAYER_PER_HOUR = 20;
export const PLAYER_WINDOW_MS = 60 * 60 * 1000;

/**
 * Anonymous game mints per bucket per day. A full game takes ~28s, so this is
 * more than an un-cookied session can honestly consume; a returning player is
 * counted per-player instead and never touches it.
 */
export const ANON_GAMES_PER_BUCKET_PER_DAY = 60;

/** New identities per bucket per day. One honest player mints exactly one. */
export const IDENTITIES_PER_BUCKET_PER_DAY = 30;

/**
 * Client error reports per bucket per day.
 *
 * The report endpoint is the only unauthenticated *write* in the API, so it gets
 * the tightest ceiling. Dedup by fingerprint already means a browser throwing
 * the same error in a loop costs one row; this bounds the case dedup cannot
 * help with, which is a browser inventing a fresh stack every time.
 */
export const CLIENT_ERRORS_PER_BUCKET_PER_DAY = 50;

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a `client_errors` row is kept.
 *
 * Written here rather than beside either of the two things that enforce it —
 * `Repo.recordClientError` purges older days on every write,
 * `server/sweep.ts` purges them again on a schedule — because two copies of a
 * retention window drift, and the one that drifts is always the one nobody is
 * looking at. `docs/history/README.md` § Documentation traps: a comment saying
 * "must equal X" is not a guard.
 */
export const CLIENT_ERROR_RETENTION_DAYS = 30;

/**
 * How long a `players` row with no completed game is kept (ADR 0011).
 *
 * A row is created at the *first successful submission* and `recordFinishedGame`
 * increments `games_played` in the same request, so `games_played = 0` means the
 * request died between the two. Such a player owns nothing: they cannot hold a
 * name (`handlers/name.ts` refuses under one game played) and they are not on the
 * board (`players_board` requires `best_score > 0`). Seven days is ADR 0011's
 * number and is far longer than the gap it is cleaning up after.
 */
export const ORPHAN_PLAYER_MAX_AGE_MS = 7 * DAY_MS;

/**
 * How long a `name_changes_audit` row is kept (ADR 0031).
 *
 * The table is a subject-bearing forensic record, so it is bounded rather than
 * kept forever: 90 days is long enough to investigate a report that arrives well
 * after the fact — far longer than the 3-day log window it backstops — and short
 * enough that a hobby-scale table never accumulates a year of renames.
 */
export const NAME_CHANGE_AUDIT_MAX_AGE_MS = 90 * DAY_MS;

/** What the three counters in `mint_buckets` are counting. */
export type MintKind = "game" | "identity" | "error";

/**
 * The elapsed time below which a submission is not a game that was played.
 *
 * `memorizeMs` comes from the row. At the 8s window this is 43 seconds.
 */
export function minimumElapsedMs(memorizeMs: number, rounds: number): number {
  return rounds * memorizeMs + rounds * MIN_PICK_MS;
}

export function dayNumber(now: number): number {
  return Math.floor(now / DAY_MS);
}

/** For `Retry-After` on a daily limit: when the bucket rolls over, in seconds. */
export function secondsUntilNextDay(now: number): number {
  return Math.max(1, Math.ceil(((dayNumber(now) + 1) * DAY_MS - now) / 1000));
}

/**
 * The caller's address as Cloudflare reports it.
 *
 * Absent only off Cloudflare — `wrangler dev` and unit tests — where every
 * caller shares one bucket. That is the safe direction to be wrong in: it
 * over-counts locally and never under-counts in production.
 */
export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "";
}

/**
 * The bucket key. Returns a hash and nothing else, so no caller can accidentally
 * hold onto the address it was derived from.
 */
export function mintBucket(
  kind: MintKind,
  request: Request,
  deps: AppDeps,
  now: number,
): Promise<string> {
  // NUL separators: no address, kind or salt can be split differently to
  // produce another one's key.
  return deps.hashToken(`${kind}\u0000${clientIp(request)}\u0000${deps.mintSalt(dayNumber(now))}`);
}
