/**
 * The GameApi port's real adapter: same-origin `fetch` against `/api/*`.
 *
 * Two rules shape every line here.
 *
 * 1. **No method may reject.** This is `guarded()` from `storage.ts` pointed at
 *    the network. These are called from event handlers and from inside the frame
 *    loop; the one call site that forgets a `try` takes the rAF loop down and the
 *    game with it. Every outcome — offline, timeout, 500, a body that lies about
 *    its shape — comes back as a `Result` the caller has to look at.
 * 2. **The response body is untrusted.** Not because the server is hostile, but
 *    because a deployed client outlives the server version it was built against,
 *    and a cache or a captive portal can answer in its place. Every field is
 *    narrowed through `@/shared/decode`; a body that parses but carries a
 *    wrong-typed field is a `server` error, never a silent default. A default
 *    here would show the player a fabricated rank, which is worse than an error.
 *
 * There is no retry. Auto-retry against a rate limiter is how you stay rate
 * limited, and `submit` must not be sent twice. Retrying is the caller's call,
 * because only the caller knows whether the request was safe to repeat.
 */

import { type Oklch, oklch } from "@/color/types";
import {
  asArray,
  asBoundedNumber,
  asFiniteNumber,
  asRecord,
  asString,
  parseRecord,
} from "@/shared/decode";

export type ApiErrorKind = "offline" | "server" | "rejected";
export type ApiError = { readonly kind: ApiErrorKind; readonly message: string };
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ApiError };

export type LeaderboardEntry = {
  readonly rank: number;
  readonly name: string;
  readonly score: number;
  readonly isYou: boolean;
  /**
   * The game this row's score belongs to. Opaque here — the client never reads a
   * seed — but it is what an attempt breakdown is fetched from, and what the seed
   * filter and the share link reference (ADR 0026).
   */
  readonly gameId: string;
};
/**
 * One round of a stored game, replayed by the server for the attempt breakdown.
 * Carries the colours, not the seed: the same shape the summary screen renders,
 * for a game this browser never played.
 */
export type AttemptRound = {
  readonly deltaE: number;
  readonly score: number;
  readonly target: Oklch;
  readonly guess: Oklch;
};
export type Attempt = {
  readonly totalScore: number;
  readonly rounds: readonly AttemptRound[];
};
export type Identity = {
  readonly name: string | null;
  readonly bestScore: number;
  readonly gamesPlayed: number;
  readonly rank: number | null;
};
export type RankedGame = {
  readonly gameId: string;
  readonly seed: number;
  readonly roundsTotal: number;
};
export type RoundReport = { readonly deltaE: number; readonly score: number };
export type Submission = {
  readonly totalScore: number;
  readonly rounds: readonly RoundReport[];
  readonly rank: number;
  readonly isPersonalBest: boolean;
  readonly name: string | null;
  readonly claimed: boolean;
};
export type SubmitRequest = {
  readonly gameId: string;
  readonly guesses: readonly Oklch[];
  readonly name?: string;
};

export type GameApi = {
  /** `null` is a 204: this browser has no identity on the server yet. */
  me(): Promise<Result<Identity | null>>;
  /**
   * Mint a game. `challengeOf` names an existing game whose seed to play — a
   * shared challenge (ADR 0026); its result ranks only on that seed's board. Its
   * absence is an ordinary open game.
   */
  startRanked(memorizeMs: number, challengeOf?: string): Promise<Result<RankedGame>>;
  submit(req: SubmitRequest): Promise<Result<Submission>>;
  claimName(name: string): Promise<Result<{ readonly name: string }>>;
  /** `forGame` restricts the board to one game's seed; absent is the global board. */
  leaderboard(
    forGame?: string,
    mode?: BoardMode,
  ): Promise<Result<{ readonly entries: readonly LeaderboardEntry[] }>>;
  /** The per-round breakdown for a finished game, replayed server-side. */
  attempt(gameId: string): Promise<Result<Attempt>>;
};

