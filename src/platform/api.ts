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

import type { Oklch } from "@/color/types";
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
  startRanked(memorizeMs: number): Promise<Result<RankedGame>>;
  submit(req: SubmitRequest): Promise<Result<Submission>>;
  claimName(name: string): Promise<Result<{ readonly name: string }>>;
  leaderboard(): Promise<Result<{ readonly entries: readonly LeaderboardEntry[] }>>;
  forget(): Promise<Result<null>>;
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

/** A leaderboard row has to fit a phone; longer is corruption, not a name. */
export const MAX_NAME_LENGTH = 24;
/** Past this, a "message" is a payload in disguise and we render our own. */
const MAX_MESSAGE_LENGTH = 200;
const MAX_ID_LENGTH = 64;
/** SPEC §6: a round scores 0..100. Totals are not bounded — round count varies. */
const MAX_ROUND_SCORE = 100;
const MAX_COUNT = Number.MAX_SAFE_INTEGER;

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
  if (rank === null || name === null || score === null || isYou === null) return null;
  return { rank, name, score, isYou };
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
    async startRanked(memorizeMs: number): Promise<Result<RankedGame>> {
      return decoded(await send("POST", "/games", { memorizeMs }), decodeRankedGame);
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
    async leaderboard(): Promise<Result<{ readonly entries: readonly LeaderboardEntry[] }>> {
      return decoded(await send("GET", "/leaderboard", undefined), decodeLeaderboard);
    },
    async forget(): Promise<Result<null>> {
      const res = await send("DELETE", "/me", undefined);
      return res.ok ? { ok: true, value: null } : res;
    },
  };
}
