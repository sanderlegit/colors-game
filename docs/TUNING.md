# Tuning knobs

Every number a maintainer is likely to want to change, where it lives, and what
changing it does. Constants are named here so you do not have to grep for them —
but the **files are authoritative**; if this page and the code disagree, the code
wins and this page is a bug.

> **Two unrelated things are called "difficulty" in this repo.** The *score curve*
> controls how harshly a given error is punished. The *difficulty tier* controls
> how hard the target colour is to remember. They are separate mechanisms in
> separate files. Be explicit about which one you mean.

## How harshly guesses are scored

`src/domain/scoring.ts` · decided in [ADR 0004](adr/0004-perceptual-scoring.md)

```
score = 100 · exp( −( max(0, ΔE00 − SCORE_DEADBAND) / SCORE_SCALE ) ^ SCORE_EXPONENT )
```

| Constant | Now | What it does |
|----------|----:|--------------|
| `SCORE_DEADBAND` | 1 | ΔE00 below which you get a full 100. **Leave this alone** — it is anchored to the measured perceptibility threshold (0.8) and W3C's JND (2). Scoring 97 for an invisible miss reads as a broken game. |
| `SCORE_SCALE` | 16 | **The generosity knob.** Higher is kinder. At 18, ΔE 12 scores 67 instead of 54, and a random guess beats 50 points 6.8% of the time instead of 5.4%. This is the one to reach for first. |
| `SCORE_EXPONENT` | 1.3 | The *shape*. Tuned, not arbitrary: at 2 (Gaussian) a random guess clears 50 points ~12% of the time and a good score stops meaning anything; at 1 a barely-perceptible ΔE 2 already costs 6 points. **Change `SCORE_SCALE` instead unless you have a reason to reshape the curve.** |

Reference points at the current settings: ΔE 2 → 97, 5 → 85, 12 → 54, 20 → 29,
45 → 2. The property tests hold whatever the numbers become (identity = 100,
bounded, monotonic, symmetric), so retuning is safe — but update the table in
SPEC §6 and `player-guide.md`, which quote these figures.

If tiers ever need to move the curve, vary `SCORE_SCALE` per tier. Do not change
the shape per tier.

## How hard the target colours are

`src/domain/round.ts` · `TIERS` table · SPEC §5.1

| Tier | L range | chroma fraction `t` |
|------|---------|---------------------|
| `easy` | 0.45–0.75 | 0.80–1.00 |
| `normal` | 0.35–0.85 | 0.45–0.90 |
| `hard` | 0.25–0.90 | 0.12–0.50 |

Chroma is `t · maxChroma(L, h)`, so targets are in gamut by construction. It is a
data table on purpose — add a tier by adding a row, not a branch.

**Currently unreachable from the UI.** `createReducer` calls
`deps.target(seed, roundIndex)` with no tier, so every game plays `normal`.
Wiring it needs a field on `Settings` and a control in the menu — see
`BACKLOG.md` § Known gaps.

## Timing

| Constant | File | Now | Notes |
|----------|------|----:|-------|
| `memorizeMs` | `src/domain/state.ts` (`DEFAULT_SETTINGS`) | 5000 | SPEC §8 promises a 3s/5s/8s choice. Storage and the reducer support it; **no UI surfaces it yet.** |
| `DISSOLVE_MS` | `src/ui/swatch.ts` | 450 | The cross-fade. Collapses to 0 under `prefers-reduced-motion`. |
| `ROUNDS_PER_GAME` | `src/domain/state.ts` | 5 | Max game score is `ROUNDS_PER_GAME × 100`; the reveal and summary derive from it. |

## Picker feel

`src/ui/picker.ts` · [ADR 0007](adr/0007-picker-shows-every-hue.md)

| Constant | Now | Notes |
|----------|----:|-------|
| `HUE_NUDGE_DEG` | 0.5 | Hue is the plane's x axis. Sub-pixel at both phone and desktop widths. |
| `CHROMA_FRACTION_NUDGE` | 0.0025 | Plane y axis, ≈1/400 of the axis. |
| `LIGHTNESS_NUDGE` | 0.0025 | The bar. ~1.1px at a 450px-wide bar — marginally coarser than a pixel, kept deliberately because lightness is the least ΔE-sensitive axis. |
| `COARSE_MULTIPLIER` | 10 | **Shift makes steps coarser, never finer.** |
| `DRAFT_SAMPLES` / `FINAL_SAMPLES` | 24k / 120k | Draft lattice during a lightness drag, refined 120ms after it settles. This is the repaint-budget trade — see `BACKLOG.md`. |

## Reveal reticle

`src/styles.css` · [ADR 0009](adr/0009-score-screen-in-place-reticle.md)

The score screen marks where the target sat on the picker. These are CSS, not
TypeScript constants:

| Knob | Where | Now | Notes |
|------|-------|----:|-------|
| `--color-target` | `:root` (+ dark override) | `#e5484d` / `#ff6369` | The reticle red and the tint on the "Target" readout column. Change both or the two drift apart. |
| `.picker-target` size | `.picker-target` | 26px | The plane reticle. Deliberately larger than the 22px `.picker-cursor` so it frames the guess when they coincide. |
| `.reveal-card` `max-height` | `@media (max-width: 639px)` | 62dvh | How tall the phone bottom-sheet may grow before it scrolls. Raising it eats into the visible board (ADR 0009 § known limitation). |

The reveal card position (side-docked ≥640px, bottom sheet below) lives in the
`.reveal` rules; the whole game top-anchors at phone widths (`.game`
`align-content`) so the sheet has room — see ADR 0009.

## Things that are not knobs

- **The colour-conversion constants** in `src/color/convert.ts`. They are cited in
  `research/color-science.md`. Do not "clean them up", and do not re-derive them
  from memory — the D50/D65 trap alone will silently shift every score.
- **`CHANNEL_EPSILON`** in `src/color/gamut.ts`. Loosening it puts unreachable
  colours in play.
