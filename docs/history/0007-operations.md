# 0007 — Making it operable

2026-08-02 · Structured logging, ADR 0014's counters, security headers, the
deploy pipeline, and a restore drill.

The backend and client were complete and green (976 tests, e2e 16/16) and
entirely unobservable: nothing logged, nothing counted, no headers, no deploy,
no backup. Two ADRs came out of it — 0017 (security headers) and 0018 (backups
drilled in CI) — and one long-accepted ADR finally got built (0014).

## The fixture that made three tests pass for the wrong reason

`app.fixture.ts` stubs `hashToken` as `` `hash:${token}` ``. That is a fine
stand-in for a lookup key and a **terrible** one for anything whose security is a
property of the hash, because it echoes its input.

It bit three times in one session:

1. The "no token in any log line" test failed, correctly-looking, because the
   logged `player.key` was `hash:tok-2<NUL>p` — a 12-character slice of a
   "hash" that starts with the token.
2. The client-error dedup test failed the other way: 50 distinct stacks all
   produced the same 32-character fingerprint, because the stand-in's shared
   prefix (`hash:["TypeError: cannot read prope`) is longer than the slice.
3. Neither failure was a bug in the code under test.

The fix is to inject the **real** `sha256Hex` in the tests where the hash's
behaviour *is* the thing being tested, and say so in a comment. The general rule:
a double may stand in for a value, but not for a property you are asserting.

## `waitUntil` in the fixture was a no-op, so deferred writes were invisible

`server/app.fixture.ts` had `waitUntil: () => {}`. That is faithful to a Worker
that discards the promise and useless as a test harness: every deferred write —
`touchPlayer` before this session, the ADR 0014 counters now — vanished silently,
so "the handler forgot to write" and "the handler correctly deferred" produced
identical, passing tests.

The fixture now collects the promises and `send()` drains them before returning.
No existing test changed behaviour, which was the worry.

## Three things that would have been logged and must not be

The brief called two of them; the third came out of writing the code.

1. **The path.** `POST /api/games/:gameId/result` — and the game id *is* the
   single-use submit token (ADR 0016). Logging `url.pathname`, which is the
   obvious ECS-shaped thing to do, logs a bearer credential on every submission.
   The log carries the matched **route pattern**, which meant `server/router.ts`
   had to start reporting which pattern matched.
2. **The headers.** The failure that actually happens is a debugging
   `console.log({headers: [...request.headers]})`. `tests/logging.node.test.ts`
   fails the build on five spellings of that, anywhere in `server/**`, and has a
   test that the patterns catch the planted forms — a guard whose patterns match
   nothing is not a guard.
3. **A 404's path.** An unrouted request's path is attacker-chosen; echoing it
   into a structured field puts somebody else's payload in the log store. It logs
   the constant `(unrouted)`.

The header guard's first draft also had a false positive worth recording: the
pattern `of\s+[\w.]*headers` matched `for (const … of LOGGED_HEADERS)` in the very
file that defines the allow-list. Requiring the `headers` token to start after a
dot or a space (`of\s+(?:\w+\.)*headers`) fixes it. Guards that scan source need
tests for what they must *not* match, and this file has one.

## The counters diverge from ADR 0014's DDL, additively

`round_stats` gained `memorize_ms` in its primary key. ADR 0014's sketch does not
have it, and ADR 0014 also says the table is "additive-only, versioned", which is
the licence to add it.

The reason: `decodeStartGame` refuses any tier but `normal` (ADR 0015 § 5), so
`difficulty` is a constant in v1 and the memorize window is the *only* difficulty
knob a player can actually move (SPEC §8). Without the column, "does the memorize
setting change anything" is not merely hard to answer later — it is impossible,
which is exactly the cost ADR 0014 warns about.

## What ADR 0014 asks for and the server cannot see

`game_restarted` is on ADR 0014's list of game events. It is not implementable
server-side as the client stands: `RESTART` is a client event, and `src/main.ts`
only calls `prepareRanked` at boot and after a submission, so a restarted game is
played **unranked** and produces no request at all. The same design makes
`started` count mints rather than plays, so the completion rate is a lower bound.

