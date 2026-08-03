/**
 * What a handler is given, and where the outside world enters.
 *
 * Same shape as `src/main.ts`: everything ambient — the clock, the randomness,
 * the database — arrives as an injected port, and exactly one value in the
 * process (`productionDeps`) binds those ports to the real thing. A handler test
 * therefore needs no D1, no `wrangler dev`, and no wall clock, and the tests can
 * pin `now` and the minted token to constants and assert on them.
 *
 * This lives beside `app.ts` rather than inside it so that handlers can import
 * their own context type without importing the router that dispatches to them.
 */

import { d1Repo } from "./db/d1";
import type { Repo } from "./db/repo";
import { makeDailySalt, makeLogPepper, randomHex, randomSeed, randomToken, sha256Hex } from "./ids";
import type { RouteHandler } from "./router";

/**
 * The slice of the Workers `ExecutionContext` the app uses.
 *
 * Deliberately narrower than `ExecutionContext` itself, and it stays narrow now
 * that `server/index.ts` is handed a real one. `waitUntil` is the whole of what
 * the app uses, so a test fixture can supply a context that collects the
 * promises and drains them — where the full interface would force it to
 * fabricate `exports`, `props` and `tracing`, and a cast there is exactly the
 * kind CLAUDE.md forbids. A real `ExecutionContext` satisfies this.
 */
export type AppExecutionContext = Pick<ExecutionContext, "waitUntil">;

export type AppDeps = {
  /** Bound per request, because the D1 binding only exists on `env`. */
  readonly repo: (env: Env) => Repo;
  /** ms since epoch. The only clock in the backend. */
  readonly now: () => number;
  readonly newToken: () => string;
  readonly hashToken: (token: string) => Promise<string>;
  readonly newSeed: () => number;
  /**
   * The secret the mint buckets are salted with, per day. It is a port for the
   * same reason the clock is: a rate-limit test that had to guess a salt would
   * be a test of the salt. See `makeDailySalt` for what production supplies.
   */
  readonly mintSalt: (day: number) => string;
  /**
   * Lowercase hex from `bytes` random bytes. Trace and request ids only — a
   * port so a test can assert on a log line instead of on a regex.
   */
  readonly newId: (bytes: number) => string;
  /**
   * The pepper the logged player key is derived under (ADR 0030). Deploy-scoped
   * from the `LOG_PEPPER` secret so the key groups a player's requests across
   * isolates for the log's 3-day life, with a per-isolate random fallback when
   * the secret is unset. Bound to `env` for the same reason `repo` is: the
   * secret only exists there. Meaningless outside the log store either way.
   */
  readonly logPepper: (env: Env) => string;
  /**
   * Where the one wide request event goes. Production is `console.log`, which
   * *is* Workers Logs — Cloudflare indexes the fields of a JSON line, so there
   * is nothing to configure and no library to add.
   */
  readonly emit: (line: string) => void;
};

export const productionDeps: AppDeps = {
  repo: (env: Env): Repo => d1Repo(env.DB),
  now: (): number => Date.now(),
  newToken: randomToken,
  hashToken: sha256Hex,
  newSeed: randomSeed,
  mintSalt: makeDailySalt(),
  newId: randomHex,
  logPepper: makeLogPepper(),
  emit: (line: string): void => {
    console.log(line);
  },
};

export type RequestContext = {
  readonly request: Request;
  /** Parsed once by the router's caller; every handler wants the query string. */
  readonly url: URL;
  readonly env: Env;
  readonly repo: Repo;
  readonly deps: AppDeps;
  readonly ctx: AppExecutionContext;
};

export type Handler = RouteHandler<RequestContext>;
