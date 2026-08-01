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
    deltaE.ts         ciede2000(), deltaEOk()
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
    picker.ts         2D plane (canvas) + hue slider, pointer/keyboard input
    preview.ts        live guess panel + numeric readout
    hud.ts            countdown, round counter, confirm button
    reveal.ts         target vs guess, ΔE, score
    render.ts         mount(root) -> { update(state) }
    *.test.ts
  platform/
    clock.ts          rAF-driven ticker -> emits TICK with monotonic ms
    storage.ts        localStorage adapter behind Storage port
    seed.ts           crypto.getRandomValues -> initial seed
  main.ts             composition root
  styles.css
e2e/                  Playwright specs
docs/                 spec, architecture, ADRs, research
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
type RoundResult = { deltaE: number; score: number };  // score 0..100
function scoreGuess(target: Oklch, guess: Oklch): RoundResult;

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
function reduce(state: GameState, event: Event): GameState;
```

`reduce` is total: every (state, event) pair returns a state, illegal
combinations return the input unchanged. It never throws. It performs the
memorize→picking transition itself when `TICK` pushes elapsed time past
`memorizeMs` — the timer is domain logic, not a `setTimeout` in the UI.

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

The picker plane is a `<canvas>` painted once per hue change (not per frame) at
device pixel ratio; the cursor is a separate absolutely-positioned DOM element so
dragging never repaints the gradient.

## Touch

- `pointerdown/move/up` with `setPointerCapture` — one code path for mouse, touch,
  and pen. No separate touch handlers.
- `touch-action: none` on the picker plane and hue slider only, so the page still
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

## Performance budget

- Bundle ≤ 30 KB gzipped, zero runtime dependencies.
- Gradient repaint ≤ 4ms at 2× DPR on a mid-range phone; repaint only on hue change.
- No layout thrash in the frame loop: components read state, write style — never
  read layout during `update`.

## Known limitation

The target color exists in client memory during `picking` and can be read with
devtools. Acceptable for a single-player, offline, no-leaderboard game; the moment
a leaderboard exists, target generation moves server-side (the seeded-generation
design makes that a small change).
