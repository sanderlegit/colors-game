# 0016 — Server-side replay on Cloudflare Workers, with D1

Date: 2026-08-02 · Status: accepted — **platform choice superseded in part by [0022](0022-workers-with-static-assets.md)**

## Context

ARCHITECTURE.md has carried this limitation since the first build:

> The target color exists in client memory during `picking` and can be read with
> devtools. Acceptable for a single-player, offline, no-leaderboard game; the
> moment a leaderboard exists, target generation moves server-side.

A leaderboard now exists (`src/platform/api.ts` is the client port for it), so
that moment has arrived. A board whose numbers are whatever the client posted is
not a board; it is a text field. Something has to compute the authoritative score.

The obvious shape — send the guesses, have the server compute targets and scores
its own way — is the one that quietly breaks. Two implementations of CIEDE2000
and of the OKLCh gamut bisection will not agree to the last decimal, and the
player sees the disagreement as the reveal screen and the leaderboard telling
them different things about the same game. `docs/history/README.md` records that
naive CIEDE2000 implementations pass the CIE's own worked examples while being
wrong; two of them would be worse.

CLAUDE.md also forbids adding any dependency, dev or runtime, without an ADR.
This adds one: `wrangler`.

## Decision

**The server re-scores by replaying the same pure functions the client ran.**

The server issues the seed. The client generates its targets locally with
`generateTarget(seed, roundIndex, difficulty)` and submits only its guesses. The
Worker calls the *same* `generateTarget` and the *same* `scoreGuess`, imported
unmodified from `src/domain/**`, and the result is authoritative. The client's
own numbers are never read.

This is why SPEC §5.2's "every game is fully determined by a single integer seed"
was worth building on day one: the entire server-authority story is one integer
and five OKLCh triples.

Four supporting decisions come with it:

1. **Cloudflare Pages Functions + D1.** The client is already a static bundle on
   a CDN; Pages Functions put the API on the same origin, which means the
   identity cookie can be `SameSite=Strict` and there is no CORS surface at all.
   D1 is SQLite, so the schema is ordinary SQL and the whole thing is one
   `wrangler` away from running locally.
2. **`wrangler` as a dev dependency, and the only addition.** Runtime
   dependencies stay at zero — the deployed Worker is our own code and the pure
   core. `@cloudflare/workers-types` is deliberately *not* a dependency:
   `npx wrangler types` generates `server/worker-configuration.d.ts` and that
   file is committed, so the runtime types are pinned to the workerd build we
   generated them from rather than floating on a version range.
3. **A third TypeScript project, `tsconfig.server.json`, with `"lib": ["ES2022"]`
   and `"types": []`.** Compiling the pure core a second time with no DOM turns
   "the core runs unmodified under Workers" from a claim into a compile error.
   `server/**` imports the core with relative paths rather than the `@/` alias,
   because wrangler bundles with esbuild and esbuild resolves `paths` from
   whichever tsconfig it discovers — a resolution that works locally and fails at
   deploy is the worst failure mode available here.
4. **A `Repo` port with a Map-backed double**, the same move as Clock, Rng,
   Storage and SeedSource. Every SQL statement lives in `server/db/d1.ts` and
   nowhere else, so `memoryRepo()` is a legitimate stand-in and handler tests
   need no D1, no `wrangler dev`, and no network.

**Authorisation is possession plus first arrival.** The game id is 32 bytes of
base64url and *is* the single-use submit token; finalising is a conditional
`UPDATE ... WHERE id = ? AND status = 'active'` whose `meta.changes === 0` is the
entire replay defence. There is no read-then-check for a race to slip into.

## Consequences

- **The pure core is now load-bearing on two runtimes.** A change to
  `generateTarget`, `scoreGuess`, or anything under `src/color/**` changes every
  historical score's reproducibility. Retuning the curve is still a one-line
  change, but it is no longer a local one — stored `total_score` values were
  computed under the old constants and will not re-derive.
- **There is no `rounds` table.** Under seed replay every target, ΔE and round
  score is a pure function of `(seed, roundIndex, difficulty, guesses)`, so
  per-round rows would store derived data that can only ever disagree with the
  functions deriving it. The guesses are the sole irreducible input.
- **The identity is a cookie, not an account.** `players.token_hash` stores the
  SHA-256 of the token, never the token, so a database dump is not a pile of live
  credentials. Clearing cookies loses the identity; that is the trade for having
  no sign-up.
- **`total_score` is an INTEGER.** Board ordering is provably immune to float
  drift, at the cost of the board's number differing from the reveal screen's sum
  by up to half a point.
- `npm run typecheck` now runs three projects, and `npm run verify` is slower by
  one `tsc` pass.
- The purity guard grew a second, weaker block for `server/**`: no DOM, and no
  imports from `src/ui/**` or `src/platform/**`. The backend is a shell — it
  reads a clock and mints randomness — so the core's other bans do not apply.

## What this does not decide

Rate-limiting policy, name-change limits, the anti-abuse `flags` bitfield's
meanings, and the sweep of stale `active` games. The schema has room for all
four; none of them has a rule yet. See `../BACKLOG.md`.
