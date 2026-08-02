/**
 * The whole backend, driven through real `Request` objects, with no Cloudflare
 * and no D1 anywhere.
 *
 * The handlers' contract is an HTTP one — statuses, headers, cookies, bodies —
 * so the tests exercise it as HTTP. Calling a handler function directly would
 * skip routing, the CSRF guard and the failure boundary, which is three of the
 * four things `app.ts` exists to do.
 *
 * Two conveniences, both there because leaving them out makes tests lie:
 *
 * - **It keeps a cookie jar**, like a browser. The identity cookie is `HttpOnly`
 *   and the client cannot read it, so a test that passed cookies by hand would
 *   be testing a client we do not ship.
 * - **It sends `Origin` on unsafe methods** by default, because every real
 *   request from `src/platform/api.ts` does. A test that forgets it gets a 403
 *   from the CSRF guard and blames the handler.
 *
 * Everything ambient is pinned: the clock does not move unless the test moves
 * it, tokens are issued in order, and the seed is a constant, so a replay
 * assertion can be written against a known seed.
 */

import { ROUNDS_PER_GAME } from "../src/domain/state";
import { asFiniteNumber, asRecord, asString } from "../src/shared/decode";
import { createApp } from "./app";
import type { AppDeps, AppExecutionContext } from "./context";
import { type MemoryRepo, memoryRepo } from "./db/memory";
import type { Repo } from "./db/repo";
import { IDENTITY_COOKIE, readCookie } from "./http/cookie";
import { minimumElapsedMs } from "./limits";

export const SITE = "https://colors.example";

/** An arbitrary fixed instant. Nothing depends on its value, only on its fixity. */
export const T0 = 1_700_000_000_000;

/** The seed every fixture game is issued with, so replays can be asserted. */
export const FIXTURE_SEED = 41762;

/**
 * `DB` is a throwing getter rather than a stub or a cast: `deps.repo` is always
 * replaced, so nothing ever reads the binding, and a getter makes that a loud
 * failure instead of an `undefined` that surfaces three frames away.
 */
function fakeEnv(): Env {
  return {
    get DB(): D1Database {
      throw new Error("no D1 binding in unit tests — inject deps.repo instead");
    },
  };
}

export type SendOptions = {
  /** Serialised as JSON. Omit for a request with no body at all. */
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  /** `null` sends no cookie even when the jar holds one. */
  readonly cookie?: string | null;
  /** What Cloudflare would put in `CF-Connecting-IP`. */
  readonly ip?: string;
};

export type Client = {
  readonly repo: MemoryRepo;
  /** The instant every handler reads. Tests move it to make time pass. */
  setNow(at: number): void;
  now(): number;
  send(method: string, path: string, options?: SendOptions): Promise<Response>;
  /** The token the jar is holding, for the tests that care that it changed. */
  token(): string | null;
  /**
   * Every log line the app emitted, parsed. One per request, in order — see
   * `server/log.ts` for why "one" is the budget rather than a preference.
   */
  logs(): readonly Record<string, unknown>[];
};

/**
 * `prefix` names the tokens this client mints. Two clients sharing one repo —
 * which is how a test gets two players — must not both issue `tok-1`, or the
 * second one's first game collides with the first one's on the primary key.
 */
