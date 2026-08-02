/**
 * One hostname is the site; every other one that reaches us is a redirect.
 *
 * ## Why this is an identity problem, not a vanity problem
 *
 * Two decisions made here collide the moment the site answers on two hostnames.
 * The identity cookie is **host-only** (ADR 0011 sets no `Domain`), and the CSRF
 * guard compares `Origin` against the request's *own* URL rather than a
 * configured hostname. Both are right on their own, and together they mean a
 * second hostname is not a second address for the site — it is a **second
 * site**, with its own cookie jar and its own player rows, whose scores land on
 * the same leaderboard. A player who once loaded the wrong hostname cannot claim
 * the name they already own, and nothing tells them why.
 *
 * ADR 0021 was written against a Pages project, which answers on
 * `<project>.pages.dev` forever with no way to switch it off. On Workers
 * `workers_dev = false` removes that free hostname outright (ADR 0022), so the
 * *specific* leak this was built for is gone. It stays because the property is
 * not about `pages.dev`: any route ever added beside the canonical one — a
 * staging domain, a second custom domain, a zone-wide wildcard — reintroduces it
 * exactly, and the failure is invisible from the server side.
 *
 * Handling it here rather than in dashboard configuration is deliberate: the
 * property is enforced by code that ships with the thing it protects, and it is
 * testable. A Bulk Redirect is a setting somebody has to remember.
 *
 * ## Absent means disabled, and that is the point
 *
 * `CANONICAL_HOST` is unset in `wrangler.toml` and unset locally, so every
 * development surface keeps working unchanged: `wrangler dev` on `localhost`,
 * the e2e proxy on `127.0.0.1:5174`, and a phone on a `ts.net` hostname
 * (ADR 0020) each answer to a host nobody can enumerate in advance. Only the
 * deployed Worker sets it, with `wrangler secret put CANONICAL_HOST`.
 *
 * Fail *open* on absence rather than guessing a canonical host, because guessing
 * wrong takes the site down and guessing nothing costs only what we already have.
 */

/**
 * `308`, not `301`. A permanent redirect that a browser is allowed to rewrite to
 * `GET` would silently convert a score submission into a page load, and the
 * player would watch a finished game vanish. `308` preserves method and body.
 */
const PERMANENT_REDIRECT = 308;

/**
 * A redirect to the canonical origin, or `null` when the request is already
 * canonical or no canonical host is configured.
 *
 * Only the host is compared. Scheme is not, because Cloudflare terminates TLS and
 * the URL the Worker sees is already `https`; port is not, because a deployed
 * Worker is on the default one and a configured host carrying a port would never
 * match anything.
 */
export function canonicalRedirect(
  request: Request,
  canonicalHost: string | undefined,
): Response | null {
  if (canonicalHost === undefined || canonicalHost === "") return null;

  const url = new URL(request.url);
  if (url.hostname === canonicalHost) return null;

  url.hostname = canonicalHost;
  url.port = "";
  return new Response(null, {
    status: PERMANENT_REDIRECT,
    headers: {
      location: url.toString(),
      // The wrong hostname is a fact about this request, not about the resource,
      // and a cached redirect from a preview deployment would outlive it.
      "cache-control": "no-store",
    },
  });
}
