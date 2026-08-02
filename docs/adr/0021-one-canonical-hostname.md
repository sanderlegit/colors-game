# 0021 — One canonical hostname, enforced by the Worker

Date: 2026-08-02 · Status: accepted — **premise partly obsolete: [0022](0022-workers-with-static-assets.md) sets `workers_dev = false`, so there is no unswitchable second hostname. The redirect stays; it now guards against a second hostname rather than repairing one.**

## Context

The game is going to a custom domain. A Cloudflare Pages project also answers
forever on `<project>.pages.dev`, and Cloudflare documents no way to switch that
off — the suggested mitigations are Cloudflare Access, or a Bulk Redirect rule,
both configured in a dashboard rather than in this repository.

Two decisions already made here turn that from cosmetic into a correctness bug:

- **The identity cookie is host-only** (ADR 0011 sets no `Domain`, deliberately).
- **The CSRF guard compares `Origin` against the request's own URL** rather than a
  configured hostname (`server/http/origin.ts`), so preview deployments and custom
  domains work without a list to keep current.

Each is right on its own. Together they mean `pages.dev` is not a second address
for the site — it is a **second site**. It has its own cookie jar, so its visitors
get their own `players` rows, while their scores land on the same leaderboard.
A player who once loaded the wrong hostname cannot claim the name they already
own, gets a "that name is taken" they cannot explain, and nothing anywhere tells
them why. It is invisible, it is permanent, and it is the kind of thing that
generates a bug report nobody can reproduce.

## Decision

`server/http/canonical.ts` answers any request whose hostname is not
`env.CANONICAL_HOST` with a **`308`** to the same path on the canonical host. It
runs before routing, before any cookie is read, and before D1 is touched.

`CANONICAL_HOST` is set **only** in the deployed Pages project's settings, not in
`wrangler.toml`. **Absent disables the check.**

## Consequences

- **`308`, not `301`.** A permanent redirect that a browser may rewrite to `GET`
  would turn a score submission into a page load, and the player would watch a
  finished game disappear. `308` preserves method and body.
- **Absent-means-disabled is what keeps development working.** `wrangler pages
  dev` on `localhost`, the e2e proxy on `127.0.0.1:5174`, and a phone on a
  `ts.net` address (ADR 0020) all answer to hostnames nobody can enumerate in
  advance. Failing *open* on absence costs only what we already have; guessing a
  canonical host and getting it wrong takes the site down.
- **It must not go in `wrangler.toml`.** A value there also applies to
  `wrangler pages dev`, which would redirect localhost into production — the same
  reason `DEBUG_REPLAY` is declared in `functions/env.d.ts` and nowhere else.
- Enforcing this in shipped, tested code rather than in a Bulk Redirect rule means
  the property travels with the thing it protects. A dashboard setting is one
  somebody has to remember, and it is not visible in a diff.
- The redirect still passes through logging and still gets the security headers,
  so a redirect loop would show up in the logs rather than as a blank page.
- No body is returned, so nothing is rendered on the non-canonical origin.
- **This does not replace the `Origin` check**, which stays exactly as it is. The
  two answer different questions: this one says "you are at the wrong address",
  that one says "this request did not come from this site".
- Cost: one string comparison per request.

## How we would know this was wrong

If a legitimate surface ever needs to serve on two hostnames at once — a staging
domain people actually use, say — this becomes a list rather than a single value,
and the cookie's host-only property has to be revisited at the same time. Do not
add the second hostname without deciding what happens to identity across the two.
