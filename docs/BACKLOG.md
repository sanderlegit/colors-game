# Delivery plan

Sliced so that each item is independently verifiable, has an explicit contract
from `docs/ARCHITECTURE.md`, and can be handed to a separate agent without
coordination. Dependencies are noted; anything at the same depth can run in
parallel.

Every item's exit criteria include `npm run verify` green.

## Phase 0 — foundation ✅

| # | Item | Exit criteria |
|---|------|---------------|
| 0.1 | Toolchain scaffold: TS strict, Vite, Vitest, Biome, Playwright, CI, git | `npm run verify` passes on an empty project |
| 0.2 | Spec, architecture, ADRs, agent working agreement | This directory + `CLAUDE.md` |
| 0.3 | Color-science research: metric, curve, conversion math, test vectors | `docs/research/*.md` with cited values |
| 0.4 | Purity guard test | `tests/purity.node.test.ts` fails on a planted violation |

## Phase 1 — the pure core ✅

| # | Item | Depends | Exit criteria |
|---|------|---------|---------------|
| 1.1 | `src/color/convert.ts` — sRGB↔linear↔XYZ↔Lab, linear↔OKLab↔OKLCh | 0.3 | Matches cited reference values; round-trip property tests pass |
| 1.2 | `src/color/deltaE.ts` — CIEDE2000 + OKLab ΔE | 1.1 | Passes the published CIEDE2000 test set, including the hue-wraparound pairs |
| 1.3 | `src/color/gamut.ts` — in-gamut test, chroma reduction at constant L/h | 1.1 | Property test: output always in gamut, hue preserved within ε |
| 1.4 | `src/color/format.ts` — hex parse/format, CSS strings | 1.1 | Round-trip + malformed-input tests |
| 1.5 | `src/domain/rng.ts` — seeded PRNG, explicit state | — | Same seed ⇒ identical sequence; distribution sanity check |
| 1.6 | `src/domain/round.ts` — target generation per difficulty tier | 1.3, 1.5 | Pure in (seed, index); 10k samples all in gamut and inside tier bounds |
| 1.7 | `src/domain/scoring.ts` — ΔE → 0..100 curve | 1.2 | Invariants: identity=100, bounded, monotonic, symmetric |
| 1.8 | `src/domain/state.ts` — `reduce`, total, timer transition in-domain | 1.6, 1.7 | Every (phase × event) pair covered incl. illegal ones; 5s transition tested with two timestamps, no waiting |

## Phase 2 — the shell ✅

| # | Item | Depends | Exit criteria |
|---|------|---------|---------------|
| 2.1 | `src/platform/*` — rAF clock, storage, seed source | 1.8 | Adapters swappable; in-memory doubles used in tests |
| 2.2 | `src/ui/swatch.ts` — the shared grid cell + dissolve | 1.8 | Both layers share one grid cell; reduced-motion path collapses duration to 0 |
| 2.3 | `src/ui/picker.ts` — canvas plane + bar, pointer + keyboard | 2.2 | Pointer capture works for mouse/touch/pen; arrow keys nudge; plane repaints only on lightness change (ADR 0007) |
| 2.4 | `src/ui/preview.ts` — live guess + numeric readout | 1.8 | Updates during drag |
| 2.5 | `src/ui/hud.ts` — countdown, round counter, confirm | 1.8 | Confirm disabled until first move |
| 2.6 | `src/ui/reveal.ts` — target vs guess, ΔE, score | 1.7 | Shows raw ΔE alongside score |
| 2.7 | `src/ui/render.ts` + `src/main.ts` — composition root, frame loop | 2.1–2.6 | One-way data flow; no layout reads inside `update` |
| 2.8 | Responsive layout + safe-area + touch loupe | 2.3 | Swatch and preview both visible at iPhone 14 portrait without scrolling |

## Phase 3 — proving it

