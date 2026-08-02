# 0008 — E2E for the board, and the last two engines of the replay gate

2026-08-02 · The tab bar, the leaderboard and the name claim get e2e coverage;
`server/db/d1.ts` gets executed by something other than a person; ADR 0016's
four-engine claim becomes four actual checks.

Going in: `npm run verify` green at 1118 tests, `npm run e2e` green at 16/16, and
three things that were written down as guarantees and enforced by nothing —
ADR 0013's tripwire, ADR 0016's "every JS engine agrees", and every SQL statement
in the repo.

Coming out: verify 1120, `npm run e2e` 38/38 across both projects, and a second
Playwright config, `npm run e2e:backend`, at 2/2 against a real Worker and a real
D1. No new dependencies; wrangler was already one.

## What got built

- **`e2e/leaderboard.spec.ts`** — ten assertions, both viewports, `/api` stubbed
  with `page.route`. Interception rather than a backend because these are UI
  claims: they need no wrangler in CI and they let a 500, an empty board and a
  name collision be injected exactly, which no real server will do on request.
  The two that carry the most weight are ADR 0013's named tripwire (`.tabs` is
  `hidden` during `picking`) and a full round played with **every** `/api` call
  `route.abort()`ed, which is the executable form of the promise the whole
  seed-replay design was chosen to keep.
- **`e2e/backend.spec.ts`** + `playwright.backend.config.ts` — one start → submit
  → claim → board round trip against `wrangler pages dev` over miniflare's
  SQLite. It ends by asserting that the score on the board is *exactly* the total
  the summary screen showed, which is ADR 0016's entire claim in one line: both
  are `Math.round` of the same sum of the same pure `scoreGuess` calls, so
  anything but equality means the two engines disagreed about a target.
- **`e2e/replay-vectors.spec.ts`** (Chromium) and **`e2e/replay-workerd.spec.ts`**
  (workerd, via a `DEBUG_REPLAY`-gated Pages Function). With the two vitest
  projects that is four engines against the same 153 literals, all with `!==`.
  All four passed first time, which is the outcome the ADR predicted and not
  evidence the checks are pointless — they are cheap and they fire on a refactor,
  which is when it matters.

## Playwright's `testDir` does not care which config you meant

The first full `npm run e2e` after adding the backend specs was 38 passed, 4
failed. `playwright.config.ts` has `testDir: "./e2e"` and the default
`testMatch`, so it happily collected `backend.spec.ts` and
`replay-workerd.spec.ts` and ran them — twice, once per project — against a Vite
dev server that serves no Functions and has no database. Two configs sharing a
directory need the *first* one to say `testIgnore`; the second one's `testMatch`
does nothing to protect it.

The failure is loud and obvious once seen (`ECONNREFUSED ::1:8788`), but it is
worth recording because the instinct is to fix the *new* config.

## `changeOrigin: false` is the whole reason the proxy is there

The browser has to see one origin. Vite serves the app and forwards `/api` to
`wrangler pages dev`, and with `changeOrigin: false` the `Host` header still
names the Vite origin — so workerd builds `request.url` from it and
`server/http/origin.ts` compares the browser's `Origin` against the same value.
Flip it to `true`, or point the browser straight at two origins, and the
`SameSite=Strict`, host-only identity cookie stops being sent, every POST 403s,
and local dev diverges from production in precisely the place that matters.

This did not bite — it was got right first — but it is the kind of thing that is
invisible until it is a production incident, so it is written down in three
places now: `vite.config.ts`, `OPERATIONS.md` and here.

## The debug route, and why it is allowed to ship

`functions/debug/replay-vectors.ts` runs the vectors *inside the deployed
bundle* — same esbuild pass, same module resolution — which is a materially
stronger claim than a throwaway Worker would make. The price is a file in
`functions/`, which deploys.

It is inert unless `env.DEBUG_REPLAY === "1"`. That value is supplied by
`wrangler pages dev --binding DEBUG_REPLAY=1` from the Playwright config and by
nothing else: deliberately **not** by `wrangler.toml`, because a value there is a
value that deploys. It is declared in a hand-written `functions/env.d.ts` rather
than regenerated into `worker-configuration.d.ts` for the same reason.
`tests/debug-flag.node.test.ts` fails the build if the flag ever appears in
`wrangler.toml`, or if a second route under `functions/debug/` forgets to read
it. Verified by hand: without the binding, the route is a 404.

## The 28-second floor

`server/limits.ts` refuses a submission that arrives sooner than
`rounds × memorizeMs + rounds × 600ms` — 28 seconds at the default settings —
measured from the mint, which `src/main.ts` performs at page load. Playing five
rounds honestly takes about 29.5s. That is a ~1.5s margin, which is not a margin.
`backend.spec.ts` therefore waits 2s after `goto` and before pressing Play; the
wait is *before* the game rather than during it precisely because the clock the
server checks starts at the mint.

Slower CI is the safe direction here — it can only increase elapsed time — which
is why the backend config runs with `retries: 0`. A retry would be the real
hazard: it would meet the `players` row the first attempt inserted, and the
deterministic name claim would come back suffixed.
