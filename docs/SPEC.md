# Colors — Product & Technical Spec

Status: draft v1 · Owner: engineering · Last updated: 2026-08-01

## 1. One-liner

You get five seconds to memorize a color. Then it dissolves into a color picker
occupying the exact same shape, and you have to find it again. Your answer is
scored on perceptual distance from the truth.

## 2. Why this design works (and the traps)

The whole game lives or dies on three things:

1. **The dissolve.** The swatch must become the picker *in place* — same rect,
   same rounded corners, same position. If the picker appears somewhere else, the
   player gets a spatial anchor and the memory task changes character. This is a
   hard geometric requirement, and it is asserted in e2e tests (§9.4).
2. **The scoring feels fair.** Naive RGB Euclidean distance does not match human
   perception — two blues 30 units apart look identical while two greens 30 units
   apart look obviously different. Players *will* notice and will call the game
   broken. We score in a perceptually uniform space (§6).
3. **The picker doesn't leak the answer.** The picker's starting position must
   carry zero information about the target, and must not accidentally hand out
   free wins (§5.3).

## 3. Round lifecycle

```
IDLE ──start──▶ MEMORIZE ──timer elapsed──▶ PICKING ──confirm──▶ REVEAL
                (5.000s)                     (untimed)             │
                                                                   │ next
                    ┌──────────────────────────────────────────────┘
                    ▼
              MEMORIZE (round n+1)   ... after final round ──▶ SUMMARY ──restart──▶ MEMORIZE
```

| State      | What the player sees                                                                 | Exits on            |
|------------|--------------------------------------------------------------------------------------|---------------------|
| `idle`     | Title, "Play" button, best score                                                       | `START`             |
| `memorize` | Swatch filled with the target color + a 5s countdown ring. Preview panel is empty/dim | timer reaches 0     |
| `picking`  | Swatch area cross-faded into the picker; preview panel shows the live guess; Confirm   | `CONFIRM`           |
| `reveal`   | Target and guess side by side, ΔE00, round score, running total                        | `NEXT`              |
| `summary`  | Per-round breakdown, total score, best-ever, replay + share-seed                        | `RESTART`           |

- **Rounds per game: 5.** Long enough to smooth out luck, short enough for one sitting.
- The memorize phase is **not** pausable and not skippable. (A "study longer"
  accessibility setting exists — see §8 — but it is a game-wide setting chosen
  before play, not a mid-round escape hatch.)
- The picking phase is **untimed** by design. Adding a second clock turns a memory
  game into a reflex game and punishes the fine motor control the picker demands,
  especially on touch.

## 4. Layout

Two regions, always both visible, never requiring a scroll:

```
 ┌──────────────────────────┐  ┌───────────┐
 │                          │  │  PREVIEW  │   ← your current guess, large flat fill
 │      SWATCH / PICKER     │  │           │
 │   (same rect, always)    │  ├───────────┤
 │                          │  │  readout  │   ← hex + coords, monospace
 └──────────────────────────┘  └───────────┘
        ▲ hue slider directly beneath, same width
```

- **≥ 640px wide:** preview sits to the right of the swatch, as specified.
- **< 640px (portrait phones):** preview moves *below* the swatch and hue slider,
  full width, min-height 20vh. Both remain on screen simultaneously — this is a
  layout constraint, not a suggestion. Verified in e2e at iPhone 14 viewport.
- The swatch is a fixed aspect ratio (1:1) sized by `min(70vw, 50vh)` so it never
  pushes the preview or the confirm button below the fold, including with the iOS
  URL bar visible. Safe-area insets respected.

## 5. Mechanics

### 5.1 Target generation

Sampled in OKLCh, not in the sRGB cube — uniform RGB sampling clusters visually
toward dark, saturated corners and over-represents colors people describe with the
same word. Concrete ranges and gamut-clipping strategy are set by
`docs/research/color-science.md`; the contract is:

- Targets are always in-gamut sRGB after chroma reduction (reduce C at constant
  L and h until in gamut — never clamp RGB channels, which shifts hue).
- Difficulty tiers exist as a data table, not as code branches.
- Generation is a pure function of `(seed, roundIndex)`.

### 5.2 Seeded randomness

Every game is fully determined by a single integer seed. This is non-negotiable
and cheap to build in from day one, because it buys:

- deterministic tests (no flaky "random color" assertions),
- reproducible bug reports ("seed 41762, round 3"),
- a daily challenge and head-to-head "same colors" mode for free later.

`Math.random()` is banned in `src/domain/**` and `src/color/**` (§ CLAUDE.md).

### 5.3 Picker start position

The picker cursor starts at **zero chroma** (a neutral gray) with a seeded-random
hue and mid lightness.