| # | Item | Status |
|---|------|--------|
| 3.1 | E2E geometry assertion | ✅ Green on both projects. Caught a real bug — see below. |
| 3.2 | E2E happy path + no-target-in-DOM | ✅ Full round plays through on both projects. |
| 3.3 | Keyboard-only playthrough, visible focus, reduced motion | ⚠️ **Partly done.** `e2e/leaderboard.spec.ts` drives the tablist entirely from the keyboard — Tab reaches it, the arrows wrap, Home/End jump, focus stays in the bar on a keyboard switch and Escape returns to Play. The *round itself* (arrow-nudging the picker, Enter to confirm) is still only unit-tested and still needs a manual pass, as does reduced motion. |
| 3.6 | E2E for the tab bar, the board and setting a username | ✅ `e2e/leaderboard.spec.ts`, 10 assertions × both projects, `/api` stubbed with `page.route`. Includes ADR 0013's named tripwire, the empty and failed boards, the retry, setting a username (ADR 0024 — names are not unique, so no collision line), and a full round played with every API call aborted. |
| 3.7 | E2E against a real Worker and a real D1 | ✅ `e2e/backend.spec.ts` + `playwright.backend.config.ts`, wired into CI as `e2e-backend`. Closes the `server/db/d1.ts` coverage gap below. |
| 3.8 | ADR 0016's four-engine replay gate | ✅ happy-dom and Node in vitest; Chromium in `e2e/replay-vectors.spec.ts`; workerd in `e2e/replay-workerd.spec.ts` via a `DEBUG_REPLAY`-gated route in the deployed bundle. All four assert the same 153 literals with `!==`, never a tolerance. |
| 3.4 | Real-device pass on the real stack | ⬜ **Not done — but no longer blocked.** Still needs a physical iPhone; the loupe and take-off selection cannot be validated in an emulated viewport. The route is now `just serve` + `just tailnet` (`OPERATIONS.md` § 5). **Not over a LAN address**, which was the original plan here: the identity cookie is `Secure`, so a plain-HTTP origin silently drops it and the name claim never sticks (ADR 0020). The transport is proven — `e2e/backend.spec.ts` played a full game and claimed a name against the tailnet URL at the iPhone 14 viewport — so what remains is genuinely the human judgement. |
| 3.5 | Perf budget: bundle ≤30KB gz, repaint ≤4ms @2× | ⚠️ Bundle ✅ **10.0 KB gz** JS (+2.8 KB gz CSS). Repaint ❌ **11ms** final / 6.7ms draft at 800×700 — over the 4ms budget. |

### What 3.1 caught

The geometry assertion found a defect that no unit test could: at iPhone width the
HUD reflowed between `memorize` and `picking` (44px → 73px as the confirm button
appeared and wrapped), pushing the stage down ~15px. The picker and swatch were
pixel-identical to each other the whole time — the *page* moved underneath them,
so the rect the player memorized was not the rect the picker appeared in.

Fixed by reserving the HUD's box at its tallest arrangement. The spec now asserts
both guarantees separately: picker-vs-swatch (holds by construction) and
memorized-rect-vs-picker (does not, and needs the test).

## Phase 4 — the backend (ADR 0016)

| # | Item | Depends | Status |
|---|------|---------|--------|
| 4.1 | `src/platform/api.ts` — the GameApi port and its fetch adapter | — | ✅ |
| 4.2 | Scaffold: router, ports, Repo + memory double, migration, wrangler config | 4.1 | ✅ `server/` exists, `verify` green |
| 4.3 | Request handlers — the nine endpoints in `server/handlers/**` | 4.2 | ✅ All implemented against `memoryRepo()` and real `Request`s; anti-abuse policy in ADR 0015 |
| 4.4 | Wire the client to the API: ranked play, name claim, board UI | 4.3 | ✅ `shell.ts`, `tabs.ts`, `leaderboard.ts`, `identity.ts`; every `await` in `main.ts` (ADR 0012). Bundle 13.9 KB gz. |
| 4.5 | Deploy: create the D1 database, apply migrations, fill `database_id` | 4.3 | ⬜ **Blocked on an account and a domain.** Nine-step runbook in `OPERATIONS.md` § 3 First-time setup. The pipeline exists (`ci.yml` § deploy, gated `d1 migrations apply --remote`); nobody has run `wrangler d1 create colors` or set the secrets, so nothing has touched a **remote** D1. The *local* one is exercised on every push by `npm run e2e:backend` (3.7) — the SQL is proven, only the account is missing. |
| 4.6 | Custom domain + canonical host | 4.5 | ⬜ **Code is done** (ADR 0021, `server/http/canonical.ts`); needs the `routes` block added to `wrangler.toml` and `wrangler secret put CANONICAL_HOST` once the hostname exists. Less urgent since ADR 0022: `workers_dev = false` means there is no second hostname to leak identities to in the meantime. |
| 4.7 | Migrate Pages → Workers with static assets (ADR 0022) | — | ✅ `server/index.ts`, `[assets]`, `[observability]`, `wrangler deploy` in CI. **Nothing has been deployed** — every check below the line is local. |

## Phase 5 — operating it