export type ApiOptions = {
  /** Injected in tests. Defaults to the platform `fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
};

const DEFAULT_BASE_URL = "/api";
const DEFAULT_TIMEOUT_MS = 8000;
const NO_CONTENT = 204;

/** Which board the toggle asks for (ADR 0033). `best` is the default. */
export type BoardMode = "best" | "all";

/** A leaderboard row has to fit a phone; longer is corruption, not a name. */
export const MAX_NAME_LENGTH = 24;
/** Past this, a "message" is a payload in disguise and we render our own. */
const MAX_MESSAGE_LENGTH = 200;
const MAX_ID_LENGTH = 64;
/** SPEC §6: a round scores 0..100. Totals are not bounded — round count varies. */
const MAX_ROUND_SCORE = 100;
const MAX_COUNT = Number.MAX_SAFE_INTEGER;
/** The picker's chroma cap and the hue wrap point — `server/decode.ts`'s bounds. */
const MAX_CHROMA = 0.5;
const MAX_HUE = 360;

const OFFLINE = "You are offline.";
const UNREACHABLE = "Could not reach the server.";
const SERVER_FAULT = "The server had a problem. Try again in a moment.";
const MALFORMED = "The server sent something this version cannot read.";
const REJECTED = "The server rejected that.";

type Decode<T> = (record: Record<string, unknown>) => T | null;

function failure(kind: ApiErrorKind, message: string): Result<never> {
  return { ok: false, error: { kind, message } };
}

const nonNegative = (value: unknown): number | null => asBoundedNumber(value, 0, MAX_COUNT);
const positive = (value: unknown): number | null => asBoundedNumber(value, 1, MAX_COUNT);
const asName = (value: unknown): string | null => asString(value, MAX_NAME_LENGTH);

/**
 * `decode.ts` has no strict boolean narrowing on purpose — its only boolean
 * reader is the lenient `booleanField`, and defaulting `isYou` would invent a
 * fact about the player instead of reporting that the answer was unreadable.
 */
const asBoolean = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);

/** `undefined` means unreadable; `null` is a null the server legitimately sent. */
function nullable<T>(value: unknown, decode: (value: unknown) => T | null): T | null | undefined {
  return value === null ? null : (decode(value) ?? undefined);
}

/** All-or-nothing: one unreadable row makes the whole list unreadable. */
function decodeList<T>(value: unknown, decode: Decode<T>): readonly T[] | null {
  const items = asArray(value);
  if (items === null) return null;
  const decoded: T[] = [];
  for (const item of items) {
    const record = asRecord(item);
    const row = record === null ? null : decode(record);
    if (row === null) return null;
    decoded.push(row);
  }
  return decoded;
}

function decodeIdentity(record: Record<string, unknown>): Identity | null {
  const name = nullable(record.name, asName);
  const bestScore = nonNegative(record.bestScore);
  const gamesPlayed = nonNegative(record.gamesPlayed);
  const rank = nullable(record.rank, positive);
  if (name === undefined || rank === undefined) return null;
  if (bestScore === null || gamesPlayed === null) return null;
  return { name, bestScore, gamesPlayed, rank };
}

function decodeRankedGame(record: Record<string, unknown>): RankedGame | null {
  const gameId = asString(record.gameId, MAX_ID_LENGTH);
  const seed = asFiniteNumber(record.seed);
  const roundsTotal = positive(record.roundsTotal);
  if (gameId === null || seed === null || roundsTotal === null) return null;
  return { gameId, seed, roundsTotal };
}

function decodeRound(record: Record<string, unknown>): RoundReport | null {
  const deltaE = nonNegative(record.deltaE);
  const score = asBoundedNumber(record.score, 0, MAX_ROUND_SCORE);
  return deltaE === null || score === null ? null : { deltaE, score };
}

function decodeSubmission(record: Record<string, unknown>): Submission | null {
  const totalScore = nonNegative(record.totalScore);
  const rounds = decodeList(record.rounds, decodeRound);
  const rank = positive(record.rank);
  const isPersonalBest = asBoolean(record.isPersonalBest);
  const name = nullable(record.name, asName);
  const claimed = asBoolean(record.claimed);
  if (totalScore === null || rounds === null || rank === null) return null;
  if (isPersonalBest === null || name === undefined || claimed === null) return null;
  return { totalScore, rounds, rank, isPersonalBest, name, claimed };
}

function decodeEntry(record: Record<string, unknown>): LeaderboardEntry | null {
  const rank = positive(record.rank);
  const name = asName(record.name);
  const score = nonNegative(record.score);
  const isYou = asBoolean(record.isYou);
  const gameId = asString(record.gameId, MAX_ID_LENGTH);
  if (rank === null || name === null || score === null || isYou === null) return null;
  return gameId === null ? null : { rank, name, score, isYou, gameId };
}

/** OKLCh from the server's replay: L 0..1, chroma bounded, hue 0..360. */
function decodeOklch(value: unknown): Oklch | null {
  const record = asRecord(value);
  if (record === null) return null;
  const L = asBoundedNumber(record.L, 0, 1);
  const c = asBoundedNumber(record.c, 0, MAX_CHROMA);
  const h = asBoundedNumber(record.h, 0, MAX_HUE);
  return L === null || c === null || h === null ? null : oklch(L, c, h);
}

function decodeAttemptRound(record: Record<string, unknown>): AttemptRound | null {
  const deltaE = nonNegative(record.deltaE);
  const score = asBoundedNumber(record.score, 0, MAX_ROUND_SCORE);
  const target = decodeOklch(record.target);
  const guess = decodeOklch(record.guess);
  if (deltaE === null || score === null || target === null || guess === null) return null;
  return { deltaE, score, target, guess };
}

