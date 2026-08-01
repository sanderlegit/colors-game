# 0006 — Fade through a neutral mask, not directly into the picker

Date: 2026-08-01 · Status: **superseded by [ADR 0008](0008-dissolve-straight-into-the-picker.md)**
Research: `docs/research/color-science.md`

> Superseded on feel: the grey hold reads as a hitch at the moment the
> interaction most needs to feel continuous. The perceptual argument below is
> not refuted — it is outweighed, and ADR 0008 records what we are accepting.

## Context

The original design fades the swatch directly into the picker. This is the
signature interaction and the reason the game feels good, so it was not
questioned — but the colour-science pass flagged a defect in it.

Staring at a saturated colour for five seconds produces a **negative afterimage**.
Because the picker then appears at *the same retinal location*, the afterimage
lands directly on top of the region the player is now judging, biasing their
perception toward the opponent hue — away from the target, in the hue dimension,
which is exactly where CIEDE2000 is most sensitive (ADR 0005 measures the hue
slider at ~0.93 ΔE00/px).

The same-location constraint is what causes this, and that constraint is the whole
point of the design. So the fix has to preserve it.

## Decision

The dissolve goes **swatch → neutral grey mask (≈400ms hold) → picker**, instead
of swatch → picker.

The mask occupies the identical rectangle, so the geometric requirement — the
picker covers the same shape area as the swatch — is untouched. The transition
still reads as one continuous dissolve in place. It simply passes through neutral
on the way, which is what lets the afterimage decay before the player starts
judging colour.

This composes naturally with SPEC §5.3, where the picker already starts at zero
chroma: the mask's grey and the picker's initial state are the same neutral, so
there is no visible seam between the two stages.

Three stages: fade the target out behind the mask (450ms), hold the mask (400ms),
fade the mask off the picker (450ms) — 1300ms total. Under
`prefers-reduced-motion: reduce` the *fades* collapse to 0, leaving 400ms, but
**the mask hold does not** — it is a perceptual correction, not decoration, and
removing it would reintroduce the bias for exactly the users who opted out of
animation.

The target colour is dropped from the DOM at the end of stage 1, as soon as the
mask covers it, rather than at the end of the whole transition (SPEC §9.4).

## Consequences

- This is a deliberate deviation from the originally-specified interaction. It is
  reversible in one constant if playtesting says the delay hurts the feel more
  than the afterimage hurts accuracy — but note that the afterimage cost is
  invisible to playtesters (it biases scores without feeling like anything), which
  is precisely why it needs to be decided on the evidence rather than on feel.
- Adds ~850ms per round over a plain 450ms cross-fade, ~4s across a five-round
  game. That is the real cost and it is not trivial; `MASK_HOLD_MS` in
  `src/ui/swatch.ts` is the single knob.
- The mask duration is a named constant with the rationale attached, so nobody
  "optimises" it away later without reading this.
- Not addressed: players who look away during the memorize phase get no
  afterimage and no penalty. Nothing to do about that, and it favours nobody
  systematically.