| # | Item | Depends | Status |
|---|------|---------|--------|
| 5.1 | Structured logging: one wide event per request, allow-listed headers, no token | 4.3 | ✅ `server/log.ts`; guarded by `server/log.test.ts` + `tests/logging.node.test.ts` |
| 5.2 | ADR 0014's counters: `round_stats`, `game_stats`, migration 0002 | 4.3 | ✅ Written from the submit and start handlers; SQL in `OPERATIONS.md` § 2 |
| 5.3 | `/api/client-error` + the client beacon, deduplicated and rate-limited | 5.1 | ✅ 30-day retention, enforced by the write *and* by the daily sweep since ADR 0023 — the write-side purge bounds new rows only, so old ones survive once reports stop |
| 5.4 | Security headers and a strict CSP, on the Worker and on the static assets (ADR 0017) | — | ✅ Two copies, compared by `tests/csp.node.test.ts`. `public/_headers` is applied natively by Workers static assets and shipped unchanged by ADR 0022 |
| 5.5 | Deploy pipeline with a gated `d1 migrations apply --remote`; Dependabot | — | ✅ In `ci.yml`. **Never executed** — see 4.5 |
| 5.6 | Weekly export + a restore drill that runs on every push (ADR 0018) | — | ✅ `scripts/restore-drill.mjs`; the weekly half needs 4.5's secrets |
| 5.7 | The data-retention sweep as a Cron Trigger (ADR 0023) | 4.7 | ✅ `server/sweep.ts` + `scheduled` in `server/index.ts`, `[triggers] crons = ["17 4 * * *"]`. Four bounded passes through the `Repo` port, one wide `retention_swept` event. Exercised against a real Worker and a real local D1 via `wrangler dev --test-scheduled`. **Names idle 12 months are deliberately not released** — ADR 0023 says why |

### Known gaps

- **Repaint budget missed** (3.5). The floor is the per-pixel buffer fill, not the
  colour sampling; getting under 4ms would need a gamma LUT plus lattice
  interpolation. Measure on real hardware before optimising — 11ms only occurs on
  **lightness** change (ADR 0007), never during a plane drag.
- **Difficulty tiers are unreachable.** `generateTarget` accepts a `Difficulty`,
  but `createReducer` calls `deps.target(seed, roundIndex)`, so every game plays
  `normal`. Wiring it needs a field on `Settings` and a control in the menu.
- **`src/platform/seed.ts` has no tests** (0% coverage). The platform layer has no
  floor, but this is a real gap rather than a decision.
- **Settings UI does not exist.** SPEC §8 promises a 3s/5s/8s memorize choice;
  storage and the reducer both support it, nothing surfaces it.
- **`main.ts`'s async orchestrators are covered from e2e, not from unit tests.**
  ADR 0012 puts every `await` in the composition root, and `main.ts` is neither
  exported nor importable without running `main()`. `e2e/leaderboard.spec.ts` now
  drives `loadBoard`, `submitGame`, `claimName` and the offline fallback through
  the browser, which was the second of the two ways out named here; the first —
  injecting the deps into an exported `run()` — is still open, and `forget()` is
  still unreached by anything.
- **~~`e2e/` does not cover the tab bar, the board or the name claim.~~** Closed
  by 3.6. ADR 0013's tripwire (`.tabs` hidden during `picking`) exists, and the
  specs are written against `.game` as a tabpanel.
- **The ranked game is minted ahead of the click and can go stale.** `nextSeed`
  is synchronous, so `POST /api/games` is fired at boot and again after each
  submission. A player who leaves the summary open for over 30 minutes and then
  hits Play again submits against a row past its TTL and gets a 410 rendered as
  the failure message. The fix is to re-mint on a staleness check, which needs
  the row's issue time on the client.
- **The board refetches on every visit to the tab.** One request per tab click,
  deliberately, so the board is never stale after your own submission. If that
  ever shows up in the rate limiter, cache it with a short TTL in `main.ts`.

Platform gaps, opened by ADR 0022 and closable only with an account:

- **Nothing in the Workers migration has been deployed.** Everything below was
  verified against `wrangler dev` with a local D1: `/api/health`, `/api/health/deep`,
  the same-origin 201 / cross-origin 403 pair, the security headers on both an
  asset and an API response, the gated debug route, and `dist/_headers` being
  parsed. **Unverified anywhere:** that `wrangler deploy` succeeds with
  `workers_dev = false` and no `routes`, that `wrangler secret put CANONICAL_HOST`
  is invisible to the deployed Worker's `wrangler dev` sessions (the local half is
  verified — no var of that name exists in a dev binding list), that
  `[observability]` actually produces log events in the dashboard, and that the
  `routes`/`custom_domain` block creates the DNS record. See `OPERATIONS.md` § 3.
