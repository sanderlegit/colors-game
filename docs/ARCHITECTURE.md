# Architecture

Status: draft v1 · Last updated: 2026-08-01

## The shape: functional core, imperative shell

```
                    ┌──────────────────────────────────────────┐
   DOM events ──▶   │  src/ui/**        imperative shell       │
   rAF ticks  ──▶   │  owns nodes, listeners, rendering        │
                    └───────────────┬──────────────────────────┘
                                    │  Event
                                    ▼
                    ┌──────────────────────────────────────────┐
                    │  src/domain/**    PURE                    │
                    │  reduce(state, event) -> state            │
                    │  scoring, round generation, seeded rng    │
                    └───────────────┬──────────────────────────┘
                                    │
                                    ▼
                    ┌──────────────────────────────────────────┐
                    │  src/color/**     PURE                    │
                    │  conversions, ΔE, gamut mapping           │
                    └──────────────────────────────────────────┘

   src/platform/**   adapters: rAF clock, localStorage, seed source
   src/main.ts       composition root — the only file that wires ports to adapters
```

**The rule that makes this worth it:** `src/domain/**` and `src/color/**` may not
import from `src/ui/**` or `src/platform/**`, and may not touch `document`,
`window`, `Date`, `performance`, or `Math.random`. Time and randomness arrive as
values. Everything interesting is therefore testable in milliseconds without a
browser, and every test is deterministic.

This is enforced by lint config and by a guard test, not by good intentions.

## Directory layout

```
src/
  color/
    types.ts          Srgb, LinearRgb, Xyz, Lab, Oklab, Oklch — branded/nominal
    convert.ts        the conversion chain, one function per hop
    deltaE.ts         ciede2000(), ciede2000Components(), deltaEOk()
    gamut.ts          isInGamut(), clipChromaToGamut()
    format.ts         hex parse/format, css color string
    *.test.ts
  domain/
    rng.ts            Rng port + mulberry32 impl (pure, explicit state)
    round.ts          generateTarget(seed, roundIndex, difficulty)
    scoring.ts        scoreGuess(target, guess) -> { deltaE, score }
    state.ts          GameState, Event, reduce(), initialState()
    selectors.ts      derived view data (countdown remaining, totals)
    *.test.ts
  ui/
    swatch.ts         the shared rect: color fill layer + picker layer + dissolve
                      (keeps the picker visible through reveal, ADR 0009)
    picker.ts         hue x chroma plane (canvas) + lightness bar (ADR 0007);
                      reveal-only target reticle + guess-to-target gap (ADR 0009)
    status.ts         the top row: round counter + running total (ADR 0026)
    action.ts         the bottom phase action bar (ADR 0026): countdown while
                      memorizing, Confirm while picking, Next round on reveal —
                      one reserved slot, in the thumb zone. Split out of hud.ts
    reveal.ts         the persistent side panel (ADR 0010): live guess while
                      picking, then ΔE, score, your-vs-target coords. Numbers
                      stack above the guess/target chips, which sit flush over the
                      picker on phones (ADR 0026). Replaced preview.ts, deleted
    menu.ts           idle + summary screen; owns the identity block's mount slot
    identity.ts       set-username + "Change name" rename form (ADR 0011, 0024, 0025)
    leaderboard.ts    the board. setView(view), never update(state) (ADR 0012)
    tabs.ts           ARIA tablist, roving tabindex, automatic activation
    render.ts         createGameView(root, deps) -> { update(state), … }
    shell.ts          owns activeTab above createGameView; pushes async data in
    *.test.ts
  platform/
    clock.ts          rAF-driven ticker -> emits TICK with monotonic ms
    storage.ts        localStorage adapter behind Storage port
    seed.ts           crypto.getRandomValues -> initial seed
    api.ts            same-origin fetch behind the GameApi port
    errors.ts         window.onerror / unhandledrejection -> /api/client-error
  shared/
    decode.ts         narrowing primitives for untrusted JSON — client and server
  main.ts             composition root
  styles.css
server/               the backend (ADR 0016, ADR 0022) — see § The backend
  index.ts            the Worker entry: a fetch handler onto server/app.ts, and
                      a scheduled handler onto server/sweep.ts
  sweep.ts            the daily retention sweep (ADR 0023), fired by [triggers]
  debug/              routes inert unless env.DEBUG_REPLAY === "1"; never set in
                      wrangler.toml, guarded by tests/debug-flag.node.test.ts
  env.d.ts            the two Env vars `wrangler types` must not generate
migrations/           D1 schema, applied with `wrangler d1 migrations apply`
public/_headers       security headers for the static half; Vite copies it into
                      dist/, which is wrangler.toml's `[assets] directory`
scripts/              backup shape, the restore drill, and its fixture dump (ADR 0018)
e2e/
  *.spec.ts           Playwright; see docs/README.md for which config runs which
  support.ts          driving a round, and the page.route API double
  ports.ts            the two origins the real-backend run uses
  browser/            modules the *page* loads, served by vite dev
docs/                 spec, architecture, ADRs, research, operations
```

