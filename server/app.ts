/**
 * The backend's composition root — the counterpart to `src/main.ts`, and like
 * it, the only file that decides anything about wiring.
 *
 * It owns six cross-cutting rules so that no handler has to remember them:
 *
 * 1. **Routing**, including the difference between 404 and 405.
 * 2. **CSRF.** Unsafe methods must carry a same-origin `Origin`. Doing this at
 *    the router means a new endpoint is protected the moment it is added to the
 *    table, rather than the moment somebody remembers.
 * 3. **The failure boundary.** Every throw becomes a 500 with a generic body.
 *    An unhandled rejection in a Worker becomes an opaque platform error page,
 *    and a leaked stack trace tells an attacker the schema.
 * 4. **Binding the repo to the request**, since the D1 handle only exists on
 *    `env`.
 * 5. **Security headers on every response**, for the same reason as the CSRF
 *    check — including the 404s and the 500s, which is where a per-handler
 *    approach always leaks. See `http/security.ts`.
 * 6. **One wide structured log event per request**, and exactly one. See
 *    `log.ts` for what may and may not appear in it; the short version is that
 *    the token, the address and the raw path never do.
 *
 * `createApp` takes its dependencies so a test can hand it `memoryRepo()`, a
 * frozen clock and a capturing `emit`, and drive the whole stack — router, CSRF,
 * headers, logging, handlers — through `Request` objects, with no Cloudflare
 * anywhere.
 */

import type { AppExecutionContext } from "./context";
import { type AppDeps, productionDeps, type RequestContext } from "./context";
import { replayVectors } from "./debug/replay-vectors";
import { reportClientError } from "./handlers/clientError";
import { startGame } from "./handlers/games";
import { deepHealth, health } from "./handlers/health";
import { getLeaderboard } from "./handlers/leaderboard";
import { forgetMe, getMe } from "./handlers/me";
import { setUsername } from "./handlers/name";
import { submitResult } from "./handlers/submit";
import { canonicalRedirect } from "./http/canonical";
import { IDENTITY_COOKIE, readCookie } from "./http/cookie";
import { problem } from "./http/json";
import { isSameOrigin, isUnsafeMethod } from "./http/origin";
import { secured } from "./http/security";
import { playerKey, requestRecord, type TraceContext, traceContext } from "./log";
import { createRouter, type Match, type Route } from "./router";

/**
 * A route plus the name its log events carry.
 *
 * The event name lives on the table rather than being derived in a handler for
 * the same reason the routes do: one place to read, and a new endpoint cannot
 * ship without one. `Route<C>` itself stays free of it so the router remains
 * ignorant of what it is routing.
 */
type ApiRoute = Route<RequestContext> & { readonly event: string };

/**
 * Paths carry the `/api` prefix because that is what arrives: nothing rewrites
 * the path on the way in — a request that matches no file in `dist/` reaches
 * this Worker exactly as the browser sent it — and a router that matched a
 * stripped path would disagree with every other place these endpoints are
 * written down.
 *
 * `/debug/replay-vectors` is the one entry that is not `/api/*`, and it is inert
 * unless `DEBUG_REPLAY` is set. It sits in this table rather than ahead of it so
 * that it gets the same 404s, the same headers and the same log line as
 * everything else — a route handled off to one side is a route with its own
 * rules.
 */
const ROUTES: readonly ApiRoute[] = [
  { method: "GET", path: "/api/health", handle: health, event: "health_checked" },
  { method: "GET", path: "/api/health/deep", handle: deepHealth, event: "dependencies_checked" },
  { method: "GET", path: "/api/me", handle: getMe, event: "identity_read" },
  { method: "DELETE", path: "/api/me", handle: forgetMe, event: "identity_forgotten" },
  { method: "POST", path: "/api/games", handle: startGame, event: "game_started" },
  {
    method: "POST",
    path: "/api/games/:gameId/result",
    handle: submitResult,
    event: "score_submitted",
  },
  { method: "POST", path: "/api/name", handle: setUsername, event: "name_claimed" },
  { method: "GET", path: "/api/leaderboard", handle: getLeaderboard, event: "leaderboard_read" },
  {
    method: "POST",
    path: "/api/client-error",
    handle: reportClientError,
    event: "client_error_reported",
  },
  {
    method: "GET",
    path: "/debug/replay-vectors",
    handle: replayVectors,
    event: "replay_vectors_checked",
  },
];