- **~~The retention sweep is still probabilistic-on-write.~~** Closed by ADR 0023,
  and the description was **wrong**: there was never a probabilistic sweep. ADR
  0022 named one as the thing being replaced, but nothing was ever written —
  `grep` finds no `Math.random` in `server/**` and no purge on any write path but
  the client-error one. The cron ADR 0022 moved the platform for now exists
  (`server/sweep.ts`, `[triggers]` in `wrangler.toml`). **Unverified in
  production:** that Cloudflare actually fires the trigger on the deployed Worker.
  The only evidence will be a `retention_swept` line — `OPERATIONS.md` § 6.2.
- **`wrangler secret put` now exists as a mechanism**, which makes the mint-salt
  gap below cheaper than it was: `makeDailySalt()` is per isolate only because
  there was no secret binding, and there is one now.

Backend gaps. Three of the 4.2 scaffold's are now closed by 4.3 and ADR 0015:
`games.player_id` is attached at mint when a cookie is present, the rate limits
exist, and `games.flags` has two defined bits. What is left:

- **The mint bucket's daily salt is per isolate** (ADR 0015). `makeDailySalt()`
  mints it in the Worker because there is no secret binding, so the ceilings are a
  coarse brake rather than a quota — a caller spread across isolates gets a
  multiple of them. Fix: bind a secret and return it from `productionDeps.mintSalt`.
  No caller changes.
- **Off Cloudflare there is no `CF-Connecting-IP`,** so every caller shares one
  bucket. `wrangler dev` will therefore refuse to mint a 31st identity in a
  day. Over-counting locally is the safe direction, but it will look like a bug
  the first time somebody hits it. `npm run e2e:backend` wipes
  `.wrangler/state/v3/d1` before every run for this reason among others —
  `mint_buckets` accumulates with everything else.
- **~~Nothing writes the ADR 0014 telemetry counters.~~** Closed by 5.2.
  `round_stats` and `game_stats` are written from the submit and start handlers
  behind `waitUntil`, and `OPERATIONS.md` § 2.3 is the query ADR 0008 asked for.
  Nothing has been measured yet — there is now something to measure.
- **`game_restarted` is not counted, and cannot be from the server.** ADR 0014
  lists it as a game event, but a restart is a client-side `RESTART` that consumes
  no server round trip — worse, `src/main.ts` only calls `prepareRanked` at boot
  and after a submission, so a restarted game is played *unranked* and the server
  never hears about it at all. Counting it needs either a client beacon (a second
  unauthenticated write endpoint) or re-minting on `RESTART`, which is the fix the
  ranked-game staleness gap below also wants. `game_stats.event` is TEXT precisely
  so adding it later is a value, not a migration.
- **`started` counts mints, not plays**, because the ranked game is minted ahead
  of the click. The completion rate in `OPERATIONS.md` § 2.5 is therefore a lower
  bound, understated by about one game per session. Same root cause as the
  staleness gap below; fixing that fixes this.
- **~~Nothing purges `mint_buckets`.~~** Closed by ADR 0023. The daily sweep
  deletes every row for a day that is over, bounded at 500 a run. This was a
  privacy gap rather than a disk one — they are the only per-IP-derived rows in
  the system and ADR 0015 justifies them partly on being short-lived.
- **The board tiebreak is name, not "first to achieve".** `players` stores no
  timestamp for the best game, only `best_game_id`, and `players_board` is
  `(best_score DESC, name)`. A `finished_at` tiebreak would need a join on every
  rank query and would disagree with the index. To change it, add
  `best_finished_at` to `players` and update the index, `topPlayers` and
  `countPlayersAbove` in one commit. See `server/db/repo.ts`.
- **No name-change policy exists.** `players.name_changes` and `name_changed_at`
  are written on every claim and nothing reads them, so a player can rename as
  often as they like. ADR 0015 decided the mint and start limits and deliberately
  left this one open.
- **~~Nothing sweeps stale `active` games.~~** Closed by ADR 0023. The daily cron
  moves them to `expired`, so `games_sweep` finally has a reader and the status is
  reachable. Nothing in the request path changed — a stale submission is still 410
  from `started_at`, not from the status. The `players` half of ADR 0011 is closed
  for `games_played = 0` and deliberately **open** for the name release, below.
