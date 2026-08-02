/**
 * Colour-difference metrics.
 *
 * `ciede2000` is the scoring metric. It is transcribed from
 * `docs/research/color-science.md` §3.6, which follows Sharma, Wu & Dalal
 * (2005) — the paper that exists because *"several of the implementations
 * distributed on the Internet, including some from reputable sources, were
 * erroneous"* while still passing the CIE's own worked examples. The traps that
 * shaped the code below:
 *
 * - `ΔC'` and `ΔH'` are **signed**. They appear squared *and* in the `R_T`
 *   cross-term, where the sign changes the answer. Taking `abs()` is the single
 *   most common bug and is invisible outside hue ~275°.
 * - `h'` needs four-quadrant `atan2(b*, a')` — note it takes the G-corrected
 *   `a'` but the raw `b*`; there is no `b'`.
 * - Mean hue `h̄'` is a four-case rule, not `(h1' + h2') / 2`.
 * - `C'₁·C'₂ = 0` (one colour exactly neutral) is a special case for both `Δh'`
 *   and `h̄'`; miss it and you get `NaN`.
 * - `G` comes from the *original* chroma mean `C̄ab`, never from `C'`.
 * - `T`, `Δθ` and `R_T` are written in degrees; JS trig wants radians.
 *
 * The parametric factors `kL`, `kC`, `kH` are all 1 for this game — they model
 * textile/viewing conditions we do not have — so they are omitted from the
 * arithmetic rather than carried as always-1 parameters.
 */

import type { Lab, Oklab } from "@/color/types";

/** 25^7. Exceeds a 32-bit int; harmless in JS doubles, a real bug elsewhere. */
const POW_25_7 = 6103515625;

const RAD_PER_DEG = Math.PI / 180;

function cosDeg(degrees: number): number {
  return Math.cos(degrees * RAD_PER_DEG);
}

/** `atan2` in `[0, 360)`, with the CIE's "both components zero ⟹ 0" convention. */
function huePrime(bStar: number, aPrime: number): number {
  if (bStar === 0 && aPrime === 0) return 0;
  const degrees = Math.atan2(bStar, aPrime) / RAD_PER_DEG;
  return degrees < 0 ? degrees + 360 : degrees;
}

/**
 * The three weighted differences CIEDE2000 combines, plus its rotation term.
 * `termL/termC/termH` are `ΔL'/S_L`, `ΔC'/S_C`, `ΔH'/S_H` — signed, because the
 * `R_T` cross-term needs the sign (see the module header). `ciede2000` folds them
 * into the metric; `ciede2000Components` reads their magnitudes as a per-axis
 * attribution of the error.
 */
type Ciede2000Terms = {
  readonly termL: number;
  readonly termC: number;
  readonly termH: number;
  readonly rt: number;
};

function ciede2000Terms(a: Lab, b: Lab): Ciede2000Terms {
  const chroma1 = Math.hypot(a.a, a.b);
  const chroma2 = Math.hypot(b.a, b.b);
  const meanChroma7 = ((chroma1 + chroma2) / 2) ** 7;
  const g = 0.5 * (1 - Math.sqrt(meanChroma7 / (meanChroma7 + POW_25_7)));

  const a1p = (1 + g) * a.a;
  const a2p = (1 + g) * b.a;
  const c1p = Math.hypot(a1p, a.b);
  const c2p = Math.hypot(a2p, b.b);
  const h1p = huePrime(a.b, a1p);
  const h2p = huePrime(b.b, a2p);

  const chromaProduct = c1p * c2p;
  const hueGap = h2p - h1p;
  let deltaHueDeg: number;
  if (chromaProduct === 0) deltaHueDeg = 0;
  else if (hueGap > 180) deltaHueDeg = hueGap - 360;
  else if (hueGap < -180) deltaHueDeg = hueGap + 360;
  else deltaHueDeg = hueGap;

  const deltaL = b.L - a.L;
  const deltaC = c2p - c1p;
  const deltaH = 2 * Math.sqrt(chromaProduct) * Math.sin((deltaHueDeg / 2) * RAD_PER_DEG);

  const meanL = (a.L + b.L) / 2;
  const meanC = (c1p + c2p) / 2;

  const hueSum = h1p + h2p;
  let meanHue: number;
  if (chromaProduct === 0) meanHue = hueSum;
  else if (Math.abs(h1p - h2p) <= 180) meanHue = hueSum / 2;
  else if (hueSum < 360) meanHue = (hueSum + 360) / 2;
  else meanHue = (hueSum - 360) / 2;

  const t =
    1 -
    0.17 * cosDeg(meanHue - 30) +
    0.24 * cosDeg(2 * meanHue) +
    0.32 * cosDeg(3 * meanHue + 6) -
    0.2 * cosDeg(4 * meanHue - 63);

  const deltaTheta = 30 * Math.exp(-(((meanHue - 275) / 25) ** 2));
  const meanC7 = meanC ** 7;
  const rc = 2 * Math.sqrt(meanC7 / (meanC7 + POW_25_7));

  const sL = 1 + (0.015 * (meanL - 50) ** 2) / Math.sqrt(20 + (meanL - 50) ** 2);
  const sC = 1 + 0.045 * meanC;
  const sH = 1 + 0.015 * meanC * t;
  const rt = -Math.sin(2 * deltaTheta * RAD_PER_DEG) * rc;

  const termL = deltaL / sL;
  const termC = deltaC / sC;
  const termH = deltaH / sH;

  return { termL, termC, termH, rt };
}

/**
 * CIEDE2000 with kL = kC = kH = 1. Symmetric to the bit: every term that changes
 * sign under swapping the arguments appears either squared or as a product of
 * two such terms.
 */
export function ciede2000(a: Lab, b: Lab): number {
  const { termL, termC, termH, rt } = ciede2000Terms(a, b);
  return Math.sqrt(termL * termL + termC * termC + termH * termH + rt * termC * termH);
}

/**
 * How much of the ΔE00 each axis accounts for: the magnitude of that axis's
 * weighted term, which is the distance that axis's error would contribute on its
 * own. Their quadrature sum is the full ΔE00 up to the `R_T` rotation term, which
 * is zero unless *both* chroma and hue err and only bites near hue 275° (blue);
 * folding it in would rob the axis attribution of its meaning, so it is dropped
 * here. This drives the reveal breakdown, never the score — the score stays the
 * exact `ciede2000` total (`src/domain/scoring.ts`).
 */
export type DeltaComponents = {
  readonly lightness: number;
  readonly chroma: number;
  readonly hue: number;
};

export function ciede2000Components(a: Lab, b: Lab): DeltaComponents {
  const { termL, termC, termH } = ciede2000Terms(a, b);
  return { lightness: Math.abs(termL), chroma: Math.abs(termC), hue: Math.abs(termH) };
}

/**
 * Euclidean distance in OKLab — the metric CSS Color 4 uses for gamut mapping,
 * where one JND is ~0.02.
 *
 * This is *not* an interchangeable cheaper ΔE00: OKLab weights chroma and hue
 * errors equally everywhere, while ΔE00 forgives them on saturated colours and
 * punishes them on near-neutrals. The measured ratio between the two spans
 * 0.9–2.4 (`color-science.md` §1.5), so there is no scaling constant that makes
 * one substitute for the other. Use it for gamut decisions, not for scoring.
 */
export function deltaEOk(a: Oklab, b: Oklab): number {
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}
