/**
 * The colour conversion chain — one pure function per hop.
 *
 * Constants come from the CSS Color 4 reference implementation
 * (https://drafts.csswg.org/css-color-4/conversions.js) as recorded in
 * `docs/research/color-science.md` §3. Two choices there are load-bearing and
 * easy to get wrong:
 *
 * 1. The sRGB transfer function has **two different thresholds** — 0.04045 when
 *    decoding, 0.0031308 when encoding. They are not each other's images; the
 *    sRGB standard rounds them independently. One shared constant is a bug.
 * 2. `Lab` here is **D65 with no chromatic adaptation**, because we score sRGB
 *    colours and sRGB's own white is D65. CSS's `lab()` function is D50 (via
 *    Bradford) and disagrees substantially — `#0000FF` is L*=32.30 here and
 *    L*=29.57 there. Never compare values across the two.
 */

import {
  type Lab,
  type LinearRgb,
  lab,
  linearRgb,
  type Oklab,
  type Oklch,
  oklab,
  oklch,
  type Srgb,
  srgb,
  type Xyz,
  xyz,
} from "@/color/types";

type Row3 = readonly [number, number, number];
type Mat3 = readonly [Row3, Row3, Row3];

function transform(m: Mat3, v: Row3): Row3 {
  const [r0, r1, r2] = m;
  const [x, y, z] = v;
  return [
    r0[0] * x + r0[1] * y + r0[2] * z,
    r1[0] * x + r1[1] * y + r1[2] * z,
    r2[0] * x + r2[1] * y + r2[2] * z,
  ];
}

const SRGB_DECODE_THRESHOLD = 0.04045;
const SRGB_ENCODE_THRESHOLD = 0.0031308;

/** Exact rationals — the CIE defines them this way; the decimals are derived. */
const LAB_EPSILON = 216 / 24389;
const LAB_KAPPA = 24389 / 27;

/** D65 from the CSS spec's 4-figure chromaticities x=0.3127, y=0.3290. */
const D65_X = 0.3127 / 0.329;
const D65_Y = 1;
const D65_Z = (1 - 0.3127 - 0.329) / 0.329;

const DEG_PER_RAD = 180 / Math.PI;
const RAD_PER_DEG = Math.PI / 180;

/**
 * Below this chroma, OKLCh hue is pure floating-point noise (an exactly neutral
 * grey lands wherever the last rounding error puts it). CSS's reference code
 * returns `NaN` there; we return `h = 0` instead, because a `NaN` hue poisons
 * every downstream average, slider position and interpolation, and the failure
 * surfaces far from its cause. At `C = 0` the hue is unobservable anyway, so 0
 * is as good as any value and it keeps the type total.
 */
export const OKLCH_HUE_EPSILON = 0.000004;

const LINEAR_TO_XYZ: Mat3 = [
  [506752 / 1228815, 87881 / 245763, 12673 / 70218],
  [87098 / 409605, 175762 / 245763, 12673 / 175545],
  [7918 / 409605, 87881 / 737289, 1001167 / 1053270],
];