## Core contracts

These are the interfaces every delegated task builds against. They are stable;
changing one requires updating this file in the same commit.

```ts
// src/color/types.ts — nominal typing so a Lab can never be passed as an Oklab
type Srgb   = { r: number; g: number; b: number };   // 0..1
type Lab    = { L: number; a: number; b: number };   // L 0..100
type Oklab  = { L: number; a: number; b: number };   // L 0..1
type Oklch  = { L: number; c: number; h: number };   // h degrees 0..360

// src/domain/rng.ts — explicit state, no hidden mutation
type Rng = { next(): number; readonly state: number };  // next() in [0,1)
function makeRng(seed: number): Rng;

// src/domain/scoring.ts
type Score = { deltaE: number; score: number };        // score 0..100
function scoreGuess(target: Oklch, guess: Oklch): Score;

// src/domain/state.ts — what a finished round keeps. `guess` is load-bearing:
// main.ts reads it to build the submission body.
type RoundResult = Score & { target: Oklch; guess: Oklch };

// src/domain/state.ts
type Phase = "idle" | "memorize" | "picking" | "reveal" | "summary";
type GameState = {
  phase: Phase;
  seed: number;
  roundIndex: number;
  target: Oklch;
  guess: Oklch;
  hasMoved: boolean;
  phaseStartedAt: number;   // ms, injected — never read from a clock in here
  now: number;              // ms, advanced only by TICK
  results: RoundResult[];
  settings: { memorizeMs: number; reducedMotion: boolean };
};
type Event =
  | { type: "START"; seed: number; at: number }
  | { type: "TICK"; at: number }
  | { type: "PICK"; value: Oklch }
  | { type: "CONFIRM" }
  | { type: "NEXT" }
  | { type: "RESTART"; seed: number; at: number };

// Scoring and target generation are injected rather than imported, so the state
// machine is testable with trivial fakes and carries no dependency on the color
// layer. `reduce` is produced, not exported directly.
type ReducerDeps = { score: ScoreFn; target: TargetFn };
function createReducer(deps: ReducerDeps): (s: GameState, e: Event) => GameState;
```

The reducer is total: every (state, event) pair returns a state, illegal
combinations return the **same object reference** so callers can detect a no-op
without a deep compare. It never throws. It performs the memorize→picking
transition itself when `TICK` pushes elapsed time past `memorizeMs` — the timer
is domain logic, not a `setTimeout` in the UI.

Refinements made during implementation, now binding:

- `GameState` and `results` are deeply `readonly`.
- `TICK` is legal in every phase (it advances `now`), but a stalled or rewound
  clock (`at <= now`) is a no-op. So the no-op set is the illegal (phase × event)
  pairs *plus* non-advancing ticks.
- `RESTART` is legal only from `summary` — there is no mid-game restart, per SPEC §3.
- `pickerStart(seed, roundIndex)` derives the C=0 start position from a
  double-mixed seed, so the picker stream cannot correlate with whatever
  `TargetFn` derives from the same `(seed, roundIndex)`.
- `Rng.state` is a getter on a mutating object: `makeRng(rng.state)` reconstructs
  the generator exactly, so a run is snapshot/resumable from a single number.

## Rendering without a framework

No virtual DOM, no reactivity library. Each UI module is a factory:

```ts
function createPicker(root: HTMLElement, onPick: (c: Oklch) => void): {
  update(state: GameState): void;
  destroy(): void;
};
```