export function createClient(over: Partial<AppDeps> = {}, prefix = "tok"): Client {
  const repo = memoryRepo();
  let clock = T0;
  let issued = 0;
  let ids = 0;
  let jar: string | null = null;
  const lines: string[] = [];

  /**
   * `waitUntil` really runs the work, and `send` awaits it.
   *
   * A no-op would make every deferred write — `touchPlayer`, and now the
   * ADR 0014 counters — silently vanish in tests, so a handler that forgot to
   * defer and a handler that forgot to write would look identical.
   */
  const pending: Promise<unknown>[] = [];
  const ctx: AppExecutionContext = {
    waitUntil: (promise: Promise<unknown>): void => {
      pending.push(promise);
    },
  };

  const deps: AppDeps = {
    repo: (): Repo => repo,
    now: (): number => clock,
    // Unique per call: a constant would make the second game collide with the
    // first on the primary key, which is a bug in the fixture, not the schema.
    newToken: (): string => {
      issued += 1;
      return `${prefix}-${issued}`;
    },
    hashToken: (token: string): Promise<string> => Promise.resolve(`hash:${token}`),
    newSeed: (): number => FIXTURE_SEED,
    mintSalt: (day: number): string => `salt-${day}`,
    // Counted rather than random, so a test can assert the exact trace and
    // request ids a log line carries instead of matching them with a regex.
    newId: (bytes: number): string => {
      ids += 1;
      return String(ids).padStart(bytes * 2, "0");
    },
    logPepper: (): string => "pepper",
    emit: (line: string): void => {
      lines.push(line);
    },
    ...over,
  };

  const app = createApp(deps);

  async function send(method: string, path: string, options: SendOptions = {}): Promise<Response> {
    const cookie = options.cookie === undefined ? jar : options.cookie;
    const headers: Record<string, string> = {
      origin: SITE,
      ...(cookie === null ? {} : { cookie: `${IDENTITY_COOKIE}=${cookie}` }),
      ...(options.ip === undefined ? {} : { "cf-connecting-ip": options.ip }),
      ...options.headers,
    };
    const init: RequestInit =
      options.body === undefined
        ? { method, headers }
        : {
            method,
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify(options.body),
          };

    const response = await app(new Request(`${SITE}${path}`, init), fakeEnv(), ctx);
    // Drain before returning: a deferred write nothing waits for is a race, and
    // a test that raced would be flaky rather than wrong.
    while (pending.length > 0) await pending.shift();

    const setCookie = response.headers.get("set-cookie");
    // The clearing cookie carries an empty value, which `readCookie` reports as
    // no cookie — so forgetting empties the jar without a second code path.
    if (setCookie !== null) jar = readCookie(setCookie, IDENTITY_COOKIE);
    return response;
  }

  return {
    repo,
    setNow: (at: number): void => {
      clock = at;
    },
    now: (): number => clock,
    send,
    token: (): string | null => jar,
    logs: (): readonly Record<string, unknown>[] =>
      lines.map((line) => {
        const record = asRecord(JSON.parse(line));
        if (record === null) throw new Error("a log line was not a JSON object");
        return record;
      }),
  };
}

/** The body of a response, as the untyped thing it arrives as. */
export function body(response: Response): Promise<unknown> {
  return response.json();
}

/** A record from a response body, or a failed assertion — never a cast. */
export async function jsonRecord(response: Response): Promise<Record<string, unknown>> {
  const parsed = asRecord(await response.json());
  if (parsed === null) throw new Error("expected a JSON object body");
  return parsed;
}

/** Five in-range guesses. Nothing depends on the values; they are just a game. */
export const GUESSES: readonly Record<string, number>[] = [
  { L: 0.52, c: 0.11, h: 24 },
  { L: 0.63, c: 0.19, h: 128 },
  { L: 0.41, c: 0.07, h: 212 },
  { L: 0.77, c: 0.14, h: 300 },
  { L: 0.35, c: 0.22, h: 349 },
];

export type PlayOptions = {
  readonly memorizeMs?: number;
  readonly name?: string;
  readonly guesses?: readonly unknown[];
  readonly ip?: string;
};

/** Start a game and answer with the id and seed the server issued. */
export async function startGame(
  client: Client,
  options: PlayOptions = {},
): Promise<{ readonly gameId: string; readonly seed: number }> {
  const memorizeMs = options.memorizeMs ?? 5000;
  const response = await client.send("POST", "/api/games", {
    body: { memorizeMs },
    ...(options.ip === undefined ? {} : { ip: options.ip }),
  });
  const record = await jsonRecord(response);
  const gameId = asString(record.gameId, 64);
  const seed = asFiniteNumber(record.seed);
  if (gameId === null || seed === null) throw new Error("the server did not issue a game");
  return { gameId, seed };
}

/**
 * A whole playthrough: start, let exactly the minimum playable time pass on the
 * fixture's clock, submit. The clock is left where the game finished.
 */
export async function playGame(client: Client, options: PlayOptions = {}): Promise<Response> {
  const memorizeMs = options.memorizeMs ?? 5000;
  const started = await startGame(client, options);
  client.setNow(client.now() + minimumElapsedMs(memorizeMs, ROUNDS_PER_GAME));
  return client.send("POST", `/api/games/${started.gameId}/result`, {
    body: {
      guesses: options.guesses ?? GUESSES,
      ...(options.name === undefined ? {} : { name: options.name }),
    },
    ...(options.ip === undefined ? {} : { ip: options.ip }),
  });
}