const XYZ_TO_LINEAR: Mat3 = [
  [12831 / 3959, -329 / 214, -1974 / 3959],
  [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
  [705 / 12673, -2585 / 12673, 705 / 667],
];

/** Recalculated by the CSS WG for 64-bit precision, so greys stay exactly neutral. */
const XYZ_TO_LMS: Mat3 = [
  [0.819022437996703, 0.3619062600528904, -0.1288737815209879],
  [0.0329836539323885, 0.9292868615863434, 0.0361446663506424],
  [0.0481771893596242, 0.2642395317527308, 0.6335478284694309],
];

const LMS_TO_OKLAB: Mat3 = [
  [0.210454268309314, 0.7936177747023054, -0.0040720430116193],
  [1.9779985324311684, -2.42859224204858, 0.450593709617411],
  [0.0259040424655478, 0.7827717124575296, -0.8086757549230774],
];

const OKLAB_TO_LMS: Mat3 = [
  [1, 0.3963377773761749, 0.2158037573099136],
  [1, -0.1055613458156586, -0.0638541728258133],
  [1, -0.0894841775298119, -1.2914855480194092],
];

const LMS_TO_XYZ: Mat3 = [
  [1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
  [-0.0405757452148008, 1.112286803280317, -0.0717110580655164],
  [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816],
];

/**
 * Out-of-range channels are mirrored through the origin rather than clamped, as
 * the CSS reference code does: negative light is meaningful during intermediate
 * arithmetic, and clamping here would silently move the colour.
 */
function decodeChannel(v: number): number {
  const magnitude = Math.abs(v);
  if (magnitude <= SRGB_DECODE_THRESHOLD) return v / 12.92;
  return Math.sign(v) * ((magnitude + 0.055) / 1.055) ** 2.4;
}

function encodeChannel(u: number): number {
  const magnitude = Math.abs(u);
  if (magnitude <= SRGB_ENCODE_THRESHOLD) return u * 12.92;
  return Math.sign(u) * (1.055 * magnitude ** (1 / 2.4) - 0.055);
}

function labF(t: number): number {
  return t > LAB_EPSILON ? Math.cbrt(t) : (LAB_KAPPA * t + 16) / 116;
}

/** Degrees in `[0, 360)`. Guards the case where a tiny negative rounds up to 360. */
function normalizeHue(degrees: number): number {
  const wrapped = degrees % 360;
  const positive = wrapped < 0 ? wrapped + 360 : wrapped;
  return positive >= 360 ? 0 : positive;
}

export function srgbToLinear(c: Srgb): LinearRgb {
  return linearRgb(decodeChannel(c.r), decodeChannel(c.g), decodeChannel(c.b));
}

export function linearToSrgb(c: LinearRgb): Srgb {
  return srgb(encodeChannel(c.r), encodeChannel(c.g), encodeChannel(c.b));
}

export function linearToXyz(c: LinearRgb): Xyz {
  const [x, y, z] = transform(LINEAR_TO_XYZ, [c.r, c.g, c.b]);
  return xyz(x, y, z);
}

export function xyzToLinear(c: Xyz): LinearRgb {
  const [r, g, b] = transform(XYZ_TO_LINEAR, [c.x, c.y, c.z]);
  return linearRgb(r, g, b);
}

export function xyzToLab(c: Xyz): Lab {
  const fx = labF(c.x / D65_X);
  const fy = labF(c.y / D65_Y);
  const fz = labF(c.z / D65_Z);
  return lab(116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz));
}

export function labToXyz(c: Lab): Xyz {
  const fy = (c.L + 16) / 116;
  const fx = c.a / 500 + fy;
  const fz = fy - c.b / 200;
  const xr = fx ** 3 > LAB_EPSILON ? fx ** 3 : (116 * fx - 16) / LAB_KAPPA;
  const yr = c.L > LAB_KAPPA * LAB_EPSILON ? fy ** 3 : c.L / LAB_KAPPA;
  const zr = fz ** 3 > LAB_EPSILON ? fz ** 3 : (116 * fz - 16) / LAB_KAPPA;
  return xyz(xr * D65_X, yr * D65_Y, zr * D65_Z);
}

/**
 * Routed through XYZ with the CSS matrices rather than Ottosson's direct ones:
 * the blog matrices carry ~7 significant figures, so a neutral grey comes out
 * slightly non-neutral (|a|,|b| ~ 3.7e-8 vs ~5e-16 here).
 *
 * `Math.cbrt` — not `x ** (1/3)`, which is `NaN` for the negative LMS values
 * that near- and out-of-gamut colours produce.
 */
export function linearToOklab(c: LinearRgb): Oklab {
  const { x, y, z } = linearToXyz(c);
  const [l, m, s] = transform(XYZ_TO_LMS, [x, y, z]);
  const [L, a, b] = transform(LMS_TO_OKLAB, [Math.cbrt(l), Math.cbrt(m), Math.cbrt(s)]);
  return oklab(L, a, b);
}

export function oklabToLinear(c: Oklab): LinearRgb {
  const [l, m, s] = transform(OKLAB_TO_LMS, [c.L, c.a, c.b]);
  const [x, y, z] = transform(LMS_TO_XYZ, [l ** 3, m ** 3, s ** 3]);
  return xyzToLinear(xyz(x, y, z));
}

export function oklabToOklch(c: Oklab): Oklch {
  const chroma = Math.hypot(c.a, c.b);
  const hue = chroma <= OKLCH_HUE_EPSILON ? 0 : normalizeHue(Math.atan2(c.b, c.a) * DEG_PER_RAD);
  return oklch(c.L, chroma, hue);
}

export function oklchToOklab(c: Oklch): Oklab {
  const radians = c.h * RAD_PER_DEG;
  return oklab(c.L, c.c * Math.cos(radians), c.c * Math.sin(radians));
}

export function srgbToOklch(c: Srgb): Oklch {
  return oklabToOklch(linearToOklab(srgbToLinear(c)));
}

export function oklchToSrgb(c: Oklch): Srgb {
  return linearToSrgb(oklabToLinear(oklchToOklab(c)));
}

export function srgbToLab(c: Srgb): Lab {
  return xyzToLab(linearToXyz(srgbToLinear(c)));
}

export function oklchToLab(c: Oklch): Lab {
  return xyzToLab(linearToXyz(oklabToLinear(oklchToOklab(c))));
}