- The factory creates its nodes **once** and keeps references.
- `update(state)` writes only what changed, guarded by a cheap dirty check against
  the previous state slice it cares about.
- `render.ts` calls each component's `update` on every animation frame. Components
  are responsible for being cheap and idempotent.
- One-way data flow: DOM event → `Event` → `reduce` → new state → `update`.

This is ~200 lines of infrastructure total and it removes an entire dependency
class. See `docs/adr/0001-no-ui-framework.md`.

## Where async lives

**Every `await` in `src/**` is in `src/main.ts` or `src/platform/**`. `src/ui/**`
is synchronous** (ADR 0012). Components receive handlers and setters — exactly
the shape `dispatch` and `setBestScore` already had — and the composition root
does the waiting:

```ts
// src/ui/shell.ts, above createGameView; owns exactly one variable, activeTab.
type Shell = {
  update(state: GameState): void;      // the frame loop, unchanged
  setBestScore(score: number): void;
  setLeaderboard(view: LeaderboardView): void;   // pushed when a request settles
  setIdentity(identity: PlayerIdentity): void;
  setSubmission(submission: SubmitState): void;
  destroy(): void;
};
```

The payoff is that every component test is a synchronous call with a literal:
no promise flushing, no fake timers, no `await tick()` in happy-dom.

Two consequences worth stating outright:

- **Boot awaits nothing.** `api.me()` and the first `api.startRanked()` are fired
  and their promises dropped. Identity starts `unknown` and renders nothing.
- **`nextSeed` is synchronous by contract**, because the menu's click handler
  dispatches `START` with it. The ranked game is therefore minted *ahead* of the
  click and consumed by `nextSeed`; when there is none — offline, a failed mint,
  or a race with boot — the game is played unranked with a local seed. A round is
  never delayed on the network.

`.game` **is** the Play tabpanel; there is no wrapper element. A wrapper would
need `display: contents` (dropped from the a11y tree by some engines) and would
perturb the grid the e2e geometry assertions measure.

## The dissolve (the signature interaction)

Both layers live in the **same CSS grid cell**, so the geometry is identical by
construction rather than by matched coordinates:

```
.swatch-stack        (grid, aspect-ratio: 1, border-radius: var(--r))
  ├─ .swatch-fill    (grid-area: 1/1, background: target)
  └─ .picker         (grid-area: 1/1, canvas + cursor overlay)
```

Transition: opacity crossfade over 450ms with `pointer-events` handed to the
picker only after the fade completes (prevents a stray tap landing mid-dissolve).
Under `prefers-reduced-motion: reduce` the duration collapses to 0.

The picker plane is a `<canvas>` painted once per **lightness** change (not per
frame) at device pixel ratio — hue and chroma are the plane's own axes since
ADR 0007, so a drag within the plane repaints nothing. The cursor is a separate
absolutely-positioned DOM element.

## Touch

- `pointerdown/move/up` with `setPointerCapture` — one code path for mouse, touch,
  and pen. No separate touch handlers.
- `touch-action: none` on the picker plane and lightness bar only, so the page still
  scrolls everywhere else.
- **Finger occlusion:** the fingertip covers the pixel being selected. Mitigation
  is a loupe — a circular magnified preview offset above the contact point, shown
  only for touch pointers, which is the iOS-established convention.
- Cursor position is committed on `pointerup`, but `PICK` events stream during the
  drag so the preview panel is live.

## Ports and adapters

| Port      | Real adapter                     | Test double            |
|-----------|----------------------------------|------------------------|
| Clock     | `requestAnimationFrame` loop      | manual `tick(ms)`      |
| Rng       | seeded mulberry32 (already pure)  | fixed seed             |
| Storage   | `localStorage`                    | in-memory map          |
| SeedSource| `crypto.getRandomValues`          | constant               |
| GameApi   | same-origin `fetch` (`api.ts`)    | `api.fixture.ts`       |
| Repo      | D1 (`server/db/d1.ts`)            | `server/db/memory.ts`  |

## The backend

Added by ADR 0016. Read that before changing anything under `server/`.