Both are recorded in `BACKLOG.md` rather than papered over with a number that
would read as a measurement. `game_stats.event` is TEXT so adding the event later
is a value, not a migration.

## The restore drill catches three distinct faults, and was checked to

Written, then deliberately broken three ways against the fixture dump:

| Corruption | Caught by |
|---|---|
| A player row removed (orphaning a game) | the load itself — `FOREIGN KEY constraint failed` |
| A `round_stats` row removed | the row-count comparison |
| A `best_score` changed from 388 to 999 | the leaderboard checksum |

The third is the one that matters, because it loads cleanly and has the right
row counts. It is the reason the manifest is taken from the **live** database
before the export rather than computed from the dump afterwards — a manifest
derived from the dump would agree with the dump by construction.

## The bug that only `wrangler pages dev` could find

`makeLogPepper()` minted its pepper eagerly, in the same shape as `makeDailySalt`
but without the laziness. `productionDeps` is a module-scope object literal, so
that `crypto.getRandomValues` ran at **global scope** — which the Workers runtime
refuses outright:

```
Uncaught Error: Disallowed operation called within global scope. Asynchronous I/O
(ex: fetch() or connect()), setting a timeout, and generating random values are
not allowed within global scope.
  at randomToken … at makeLogPepper
```

The Worker would not boot. Every one of the 1116 unit tests passed, because
vitest runs on Node where global-scope randomness is ordinary, and the fixture
injects its own `logPepper` anyway. `npm run e2e` passed too, because it runs
against `vite dev`, which never loads `functions/`.

`makeDailySalt` was already lazy and the comment did not say why. It does now.
**Anything in `productionDeps` that reaches for randomness, a clock or I/O has to
be lazy**, and nothing in the test suite can tell you that.

## Running the real stack, which is how the above was found

```sh
npm run build
npx wrangler pages dev --port 8788      # Functions + local D1 + public/_headers
```

Then the full e2e suite against it, which exercises the *live* CSP rather than
`vite dev`'s absence of one — a throwaway Playwright config with
`use.baseURL: "http://localhost:8788"`, no `webServer`, and the same two
projects. All 16 passed. Separately, a Playwright script that listens for
`securitypolicyviolation` reported none, and both `fetch` and
`navigator.sendBeacon` to `/api/client-error` were allowed by `connect-src`.

The throwaway config is not committed: a second Playwright config is a second
thing to keep current. The recipe is here instead, and it is worth reaching for
whenever something touches `functions/`, `public/_headers`, or `productionDeps`.

## Verified rather than assumed

- **`npm ci --ignore-scripts` works for this tree.** Two packages have
  `postinstall` hooks (esbuild, workerd) and both only validate a platform binary
  npm has already placed via an optional dependency. Checked by installing the
  lockfile into a temp directory with the flag and then running esbuild's
  transform, `wrangler --version`, and the whole restore drill (which starts
  workerd) from it.
- **The five SQL queries in `OPERATIONS.md` were executed** against a seeded local
  D1, not written from memory. The percentile idiom — a running `SUM(SUM(n)) OVER
  (…)` over the histogram — needs SQLite's window functions and works.
- **The `_headers` file ships.** Vite copies `public/` into `dist/`, and
  `wrangler.toml` points Pages at `dist`, so no build step was needed. Confirmed
  by building and listing `dist/`.
- **The built page still has no inline script**, which is what lets
  `script-src 'self'` carry no nonce. Vite's module-preload polyfill goes into the
  entry chunk, not into a `<script>` tag.

## Still not done, and it needs credentials

Nothing has run against a real Cloudflare account. `wrangler d1 create colors`
has not been run, `database_id` in `wrangler.toml` is still the placeholder, and
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` do not exist. Therefore:

- the deploy job has never executed,
- `d1 migrations apply --remote` has never executed,
- the weekly backup job has never executed.

All three are written and none is verified end to end. The parts that *can* run
without credentials do run, on every push: the fixture restore drill and
`migrations apply --local`.