Rationale: a fixed start (e.g. pure red) systematically advantages targets near
that hue. A fully random start hands out occasional free wins. Starting at C=0
means the visible starting color is neutral gray regardless of the hidden hue —
it leaks nothing, looks identical every round, and gives every target the same
distance-to-travel in the dimension that matters most.

### 5.4 Confirm

Single explicit confirm action. No auto-submit on release — on touch, lifting a
finger is not an intent signal, and accidental submission is the single most
enraging failure mode in a game like this. Confirm is disabled until the player
has moved the picker at least once (prevents scoring a neutral gray by accident).

## 6. Scoring

- Perceptual distance is computed in a perceptually uniform space (CIEDE2000 or
  OKLab ΔE — final choice recorded in `docs/adr/0003-perceptual-scoring.md` once
  research lands).
- Distance maps to a **0–100 round score** via a monotonically decreasing curve
  tuned so that:
  - an exact match is 100,
  - a "that's basically it" near-miss still scores high (rewarding),
  - a random guess sits well below the midpoint (so a good score means something),
  - the curve is smooth — no score cliffs.
- The reveal screen shows the raw ΔE alongside the score. Showing the underlying
  number builds trust in the scoring; hiding it invites accusations of rigging.
- Game score = sum of round scores (max 500).

Scoring invariants, enforced as property tests (§9.2):
`score(c,c) === 100` · `0 ≤ score ≤ 100` · monotonic in distance · symmetric in
its arguments.

## 7. Persistence

`localStorage` only, behind a port. Stores: best game score, games played, last
used settings. No accounts, no network, no analytics in v1. The game is fully
playable offline.

## 8. Accessibility & motion

Be honest: this is a color-discrimination game and it is not fully playable by
someone with total color blindness. What we *will* do:

- **Numeric readout** of the current pick (hex + coordinates), always visible, so
  the picker is operable and verifiable without relying solely on the rendered color.
- **Full keyboard control**: the picker plane and hue slider are focusable, arrow
  keys nudge by 1 unit, shift+arrow by 10, Enter confirms. Visible focus rings.
- **`prefers-reduced-motion: reduce`** → the 450ms dissolve becomes an instant
  swap and the countdown ring stops animating (the numeric countdown remains).
  The 5s memorize window is unchanged; it is a game rule, not decoration.
- **Adjustable memorize duration** (3s / 5s / 8s) in settings, chosen before play.
  Scores record which duration was used.
- Touch targets ≥ 44×44 CSS px. `user-scalable=no` is forbidden.
- Never use color alone to convey UI state (buttons, focus, errors).

## 9. Test strategy

### 9.1 Unit — the pure core
Color conversions against published reference values; CIEDE2000 against the
Sharma/Wu/Dalal test set (this catches the classic hue-wraparound and RT-rotation
bugs that naive implementations ship with); state-machine transitions for every
(state × event) pair including the illegal ones.

### 9.2 Property-based (fast-check)
- `sRGB → OKLab → sRGB` round-trips within epsilon for the whole 8-bit cube (sampled).
- ΔE symmetry and identity.
- Score bounds and monotonicity.
- Gamut mapping always returns an in-gamut color.
- The reducer never throws for any (state, event) pair.

### 9.3 Component (happy-dom)
Each UI component mounts, renders from a state object, and emits the right events.
No snapshot tests of markup — they rot and nobody reads the diffs.

### 9.4 E2E (Playwright, Desktop Chrome + iPhone 14)
- **Geometry assertion:** the picker's bounding box equals the swatch's bounding
  box within 1px. This is the spec's headline requirement, so it is a test, not a
  hope.
- Happy path: start → wait out timer → drag picker → confirm → score appears.
- The target color is not present in the DOM during `picking`.
- Both swatch and preview are within the viewport at iPhone 14 size without scrolling.
- Reduced-motion path completes.

### 9.5 Not doing
Pixel-diff visual regression on the picker gradient (GPU/font differences make it
flaky across machines and it would block CI for no real defect signal).

## 10. Out of scope for v1

Accounts, server, leaderboards, sound, animation polish beyond the dissolve,
i18n, PWA install/offline caching, daily challenge (the seed work makes it a
small follow-up, deliberately).

## 11. Definition of done for v1

- [ ] `npm run verify` green (typecheck, lint, unit, build)
- [ ] `npm run e2e` green on Desktop Chrome and iPhone 14 projects
- [ ] Coverage ≥ 90% on `src/color/**` and `src/domain/**`
- [ ] CIEDE2000 implementation passes the published test vectors
- [ ] Playable end-to-end on a real iPhone over the LAN dev server
- [ ] Every §8 accessibility item verified manually once, keyboard-only