```
                   ┌──────────────────────────────────────────────┐
 server/index.ts ─▶ │  server/app.ts   composition root            │
   fetch           │  routing · CSRF · failure boundary · repo    │
                   └───────────────┬──────────────────────────────┘
                                   │  RequestContext
                                   ▼
                   ┌──────────────────────────────────────────────┐
                   │  server/handlers/**                          │
                   │  games · submit · me · name · leaderboard    │
                   └──────┬──────────────────────┬────────────────┘
                          │                      │
                          ▼                      │
                   ┌──────────────────────────┐  │
                   │ replay.ts   score a game │  │ imports unmodified
                   │ identity.ts who is this  │  │
                   │ limits.ts   what is fair │  │
                   │ names.ts    land a name  │  │
                   │ decode.ts   narrow input │  │
                   └──────┬───────────────────┘  │
                          │ Repo port            ▼
                          ▼           ┌──────────────────────────┐
                   ┌─────────────┐    │ src/domain/** PURE       │
                   │ db/d1.ts    │    │ src/color/**  PURE       │
                   │ db/memory.ts│    └──────────────────────────┘
                   └─────────────┘
                          ▲
                          │ the same Repo port, four bounded passes
                   ┌──────┴───────────────────────────────────────┐
 server/index.ts ─▶ │  server/sweep.ts   daily retention (ADR 0023)│
   scheduled       │  one wide `retention_swept` event per run     │
                   └──────────────────────────────────────────────┘
```

**The sweep is a second entry point, not a second application.** It shares the
`Repo` port, the clock and the `emit` port with the request path, so its passes
are unit-tested against `memoryRepo()` with no Worker and no D1 — and a schema
change lands in one adapter, which was ADR 0022's argument against a companion
Worker. It reaches no handler and builds no `RequestContext`: a sweep touches
every row of a table and belongs to no caller.

`replay.ts` is the file ADR 0016 exists for: it arranges calls to `generateTarget`
and `scoreGuess` and adds up what comes back, and it does no colour maths of its
own. It also owns the `games.flags` bits (ADR 0015). Everything a handler needs to
*decide* — is this fast enough to be a game, is this caller over their limit, who
is this — lives beside it rather than inside the handler, so a handler reads as
the sequence of decisions it makes.

**The contract that matters:** the server is authoritative because it *replays*,
not because it recomputes its own way. It issues the seed; the client generates
targets locally with `generateTarget(seed, roundIndex, difficulty)` and submits
only its guesses; the Worker calls the same `generateTarget` and `scoreGuess`.
A re-implementation on either side breaks replay silently for every player.

Three rules hold this together, all enforced rather than documented:

- **`server/**` imports the pure core with relative paths, never the `@/` alias.**
  Wrangler bundles with esbuild, which resolves tsconfig `paths` from whichever
  config it discovers. A resolution that works locally and fails at deploy is the
  worst failure mode available here.
- **`tsconfig.server.json` compiles the core a second time with `"lib": ["ES2022"]`
  and `"types": []`.** No DOM, no Node. That turns "the core runs unmodified under
  Workers" into a compile-time check. `npm run typecheck` runs all three projects.
- **Every SQL statement lives in `server/db/d1.ts`.** A query built in a handler is
  a query `memoryRepo()` cannot reproduce, and it turns the handler suite into
  decoration. `tests/purity.node.test.ts` has a second guard block for `server/**`:
  no DOM, no imports from `src/ui/**` or `src/platform/**`.

Endpoints (all under `/api`, all same-origin, all `Cache-Control: no-store`):

| Method | Path | Answer |
|--------|------|--------|
| GET | `/health` | 200 `{ok}` — liveness only, **touches no database** |
| GET | `/health/deep` | 200/503 `{ok, database}` — queries D1. Hand-called; never poll it (ADR 0018) |
| GET | `/me` | 200 identity, or 204. **Never mints a cookie** |
| POST | `/games` | 201 `{gameId, seed, roundsTotal}` |
| POST | `/games/:gameId/result` | 200 the scored submission |
| POST | `/name` | 200 `{name}` |
| DELETE | `/me` | 204, plus the clearing cookie |
| GET | `/leaderboard` | 200 `{entries[]}` |
| POST | `/client-error` | 204. Browser exceptions, deduplicated by `hash(message + stack)` |

