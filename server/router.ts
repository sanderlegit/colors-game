/**
 * The whole router. Seven routes and one dynamic segment do not justify a
 * dependency — CLAUDE.md's zero-runtime-dependency rule is not being worked
 * around here, it is being made easy to keep.
 *
 * Two things it does that a naive `if (path === ...)` chain does not:
 *
 * - It distinguishes "no such path" from "wrong method for this path", so a
 *   `GET /api/games` answers 405 with an `Allow` header instead of a 404 that
 *   sends the caller looking for a typo.
 * - It is generic in the handler's context type, so it carries no import from
 *   `app.ts`, `Env`, or anything Cloudflare. The router's tests construct
 *   handlers out of strings.
 *
 * Patterns support exactly one form of dynamic segment, `:name`, matching a
 * single path segment. No wildcards, no optional segments, no regex: every one
 * of those is a way for two routes to overlap, and the resolution rules for
 * overlapping routes are the part of a router that has bugs in it.
 */

export type RouteParams = Readonly<Record<string, string>>;

export type RouteHandler<C> = (context: C, params: RouteParams) => Promise<Response>;

export type Route<C> = {
  readonly method: string;
  readonly path: string;
  readonly handle: RouteHandler<C>;
};

export type Match<C> =
  | {
      readonly kind: "found";
      readonly handle: RouteHandler<C>;
      readonly params: RouteParams;
      /**
       * The pattern that matched, `:param` segments intact.
       *
       * The log line uses this and never `url.pathname`, because the path of a
       * submission contains the game id and that id *is* the single-use submit
       * token. A route pattern is the same information without the credential.
       */
      readonly pattern: string;
    }
  | { readonly kind: "method"; readonly allow: readonly string[] }
  | { readonly kind: "none" };

function segments(path: string): readonly string[] {
  return path.split("/").filter((part) => part !== "");
}

/**
 * `null` when the shapes differ, otherwise the captured params (often empty).
 * Empty-object-means-match is why this returns `null` rather than `{}` on a miss.
 */
function matchPath(pattern: readonly string[], actual: readonly string[]): RouteParams | null {
  if (pattern.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (const [index, expected] of pattern.entries()) {
    const got = actual[index];
    if (got === undefined) return null;
    if (expected.startsWith(":")) {
      // A `:param` never matches an empty segment: `segments` has already
      // dropped those, so `//result` cannot silently capture "".
      // `decodeURIComponent` throws on a malformed escape such as `%zz`, and a
      // path nobody can decode is a path that matches nothing — not a 500.
      let decoded: string;
      try {
        decoded = decodeURIComponent(got);
      } catch {
        return null;
      }
      params[expected.slice(1)] = decoded;
    } else if (expected !== got) {
      return null;
    }
  }
  return params;
}

export type Router<C> = (method: string, path: string) => Match<C>;

export function createRouter<C>(routes: readonly Route<C>[]): Router<C> {
  const compiled = routes.map((route) => ({ ...route, parts: segments(route.path) }));

  return function route(method: string, path: string): Match<C> {
    const wanted = method.toUpperCase();
    const parts = segments(path);
    const allow: string[] = [];

    for (const candidate of compiled) {
      const params = matchPath(candidate.parts, parts);
      if (params === null) continue;
      if (candidate.method === wanted) {
        return { kind: "found", handle: candidate.handle, params, pattern: candidate.path };
      }
      allow.push(candidate.method);
    }

    return allow.length === 0 ? { kind: "none" } : { kind: "method", allow };
  };
}
