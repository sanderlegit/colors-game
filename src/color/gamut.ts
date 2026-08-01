/**
 * sRGB gamut queries and mapping, in OKLCh.
 *
 * Two decisions from `docs/research/color-science.md` §5.4:
 *
 * 1. **Never clamp RGB channels.** Clamping changes the *ratios* between the
 *    primaries, and the ratios are what hue is. The CSS spec's own worked
 *    example: linear-light `(0.5, 1, 3)` sits at OKLCh hue 265.1°; clamped to
 *    `(0.5, 1, 1)` it becomes 196.1° — a 69° swing. We reduce chroma at
 *    constant `L` and `h` instead.
 * 2. **Reduce in OKLCh, not CIE LCh.** Constant-hue chroma reduction in CIE LCh
 *    *"is known to give suboptimal results with significant hue shifts, for
 *    colors in the hue range 270° to 330°"* — CIELAB's blue-turns-purple
 *    curvature. OKLCh does not have it.
 */

import { oklchToSrgb } from "@/color/convert";
import { type Oklch, oklch } from "@/color/types";

/**
 * Slack on the sRGB channel bounds, in gamma-encoded units. It exists to absorb
 * conversion round-off, nothing more: an 8-bit code step is 1/255 ≈ 0.0039, so
 * this is ~4000× tighter than the display's own resolution.
 *
 * That makes this test deliberately stricter than "would render identically
 * after rounding to a byte". A colour whose channel sits at −0.001 does display
 * as 0, but it is out of gamut, and the picker's inert region should say so.
 * The consequence is a slightly smaller `maxChroma` at low lightness than the
 * research doc's table reports — see the note on `MAX_CHROMA_TABLE`.
 */
const CHANNEL_EPSILON = 1e-6;

/** Chroma bisection resolution. sRGB's widest OKLCh chroma is ~0.32, so this is ~19 steps. */
const CHROMA_RESOLUTION = 1e-6;

/** Above any in-gamut sRGB chroma (measured maximum ≈ 0.322, at magenta). */
const CHROMA_CEILING = 0.5;

function withinCube(value: number): boolean {
  return value >= -CHANNEL_EPSILON && value <= 1 + CHANNEL_EPSILON;
}

function inGamutAt(L: number, c: number, h: number): boolean {
  const { r, g, b } = oklchToSrgb(oklch(L, c, h));
  return withinCube(r) && withinCube(g) && withinCube(b);
}

/**
 * Largest in-gamut chroma at `(L, h)`, found by bisection.
 *
 * Returns 0 at `L <= 0` and `L >= 1`, where only black and white exist — target
 * generation must keep `L` away from the extremes or it will ask for colours
 * that have no chroma to guess.
 */
export function maxChroma(L: number, h: number): number {
  if (L <= 0 || L >= 1) return 0;
  let low = 0;
  let high = CHROMA_CEILING;
  while (high - low > CHROMA_RESOLUTION) {
    const mid = (low + high) / 2;
    if (inGamutAt(L, mid, h)) low = mid;
    else high = mid;
  }
  return low;
}

export function isInGamut(c: Oklch): boolean {
  return inGamutAt(c.L, c.c, c.h);
}

/**
 * Reduce chroma at constant `L` and `h` until the colour is inside sRGB.
 * In-gamut input is returned unchanged, so this is idempotent.
 *
 * This is the plain binary search, not CSS Color 4's local-MINDE refinement.
 * MINDE exists to avoid over-desaturating near concave patches of the gamut
 * surface; it costs a ΔE_OK evaluation per step and buys at most a sliver of
 * chroma back. Revisit if the picker's clipped edge ever looks washed out.
 */
export function clipChromaToGamut(c: Oklch): Oklch {
  if (isInGamut(c)) return oklch(c.L, c.c, c.h);
  // No chroma rescues a lightness outside [0, 1] — there is nothing there to
  // map onto. Black and white are the only honest answers, so `L` is clamped in
  // this one degenerate case; hue is still carried through.
  if (c.L <= 0) return oklch(0, 0, c.h);
  if (c.L >= 1) return oklch(1, 0, c.h);

  let low = 0;
  let high = c.c;
  while (high - low > CHROMA_RESOLUTION) {
    const mid = (low + high) / 2;
    if (inGamutAt(c.L, mid, c.h)) low = mid;
    else high = mid;
  }
  return oklch(c.L, low, c.h);
}
