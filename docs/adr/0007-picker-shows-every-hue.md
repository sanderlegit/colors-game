# 0007 — The picker plane shows every hue; lightness moves to a bar

Date: 2026-08-01 · Status: accepted · Supersedes ADR 0005

## Context

ADR 0005 chose an L×C plane at constant hue plus a hue slider, on the strength of
a measurement: an L×C plane has the flattest per-pixel scoring fairness (2.2×
versus 4.0× for HSV), and cylinder-shaped spaces like OKHSV/OKHSL are worse, not
better.

That measurement was correct and the conclusion drawn from it was still wrong,
because it optimised the wrong quantity.

Playing it surfaces the problem immediately. **The plane shows one hue at a time.**
A player who has just memorised a colour does not begin by refining it — they
begin by *finding* it. With hue behind a slider, the first and hardest phase of
the task is performed against a control that shows almost nothing: you scrub the
slider and watch an entire plane of unrelated colours churn, hunting for a
neighbourhood. Per-pixel precision is irrelevant while you are lost.

It also breaks the game's central gesture. The swatch dissolving into a picker
reads as "the colour you saw is *in here, somewhere*". That promise is only true
if the colour is actually visible in the square. With a hue slider it is not: at
the moment the dissolve lands, the target hue is almost certainly not the hue on
screen.

## Decision

The plane shows **every hue at once**:

- **x = hue**, 0..360° across the full width.
- **y = chroma fraction `t`**, 0..1, saturated at the top, neutral grey at the bottom.
- **Lightness moves to the bar** beneath the plane, dim → bright, in the row the
  hue slider used to occupy.

Actual chroma is `C = t · maxChroma(L, h)` — the same construction
`generateTarget` already uses to keep targets in gamut.

### The consequence that decides it

Because chroma is a *fraction of the per-(L, h) maximum* rather than an absolute
value, **every point in the plane is in gamut**. The inert out-of-gamut region
from ADR 0005 — roughly half the plane's area — does not exist in this model. It
is not masked or clamped; it is gone.

So the redesign wins on all three axes that matter:

| | ADR 0005 (L×C + hue slider) | This |
|---|---|---|
| Can you find the colour? | No — hue is invisible until you scrub | Yes, it is on screen |
| Usable plane area | ~50% (rest inert) | 100% |
| Worst-axis precision | hue slider, ~0.93 ΔE00/px | lightness bar, ~0.37 ΔE00/px |

The last row is the one ADR 0005 would have objected to, and it improves anyway:
hue was the precision bottleneck precisely *because* it was confined to a slider.
Spread across the plane's width it has comparable degrees-per-pixel, while the
axis now relegated to a bar (lightness) is intrinsically the least sensitive of
the three.

## Consequences

- ADR 0005's fairness measurement is not repudiated — an L×C plane really is the
  flattest. It was answering "which plane scores most evenly" when the question
  was "which picker can a player actually search". Both matter; searchability
  dominates, and this design happens to give up little of the other.
- The plane canvas now repaints on **lightness** change rather than hue change.
  Dragging within the plane still repaints nothing.
- The picker's start position (SPEC §5.3) is unaffected: `t = 0` is neutral grey
  regardless of the hue column it sits in, so it still leaks nothing about the
  target while giving every target the same distance to travel.
- Hue precision is now bounded by plane width, so it degrades on very narrow
  viewports in a way a fixed-height slider did not. Worth measuring on a small
  phone; a horizontal-pan gesture on the plane is the escape hatch if it bites.
- Retained from ADR 0005 and still load-bearing: **take-off selection and the
  touch loupe**. Those addressed fingertip occlusion (5.3–6.6 ΔE00 median error),
  which is a property of touch input, not of the axis layout.
