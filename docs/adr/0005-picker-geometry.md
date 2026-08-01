# 0005 — OKLCh L×C plane picker, and the hue slider is the real problem

Date: 2026-08-01 · Status: **superseded by [ADR 0007](0007-picker-shows-every-hue.md)**
Research: `docs/research/color-science.md` § Picker UX

> Superseded because this decision optimised per-pixel scoring fairness and
> ignored searchability: with hue behind a slider, a player cannot find the
> colour they memorised. The measurements below still stand and 0007 explains
> which of them survive. Take-off selection and the touch loupe are retained.

## Context

The picker must occupy the same rectangle as the swatch (SPEC §2), so we get one
2D plane plus one auxiliary control. Which two axes go in the plane decides how
fairly the game plays, because *area in the plane is precision*: an axis that is
compressed into a few pixels is an axis the player cannot control, and they get
scored on it anyway.

Options: classic HSV square + hue slider, HSL, OKHSV/OKHSL, an OKLCh L×C plane, or
three RGB sliders.

## Decision

**An OKLCh L×C plane at constant hue, with out-of-gamut regions rendered inert,
plus a 32px inlaid hue slider.**

The research produced a genuinely counterintuitive result that changed this
decision. The obvious move — "score in OKLab, so pick in OKHSV/OKHSL" — **does not
help at all.** Dead-axis area goes 24% (HSV) → 26% (OKHSV) → 29% (OKHSL); it gets
*worse*. The problem is topological, not colorimetric: any cylinder-shaped space
collapses at its edges, so every S/V-style parameterisation squeezes the same
regions no matter how perceptual its underlying space is.

Only a true L×C plane flattens it — unfairness across the plane drops from 4.0× to
2.2×. The cost is that ~50% of the plane is out of gamut at a given hue, which we
render as an explicit inert region rather than silently clamping (clamping would
let several distinct cursor positions map to the same colour, which is worse than
an honest dead zone).

**The hue slider, not the square, is the precision bottleneck** — and this was not
obvious. Measured sensitivity is ~0.93 ΔE00 per pixel on the slider (peaking at
2.33) versus 0.18 in the square. A player who nails the plane can still lose ~10
points to a two-pixel hue slip. Consequences: the slider gets the full swatch
width, a generous 32px hit height, keyboard nudge at 0.5°/arrow, and a
coarse/fine modifier.

**Touch requires take-off selection plus an always-on loupe.** Without them,
players are scored on the width of their fingertip — measured median error 5.3–6.6
ΔE00, which is larger than the entire "clearly different" threshold. This is not
polish; it is the difference between a fair game and an unfair one on the platform
most people will play it on.

## Consequences

- The plane is a `<canvas>` repainted only on hue change, at device pixel ratio;
  the cursor is a separate positioned element so dragging never repaints.
- The picker's space (OKLCh) matches the scoring space's family, which removes the
  "unfair to score in ΔE00 while picking in HSV" objection as a bonus — but note
  that this was *not* the deciding argument, since OKHSV would have satisfied it
  while making the game worse.
- We render an out-of-gamut region users can see and cannot select. This needs a
  clear visual treatment or it reads as a rendering bug.
- Rejected: three RGB sliders (no spatial memory affordance at all), HSV (dead
  axes), OKHSV/OKHSL (dead axes, plus false confidence from the perceptual label).