function decodeAttempt(record: Record<string, unknown>): Attempt | null {
  const totalScore = nonNegative(record.totalScore);
  const rounds = decodeList(record.rounds, decodeAttemptRound);
  return totalScore === null || rounds === null ? null : { totalScore, rounds };
}

function decodeLeaderboard(
  record: Record<string, unknown>,
): { readonly entries: readonly LeaderboardEntry[] } | null {
  const entries = decodeList(record.entries, decodeEntry);
  return entries === null ? null : { entries };
}

function decodeClaimedName(record: Record<string, unknown>): { readonly name: string } | null {
  const name = asName(record.name);
  return name === null ? null : { name };
}

/** The 4xx body's `message`, verbatim — the UI renders it as-is. */
function rejectionMessage(text: string): string {
  const record = parseRecord(text);
  return (record === null ? null : asString(record.message, MAX_MESSAGE_LENGTH)) ?? REJECTED;
}

export function createApi(options: ApiOptions = {}): GameApi {
  const fetchImpl =
    options.fetchImpl ??
    ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => fetch(input, init));
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  type Body = Result<Record<string, unknown> | null>;

  async function send(
    method: "GET" | "POST" | "DELETE",
    path: string,
    payload: unknown,
  ): Promise<Body> {
    // A browser that knows it has no network gives a guaranteed failure and an
    // eight-second wait for it. The inverse does not hold — `onLine === true`
    // only means an interface is up — so the catch below still does the work.
    if (navigator.onLine === false) return failure("offline", OFFLINE);

    let response: Response;
    let text: string;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        credentials: "same-origin",
        // A fresh deadline per call, so a slow request cannot poison the next.
        signal: AbortSignal.timeout(timeoutMs),
        ...(payload === undefined
          ? {}
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
      });
      text = response.status === NO_CONTENT ? "" : await response.text();
    } catch {
      // DNS failure, dropped connection, CORS refusal, or our own deadline
      // firing. The player cannot act on the distinction, so neither do we.
      return failure("offline", UNREACHABLE);
    }

    if (!response.ok) {
      return response.status < 500
        ? failure("rejected", rejectionMessage(text))
        : failure("server", SERVER_FAULT);
    }
    // Only a 204 means "no body". An empty 200 is a body that failed to arrive,
    // and answering `null` to that would look exactly like a real "no identity".
    if (response.status === NO_CONTENT) return { ok: true, value: null };
    const record = parseRecord(text);
    return record === null ? failure("server", MALFORMED) : { ok: true, value: record };
  }

  function decoded<T>(res: Body, decode: Decode<T>): Result<T> {
    if (!res.ok) return res;
    const value = res.value === null ? null : decode(res.value);
    return value === null ? failure("server", MALFORMED) : { ok: true, value };
  }

  return {
    async me(): Promise<Result<Identity | null>> {
      const res = await send("GET", "/me", undefined);
      if (!res.ok) return res;
      if (res.value === null) return { ok: true, value: null };
      return decoded(res, decodeIdentity);
    },
    async startRanked(memorizeMs: number, challengeOf?: string): Promise<Result<RankedGame>> {
      const payload = challengeOf === undefined ? { memorizeMs } : { memorizeMs, challengeOf };
      return decoded(await send("POST", "/games", payload), decodeRankedGame);
    },
    async submit(req: SubmitRequest): Promise<Result<Submission>> {
      // `gameId` is the single-use submit token, so it belongs in the path: the
      // server's guard is a conditional UPDATE keyed on it, and putting it in the
      // body as well would invite the two copies to disagree.
      const path = `/games/${encodeURIComponent(req.gameId)}/result`;
      const payload = {
        guesses: req.guesses,
        ...(req.name === undefined ? {} : { name: req.name }),
      };
      return decoded(await send("POST", path, payload), decodeSubmission);
    },
    async claimName(name: string): Promise<Result<{ readonly name: string }>> {
      return decoded(await send("POST", "/name", { name }), decodeClaimedName);
    },
    async leaderboard(
      forGame?: string,
      mode?: BoardMode,
    ): Promise<Result<{ readonly entries: readonly LeaderboardEntry[] }>> {
      const params = new URLSearchParams();
      if (forGame !== undefined) params.set("forGame", forGame);
      if (mode === "all") params.set("view", "all");
      const query = params.toString();
      const path = query === "" ? "/leaderboard" : `/leaderboard?${query}`;
      return decoded(await send("GET", path, undefined), decodeLeaderboard);
    },
    async attempt(gameId: string): Promise<Result<Attempt>> {
      const path = `/games/${encodeURIComponent(gameId)}/attempt`;
      return decoded(await send("GET", path, undefined), decodeAttempt);
    },
  };
}