- **Names idle over 12 months are not released, on purpose.** ADR 0011 asks for
  it; ADR 0023 § Why the name release is not here declines to build it and states
  the precondition. `last_seen_at` moves only via `touchPlayer`, which runs inside
  `waitUntil` on `GET /api/me` and has never been proven to write against a real
  D1 (see the `d1.ts` coverage gap below — a SQL error there is swallowed and
  every test stays green). If it silently fails, every `last_seen_at` is frozen at
  `created_at` and the first run would release **every name in the database**.
  `claimName` does not touch the column either, and the release semantics —
  `NULL`ing `name`/`name_key` silently drops a row out of the partial
  `players_board` index while leaving the score, the games and a working cookie —
  are undecided. Nothing can be 12 months idle before 2027-08-01. Order of work:
  prove `touchPlayer` writes, then write the ADR, then build it.
- **The scheduled handler has no automated coverage of its SQL.** `server/sweep.ts`
  is unit-tested against `memoryRepo()` (22 cases, including the negative ones and
  the `LIMIT` bound), and the four passes were executed against a real local D1 by
  hand through `wrangler dev --test-scheduled` with the rows read back — but
  `npm run e2e:backend` never calls `/__scheduled`, so a schema change could break
  a statement in `d1.ts` and every test would stay green. Same shape as the
  `touchPlayer` gap. Closing it is one spec in `playwright.backend.config.ts` that
  seeds rows, hits `/__scheduled`, and reads the counts back.
- **~~`games.flags` is set but never read back.~~** Partly closed by 5.2: a
  flagged submission now increments `game_stats(event = 'flagged')`, so ADR 0015's
  "expect approximately zero" has a number (`OPERATIONS.md` § 2.5). The *429 rate*
  ADR 0015 also asks for is still only in the 3-day log stream, not in a counter —
  if it matters beyond a debugging window, it needs a bucket.
- **The logged `player.key` pepper is per isolate**, like the mint salt, so
  grouping one player's requests works within an isolate and not across them. The
  fix is the same one: bind a secret and return it from `productionDeps.logPepper`.
- **Nothing has been deployed, so `server/db/d1.ts`'s new SQL is unproven at
  scale.** The `round_stats` / `game_stats` / `client_errors` statements were each
  executed against a real local D1 by hand, and the migration applies cleanly —
  but no `waitUntil` write has ever raced another on the real thing, and
  miniflare's single-process SQLite cannot produce that race either.
- **~~`server/db/d1.ts` has no automated coverage.~~** Mostly closed by 3.7.
  `e2e/backend.spec.ts` executes `insertGame`, `findGame`, `finishGame`,
  `insertPlayer`, `findPlayerByTokenHash`, `bumpMintBucket`,
  `countGamesStartedSince`, `recordFinishedGame`, `claimName`, `topPlayers` and
  `countPlayersAbove` against a real binding on every push, and asserts on values
  that came back through them. Two caveats worth knowing:
  - `touchPlayer` and `recordTelemetry` run *inside* `waitUntil`. They execute,
    but nothing reads their result, so a SQL error in either would be swallowed
    by the runtime and the spec would still be green. Catching those needs a
    second request that reads `last_seen_at` or `round_stats` back.
  - `deletePlayer` (the forget flow) and `recordClientError` are still executed by
    nothing at all.

  It stays excluded from the 90% floor: that floor is a vitest number and this is
  not vitest.
<!-- The "reveal card can occlude the picker on a short phone" gap that stood here
     was CLOSED by ADR 0010, which deleted the floating card entirely. Removed
     rather than struck through because SPEC §11 tells agents that BACKLOG wins
     when it disagrees with SPEC — a stale gap here is trusted over the truth. -->


## Deliberately deferred

Daily challenge (seeds already support it), share cards, leaderboard + server-side
target generation, sound, PWA offline install, difficulty progression tuning based
on real score distributions.

## Risk register

| Risk | Mitigation |
|------|------------|
| CIEDE2000 implemented subtly wrong; scores feel arbitrary | Test against the published Sharma/Wu/Dalal vectors, which are designed to catch exactly these bugs |
| Scoring curve feels punishing; near-misses read as failures | Curve is a single pure function with a tuning table; playtest and adjust without touching anything else |
| Picker unusable on touch due to finger occlusion | Loupe offset above contact point; e2e at real mobile viewport from day one, not at the end |
| Dissolve geometry drifts as layout changes | Shared grid cell makes it correct by construction; e2e asserts it anyway |
| Scope creep into a framework rewrite | ADR 0001; any dependency needs an ADR |
