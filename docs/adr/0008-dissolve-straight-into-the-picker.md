# 0008 — The dissolve goes straight into the picker

Date: 2026-08-01 · Status: accepted · Supersedes ADR 0006

## Context

ADR 0006 inserted a neutral grey mask into the dissolve — fade the target out
behind grey, hold 400ms, fade grey off the picker — to let the negative
afterimage from five seconds of fixation decay before the player judged colour at
that same retinal location.

Played, it is wrong. The swatch visibly fades to a flat grey and sits there. The
grey reads as the game having already made a choice for you, or as a hitch — and
it arrives at the exact moment the interaction is supposed to feel continuous.
The pause is 850ms of the round's most important second.

The mask also made less sense once the picker changed. Under ADR 0007 the plane
shows every hue, so the swatch is dissolving into a surface that visibly contains
the colour you just saw. That reads as one continuous gesture — "it's in there,
find it" — and interrupting it with an opaque grey card breaks the only moment
where the design explains itself.

## Decision

Revert to a single cross-fade: `.swatch-fill` fades out while
`.swatch-picker-slot` fades in, 450ms, same shared grid cell, collapsing to an
instant swap under `prefers-reduced-motion: reduce`.

`MASK_HOLD_MS`, the `.swatch-mask` layer and the `maskHoldMs` option are deleted
rather than defaulted to zero — a disabled mechanism nobody can see is worse than
no mechanism, because the next person has to work out whether it was meant to be
on.

## Consequences

- **We are knowingly accepting the afterimage bias.** ADR 0006's perceptual
  argument was not refuted and is not refuted here; it is outweighed. The bias
  pushes guesses away from the target hue, and it is invisible — it costs points
  without feeling like anything. If scores ever show a systematic hue-opponent
  skew, ADR 0006 is where to look first, and reinstating the mask is the fix.
- The dissolve is back to 450ms, ~4s cheaper across a five-round game.
- ADR 0007's plane, which shows every hue at once, is what makes the direct fade
  legible. The two decisions are load-bearing together: a direct fade into a
  single-hue plane would have been the worst of both.
- Retained from ADR 0006: the target colour is still dropped from the DOM when
  the fade completes, and `pointer-events` still reach the picker only afterwards.