/** What a request that matched no route is called in the logs. */
const UNROUTED = "not_routed";

/**
 * The path a log line reports when nothing matched.
 *
 * Deliberately a constant rather than the requested path: a 404's path is
 * attacker-chosen, and echoing it into a structured field is how a log store
 * ends up holding somebody else's payload.
 */
const UNROUTED_PATH = "(unrouted)";

export type App = (request: Request, env: Env, ctx: AppExecutionContext) => Promise<Response>;

export function createApp(deps: AppDeps = productionDeps): App {
  const route = createRouter<RequestContext>(ROUTES);
  const events = new Map(ROUTES.map((entry) => [`${entry.method} ${entry.path}`, entry.event]));

  /**
   * The peppered short hash of the caller's identity token, or `null`.
   *
   * Hashed here rather than reusing the one `currentPlayer` computes, because
   * that one is the database key and this one must not be: a log store holding
   * `players.token_hash` would be holding a value that unlocks a row.
   */
  async function keyFor(request: Request): Promise<string | null> {
    const token = readCookie(request.headers.get("cookie"), IDENTITY_COOKIE);
    if (token === null) return null;
    return playerKey(token, deps.logPepper(), deps.hashToken);
  }

  async function log(
    request: Request,
    trace: TraceContext,
    pattern: string,
    event: string,
    response: Response,
    startedAt: number,
  ): Promise<void> {
    try {
      const at = deps.now();
      const record = requestRecord({
        at,
        trace,
        method: request.method.toUpperCase(),
        route: pattern,
        event,
        status: response.status,
        durationMs: at - startedAt,
        player: await keyFor(request),
        request,
      });
      deps.emit(JSON.stringify(record));
    } catch {
      // Logging is outside the failure boundary — it runs *after* the response
      // exists — so a throw here would escape as an unhandled rejection and turn
      // a perfectly good 200 into an opaque platform error page. Losing a log
      // line is the acceptable failure; losing the response is not.
    }
  }

  async function answer(
    request: Request,
    env: Env,
    ctx: AppExecutionContext,
    match: Match<RequestContext>,
    url: URL,
  ): Promise<Response> {
    if (match.kind === "none") {
      return problem(404, "not_found", "No such endpoint.");
    }
    if (match.kind === "method") {
      // The `Allow` header is required on a 405 and is the only thing that makes
      // one actionable.
      return problem(405, "method_not_allowed", "That method is not allowed here.", {
        allow: match.allow.join(", "),
      });
    }
    if (isUnsafeMethod(request.method) && !isSameOrigin(request)) {
      return problem(403, "forbidden", "That request did not come from this site.");
    }

    try {
      // Binding the repo is inside the boundary: a D1 handle that is missing
      // because the binding was never configured is a 500, not a stack trace.
      const context: RequestContext = { request, url, env, repo: deps.repo(env), deps, ctx };
      return await match.handle(context, match.params);
    } catch {
      // Deliberately says nothing. The error is a schema mismatch, a D1 outage,
      // or a bug — none of which the player can act on, and all of which
      // describe our internals to whoever provoked them.
      return problem(500, "internal", "The server had a problem. Try again in a moment.");
    }
  }

  return async function handle(
    request: Request,
    env: Env,
    ctx: AppExecutionContext,
  ): Promise<Response> {
    const startedAt = deps.now();
    const trace = traceContext(request, deps.newId);
    const url = new URL(request.url);
    const match = route(request.method, url.pathname);

    // The pattern, never `url.pathname`: the submit path contains the game id,
    // and that id *is* the single-use submit token.
    const pattern = match.kind === "found" ? match.pattern : UNROUTED_PATH;
    const event =
      match.kind === "found"
        ? (events.get(`${request.method.toUpperCase()} ${match.pattern}`) ?? UNROUTED)
        : UNROUTED;

    // Before anything reads a cookie or touches D1: a request on a non-canonical
    // hostname is answered on the canonical one instead (ADR 0021). It still gets
    // logged and still gets the security headers, so a redirect loop would be
    // visible rather than silent.
    const response =
      canonicalRedirect(request, env.CANONICAL_HOST) ??
      (await answer(request, env, ctx, match, url));
    // Awaited rather than deferred with `waitUntil`: the record is one SHA-256
    // and a `JSON.stringify`, and a log line that races the response is a log
    // line that goes missing exactly when the request is the interesting one.
    await log(request, trace, pattern, event, response, startedAt);
    return secured(response);
  };
}
