# 0013 — picker & scoring UX: diagnosis, and phase 1

2026-08-02. A playtest note: the picker "feels washed out and not the true colour"
of the target, and "colours I pick feel closer than the score says" — plus close
reticles scoring poorly. This session diagnosed both and shipped the safe half of
the fix. The rest is staged behind a scoring reset (see § Deferred).

## What the complaints actually are

Two are perceptual, not bugs in the colour pipeline. Every colour in play is inside
sRGB by construction (`C = t·maxChroma`), and the plane (an sRGB 2D canvas) and the
target/cursor (CSS `oklch()`) resolve to the same in-gamut colour — there is no lost
saturation to explain "washed out" arithmetically.

- **Afterimage (the leading cause).** A ~5s fixation on a saturated swatch, then the
  picker lands at the *exact same retinal spot*: the plane is judged through a
  negative afterimage tinted opposite the target hue. That desaturates and
  hue-shifts what the player sees (→ "washed out") *and* biases the guess away from
  the target hue (→ "felt closer than it scored"). Known and knowingly unmitigated
  since ADR 0006 → 0008; the instrument to confirm it is `round_stats.hue_bucket`
  (`OPERATIONS.md` § 2.3, opponent hues six buckets apart). **Not yet measured.**
- **Area / simultaneous contrast.** A large uniform memorised field looks more vivid
  than the same colour as a small patch inside a full-spectrum plane (every hue at
  once — ADR 0007 — maximises the surround).

"Close reticles, poor score" is real and expected, and the measured driver is that
**the plane hides lightness** (it lives on the bar). Two reticles on the *same plane
pixel* with lightness thumbs 10% apart are ΔE00 ≈ 11.5, score ≈ 56. Screen distance
is also not ΔE-linear: an 8° hue slip is ΔE 6.3 vivid vs 2.7 dull. The picker trains
hue/chroma precision and lets the axis that dominates ΔE go unwatched.

## What shipped this session (phase 1, no scoring reset)

- **Per-axis ΔE breakdown at reveal** (`ciede2000Components` in `deltaE.ts`, surfaced
  by `reveal.ts`): lightness / chroma / hue, dominant axis lit. Computed from the two
  colours for display only — the scored value is untouched, so the replay gate
  (ADR 0016) sees identical scores.
- **Lightness-bar diff segment** (`picker.ts`): the bar's answer to the plane's diff
  line, so an off-plane ΔL is as visible as the hue/chroma gap.
- **Chroma nudge calibrated** (`CHROMA_FRACTION_NUDGE` 0.0025 → 0.01). The keyboard
  arrows were meant to feel even; measured, chroma moved ~0.06 ΔE00/press against
  ~0.22–0.25 for hue and lightness — ~4× too fine. Hue and lightness were already
  matched and did not move.

## Non-obvious bits

- **The `TUNING` claim that "lightness is the least ΔE-sensitive axis" is backwards.**
  Per unit of its own 0..1 control, lightness is the *most* sensitive (~114 ΔE00 per
  full-range unit at mid-plane). The old note was reasoning per-pixel across mismatched
  axis ranges. Corrected in place in `TUNING.md`.
- **`ciede2000Components` does not recombine to the total in general.** The `R_T`
  rotation term (`−sin(2Δθ)·R_C`) couples chroma and hue and bites hard near hue 275°
  (blue) — up to ~1.5, not negligible. A first property test asserting
  `hypot(L,C,h) ≈ ΔE00` over an `a* > 0` band failed: `a* > 0` still reaches hue ~285°
  (small +a, large −b points *down*). The clean RT-free family is **same-hue pairs**
  (ΔH′ = 0 ⟹ RT = 0), which the final test uses; the general identity holds only up to
  RT, which is exactly why RT is dropped from the player-facing attribution.

## Deferred (phase 2, one scoring reset + ADR)

Owner approved a leaderboard reset for the realign, staged after phase 1. All measured
from telemetry first, then shipped as one ADR crossing the score discontinuity once:

- **Equalise expected score across tiers** by varying `SCORE_SCALE` per tier —
  CIEDE2000 is harsher on desaturated targets, so the hard tier is penalised twice.
- **Re-anchor the curve** (τ, not the shape) to side-by-side perception.
- **Warp the chroma axis** to be locally ΔE-linear (pixel-gain, the other half of P1).
- **Afterimage mitigation** — gate on the § 2.3 measurement; the sanctioned levers are
  a neutral *ramp* over the end of memorise (continuous, dodges ADR 0008's "mask reads
  as a hitch") and biasing targets off the most saturated colours, **not** the rejected
  mid-transition mask.
- **One open fork:** which axis the plane hides. Keep `hue × chroma` and amplify the
  bar, or reassign to `hue × lightness` with chroma on the bar (reverses ADR 0007's bar
  choice). To be prototyped behind a flag and playtested; needs its own ADR.

Keep CIEDE2000 as the metric throughout — it *is* the perceptual truth. Align the
picker and the reveal to it; never swap it for a picker-shaped metric.