`gameId` is 32 bytes of base64url and *is* the single-use submit token:
finalising is a conditional `UPDATE ... WHERE id = ? AND status = 'active'`, and
`meta.changes === 0` is the whole replay defence. Identity is a `SameSite=Strict`
cookie whose SHA-256 is the stored `players.token_hash`; the token itself is never
stored. Unsafe methods additionally require a same-origin `Origin` header.

Three properties of that table are load-bearing rather than incidental, and all
three are asserted in `server/**/*.test.ts`:

- **`seed`, `difficulty` and `memorize_ms` are read from the `games` row**, never
  from the submit body. `memorize_ms` in particular sets the minimum-playtime
  threshold (ADR 0015).
- **`meta.changes === 0` is not an error.** A second submission of a game the same
  player already finished replays the stored result from `seed` + `guesses_json`
  and answers 200, because a dropped response is indistinguishable from a lost
  request. Somebody else's finished game is 409.
- **No response but `POST /api/games` may contain a seed**, and none may contain a
  token, a token hash, a player id or a raw column. `server/hygiene.test.ts` walks
  every endpoint's body and fails on the key names.

## What `app.ts` adds to every response

Two things that used to be per-handler concerns in other codebases and are not
here, for the same reason the CSRF check is not: an endpoint added to the route
table gets them, and the 404s, 405s and 500s no handler owns get them too.

- **Security headers** (`server/http/security.ts`, ADR 0017). The same policy is
  written a second time in `public/_headers`, because Cloudflare applies that file
  to the static assets it serves from `[assets]` and *not* to Worker responses.
  `tests/csp.node.test.ts` compares the two directive lists and fails on drift.
- **One wide structured log event** (`server/log.ts`, ADR 0014). Workers Logs
  *is* `console.log` — Cloudflare indexes the fields of a JSON line — and the free
  plan's budget is about two log events per request, so one wide event per request
  is the shape, not a preference. `docs/OPERATIONS.md` § 1 has the field list.

  Three things it must never carry, all guarded by tests rather than by
  convention: the identity token (a session identifier under OWASP's logging
  exclusion list — the log carries a peppered 12-hex `player.key` instead), the
  raw path (the submit path *contains* the submit token, so the route pattern is
  logged), and any header outside a three-name allow-list.
  `tests/logging.node.test.ts` fails the build on a header dump anywhere under
  `server/**`, and on a `console` call anywhere but the one in `context.ts`.

## Telemetry

`round_stats` and `game_stats` (migration `0002_telemetry.sql`, ADR 0014). Pure
bucketing in `server/telemetry.ts`, written from the submit and start handlers
behind `waitUntil`, read only by the SQL in `docs/OPERATIONS.md` § 2.

Counters, not events: no per-round rows and no per-player rows, so write volume
tracks distinct buckets rather than player count and there is nothing to
subject-access or delete. `round_stats.hue_bucket` is the instrument ADR 0008
asked for and never had — twelve 30° buckets, so the hue-opponent axes are pairs
six apart.

`Replay.targetHues` exists solely to feed it, and is kept out of `RoundReport`
precisely because `rounds` is echoed to the client and this is not.

## Performance budget

- Bundle ≤ 30 KB gzipped, zero runtime dependencies.
- Plane repaint ≤ 4ms at 2× DPR on a mid-range phone; repaint only on **lightness**
  change (ADR 0007 — hue and chroma are the plane's own axes). **Currently missed:
  ~11ms final / 6.7ms draft. See `BACKLOG.md`.**
- No layout thrash in the frame loop: components read state, write style — never
  read layout during `update`.

## Known limitation

The target color exists in client memory during `picking` and can be read with
devtools. Acceptable for a single-player, offline, no-leaderboard game; the moment
a leaderboard exists, target generation moves server-side (the seeded-generation
design makes that a small change).

**This is now only half true.** ADR 0016 moved *authority* server-side without
moving *generation*: the server issues the seed and re-scores by replay, so a
submitted score cannot be forged. But the client still derives the targets from
the seed it was given, so a determined player can still read the next target out
of memory — they simply cannot lie about what they guessed. Closing that needs
the server to withhold the seed and stream one target per round, which costs a
round trip in the middle of the memorize phase. Not worth it for this game; write
an ADR if that judgement changes.
