/**
 * Reference data for the colour tests, transcribed from
 * `docs/research/test-vectors.md`.
 *
 * Every fixture carries its own provenance, because the two kinds are not
 * interchangeable and the distinction is easy to lose once the numbers are in a
 * `.ts` file:
 *
 * - `VERIFIED` — retrieved verbatim from a primary source, or cross-checked
 *   against a value that source publishes. A failure here is our bug.
 * - `UNVERIFIED_COMPUTED` — produced by the research pass's own reference
 *   implementation and self-consistent, but never compared against an external
 *   published table. A failure here means *something changed*; it does not by
 *   itself prove which side is wrong.
 *
 * Do not promote a row from the second group to the first without a citation.
 */

export type Provenance = "VERIFIED" | "UNVERIFIED_COMPUTED";

export type Fixture<T> = {
  readonly provenance: Provenance;
  readonly source: string;
  /** The tightest assertion the published precision supports. */
  readonly tolerance: number;
  readonly rows: readonly T[];
};

/** `[L1, a1, b1, L2, a2, b2, expectedDeltaE00]`, with kL = kC = kH = 1. */
export type Ciede2000Row = readonly [number, number, number, number, number, number, number];

export type XyzToOklabRow = {
  readonly xyz: readonly [number, number, number];
  readonly oklab: readonly [number, number, number];
};

export type SrgbToXyzRow = {
  readonly name: string;
  readonly hex: string;
  readonly rgb8: readonly [number, number, number];
  readonly linear: readonly [number, number, number];
  readonly xyz: readonly [number, number, number];
};

/** `hue` is `null` where chroma is zero and the hue is therefore undefined. */
export type PolarRow = {
  readonly name: string;
  readonly hex: string;
  readonly L: number;
  readonly a: number;
  readonly b: number;
  readonly chroma: number;
  readonly hue: number | null;
};

/**
 * Sharma, Wu & Dalal's 34-pair set. Pairs 1–24 are the supplementary data that
 * exists precisely because pairs 25–34 (the original CIE worked examples) fail
 * to exercise signed ΔH′/ΔC′, four-quadrant `atan2`, the four-case mean hue, or
 * the neutral-colour special case — several published implementations passed
 * 25–34 while being wrong.
 *
 * The ΔE00 column is published to 4 decimals, so 5e-5 is the tightest
 * meaningful bound and also the loosest defensible one: Sharma et al. warn that
 * *"even discrepancies in the fourth place should not be ignored."*
 */
export const SHARMA_CIEDE2000: Fixture<Ciede2000Row> = {
  provenance: "VERIFIED",
  source:
    "Sharma, Wu & Dalal (2005), ciede2000testdata.txt — https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/dataNprograms/ciede2000testdata.txt",
  tolerance: 5e-5,
  rows: [
    [50.0, 2.6772, -79.7751, 50.0, 0.0, -82.7485, 2.0425],
    [50.0, 3.1571, -77.2803, 50.0, 0.0, -82.7485, 2.8615],
    [50.0, 2.8361, -74.02, 50.0, 0.0, -82.7485, 3.4412],
    [50.0, -1.3802, -84.2814, 50.0, 0.0, -82.7485, 1.0],
    [50.0, -1.1848, -84.8006, 50.0, 0.0, -82.7485, 1.0],
    [50.0, -0.9009, -85.5211, 50.0, 0.0, -82.7485, 1.0],
    [50.0, 0.0, 0.0, 50.0, -1.0, 2.0, 2.3669],
    [50.0, -1.0, 2.0, 50.0, 0.0, 0.0, 2.3669],
    [50.0, 2.49, -0.001, 50.0, -2.49, 0.0009, 7.1792],
    [50.0, 2.49, -0.001, 50.0, -2.49, 0.001, 7.1792],
    [50.0, 2.49, -0.001, 50.0, -2.49, 0.0011, 7.2195],
    [50.0, 2.49, -0.001, 50.0, -2.49, 0.0012, 7.2195],
    [50.0, -0.001, 2.49, 50.0, 0.0009, -2.49, 4.8045],
    [50.0, -0.001, 2.49, 50.0, 0.001, -2.49, 4.8045],
    [50.0, -0.001, 2.49, 50.0, 0.0011, -2.49, 4.7461],
    [50.0, 2.5, 0.0, 50.0, 0.0, -2.5, 4.3065],
    [50.0, 2.5, 0.0, 73.0, 25.0, -18.0, 27.1492],
    [50.0, 2.5, 0.0, 61.0, -5.0, 29.0, 22.8977],
    [50.0, 2.5, 0.0, 56.0, -27.0, -3.0, 31.903],
    [50.0, 2.5, 0.0, 58.0, 24.0, 15.0, 19.4535],
    [50.0, 2.5, 0.0, 50.0, 3.1736, 0.5854, 1.0],
    [50.0, 2.5, 0.0, 50.0, 3.2972, 0.0, 1.0],
    [50.0, 2.5, 0.0, 50.0, 1.8634, 0.5757, 1.0],
    [50.0, 2.5, 0.0, 50.0, 3.2592, 0.335, 1.0],
    [60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644],
    [63.0109, -31.0961, -5.8663, 62.8187, -29.7946, -4.0864, 1.263],
    [61.2901, 3.7196, -5.3901, 61.4292, 2.248, -4.962, 1.8731],
    [35.0831, -44.1164, 3.7933, 35.0232, -40.0716, 1.5901, 1.8645],
    [22.7233, 20.0904, -46.694, 23.0331, 14.973, -42.5619, 2.0373],
    [36.4612, 47.858, 18.3852, 36.2715, 50.5065, 21.2231, 1.4146],
    [90.8027, -2.0831, 1.441, 91.1528, -1.6435, 0.0447, 1.4441],
    [90.9257, -0.5406, -0.9208, 88.6381, -0.8985, -0.7239, 1.5381],
    [6.7747, -0.2908, -2.4247, 5.8714, -0.0985, -2.2286, 0.6377],
    [2.0776, 0.0795, -1.135, 0.9033, -0.0636, -0.5514, 0.9082],
  ],
};

/**
 * Ottosson's published OKLab examples. Rows 2–4 are deliberately non-physical
 * XYZ — they drive LMS negative and so catch `x ** (1/3)` (which is `NaN`)
 * being used in place of the sign-matched `Math.cbrt`.
 */
export const OTTOSSON_XYZ_TO_OKLAB: Fixture<XyzToOklabRow> = {
  provenance: "VERIFIED",
  source: 'Björn Ottosson, "A perceptual color space for image processing" — numerical examples',
  tolerance: 1e-3,
  rows: [
    { xyz: [0.95, 1.0, 1.089], oklab: [1.0, 0.0, 0.0] },
    { xyz: [1.0, 0.0, 0.0], oklab: [0.45, 1.236, -0.019] },
    { xyz: [0.0, 1.0, 0.0], oklab: [0.922, -0.671, 0.263] },
    { xyz: [0.0, 0.0, 1.0], oklab: [0.153, -1.415, -0.449] },
  ],
};

/**
 * The only sRGB→OKLCh numbers published by a standards body. They validate the
 * whole chain end to end — 8-bit sRGB → linear → XYZ → OKLab → polar — which is
 * why they are worth more than the far larger computed tables below.
 *
 * `blueCieLchHue` is **D50-referenced**, as CSS's `lab()`/`lch()` are. Our
 * `srgbToLab` is D65 with no adaptation and gives 306.29° for the same colour;
 * the two are not comparable and neither is wrong. See `color-science.md` §3.3.
 */
export const W3C_CHAIN_CHECKS = {
  provenance: "VERIFIED",
  source: "CSS Color Module Level 4 §14.1.6 and its worked colour literals",
  blue: { hex: "#0000FF", L: 0.452, chroma: 0.313, hue: 264.06, tolerance: 5e-3 },
  yellow: { hex: "#FFFF00", L: 0.968, chroma: 0.211, hue: 109.8, tolerance: 5e-3 },
  blueCieLchHueD50: 301.37,
  /**
   * Linear-light `(0.5, 1, 3)` is out of gamut at OKLCh hue 265.1°. Clamping the
   * blue channel to 1 moves it to 196.1° — the spec's own demonstration that
   * channel clamping is not a gamut-mapping strategy.
   */
  clampingDemo: {
    outOfGamutLinear: [0.5, 1, 3],
    clampedLinear: [0.5, 1, 1],
    outOfGamutHue: 265.1,
    clampedHue: 196.1,
    tolerance: 0.05,
  },
} as const;

export const SRGB_TO_XYZ: Fixture<SrgbToXyzRow> = {
  provenance: "UNVERIFIED_COMPUTED",
  source: "docs/research/test-vectors.md §5 (CSS Color 4 exact rational matrix)",
  tolerance: 1e-8,
  rows: [
    {
      name: "black",
      hex: "#000000",
      rgb8: [0, 0, 0],
      linear: [0, 0, 0],
      xyz: [0, 0, 0],
    },
    {
      name: "white",
      hex: "#FFFFFF",
      rgb8: [255, 255, 255],
      linear: [1, 1, 1],
      xyz: [0.95045593, 1.0, 1.08905775],
    },
    {
      name: "red",
      hex: "#FF0000",
      rgb8: [255, 0, 0],
      linear: [1, 0, 0],
      xyz: [0.4123908, 0.21263901, 0.01933082],
    },
    {
      name: "lime",
      hex: "#00FF00",
      rgb8: [0, 255, 0],
      linear: [0, 1, 0],
      xyz: [0.35758434, 0.71516868, 0.11919478],
    },
    {
      name: "blue",
      hex: "#0000FF",
      rgb8: [0, 0, 255],
      linear: [0, 0, 1],
      xyz: [0.18048079, 0.07219232, 0.95053215],
    },
    {
      name: "yellow",
      hex: "#FFFF00",
      rgb8: [255, 255, 0],
      linear: [1, 1, 0],
      xyz: [0.76997514, 0.92780768, 0.1385256],
    },
    {
      name: "cyan",
      hex: "#00FFFF",
      rgb8: [0, 255, 255],
      linear: [0, 1, 1],
      xyz: [0.53806513, 0.78736099, 1.06972693],
    },
    {
      name: "magenta",
      hex: "#FF00FF",
      rgb8: [255, 0, 255],
      linear: [1, 0, 1],
      xyz: [0.59287159, 0.28483132, 0.96986297],
    },
    {
      name: "gray 50%",
      hex: "#808080",
      rgb8: [128, 128, 128],
      linear: [0.2158605, 0.2158605, 0.2158605],
      xyz: [0.20516589, 0.2158605, 0.23508455],
    },
    {
      name: "silver",
      hex: "#C0C0C0",
      rgb8: [192, 192, 192],
      linear: [0.52711513, 0.52711513, 0.52711513],
      xyz: [0.5009997, 0.52711513, 0.57405881],
    },
    {
      name: "dimgray",
      hex: "#696969",
      rgb8: [105, 105, 105],
      linear: [0.14126329, 0.14126329, 0.14126329],
      xyz: [0.13426453, 0.14126329, 0.15384388],
    },
    {
      name: "rebeccapurple",
      hex: "#663399",
      rgb8: [102, 51, 153],
      linear: [0.13286832, 0.03310477, 0.31854678],
      xyz: [0.12412299, 0.07492511, 0.30930332],
    },
    {
      name: "tomato",
      hex: "#FF6347",
      rgb8: [255, 99, 71],
      linear: [1.0, 0.12477182, 0.06301002],
      xyz: [0.46837934, 0.30642074, 0.09409602],
    },
    {
      name: "teal",
      hex: "#008080",
      rgb8: [0, 128, 128],
      linear: [0, 0.2158605, 0.2158605],
      xyz: [0.11614701, 0.16996014, 0.23091179],
    },
    {
      name: "olive",
      hex: "#808000",
      rgb8: [128, 128, 0],
      linear: [0.2158605, 0.2158605, 0],
      xyz: [0.16620722, 0.20027703, 0.0299022],
    },
  ],
};

/**
 * D65 CIELab with **no chromatic adaptation** — what you want for scoring sRGB.
 * These are *not* CSS `lab()` values, which are D50 via Bradford: blue is
 * L*=32.30 here and L*=29.57 there.
 */
export const SRGB_TO_LAB_D65: Fixture<PolarRow> = {
  provenance: "UNVERIFIED_COMPUTED",
  source: "docs/research/test-vectors.md §6",
  tolerance: 1e-5,
  rows: [
    { name: "black", hex: "#000000", L: 0, a: 0, b: 0, chroma: 0, hue: null },
    { name: "white", hex: "#FFFFFF", L: 100, a: 0, b: 0, chroma: 0, hue: null },
    {
      name: "red",
      hex: "#FF0000",
      L: 53.237116,
      a: 80.090114,
      b: 67.203264,
      chroma: 104.550012,
      hue: 39.999865,
    },
    {
      name: "lime",
      hex: "#00FF00",
      L: 87.735519,
      a: -86.181597,
      b: 83.18662,
      chroma: 119.780138,
      hue: 136.013069,
    },
    {
      name: "blue",
      hex: "#0000FF",
      L: 32.300873,
      a: 79.19527,
      b: -107.855466,
      chroma: 133.808416,
      hue: 306.288803,
    },
    {
      name: "yellow",
      hex: "#FFFF00",
      L: 97.138559,
      a: -21.559971,
      b: 94.48384,
      chroma: 96.912478,
      hue: 102.85406,
    },
    {
      name: "cyan",
      hex: "#00FFFF",
      L: 91.114752,
      a: -48.078888,
      b: -14.128985,
      chroma: 50.111952,
      hue: 196.376526,
    },
    {
      name: "magenta",
      hex: "#FF00FF",
      L: 60.322731,
      a: 98.237444,
      b: -60.82891,
      chroma: 115.545453,
      hue: 328.234088,
    },
    { name: "gray 50%", hex: "#808080", L: 53.585013, a: 0, b: 0, chroma: 0, hue: null },
    { name: "silver", hex: "#C0C0C0", L: 77.704364, a: 0, b: 0, chroma: 0, hue: null },
    { name: "dimgray", hex: "#696969", L: 44.41356, a: 0, b: 0, chroma: 0, hue: null },
    {
      name: "rebeccapurple",
      hex: "#663399",
      L: 32.902807,
      a: 42.886507,
      b: -47.149133,
      chroma: 63.736122,
      hue: 312.289427,
    },
    {
      name: "tomato",
      hex: "#FF6347",
      L: 62.204314,
      a: 57.847106,
      b: 46.417821,
      chroma: 74.168064,
      hue: 38.744343,
    },
    {
      name: "teal",
      hex: "#008080",
      L: 48.255013,
      a: -28.841122,
      b: -8.475566,
      chroma: 30.060697,
      hue: 196.376526,
    },
    {
      name: "olive",
      hex: "#808000",
      L: 51.868519,
      a: -12.933197,
      b: 56.678097,
      chroma: 58.134966,
      hue: 102.85406,
    },
  ],
};

/**
 * OKLab/OKLCh with the CSS Color 4 recomputed (64-bit) matrices. `L` is 0..1.
 * The blue and yellow rows are the ones anchored to W3C-published values; the
 * rest are a regression baseline.
 */
export const SRGB_TO_OKLAB: Fixture<PolarRow> = {
  provenance: "UNVERIFIED_COMPUTED",
  source: "docs/research/test-vectors.md §7",
  // L/a/b/C are published to 8 decimals but the hue column only to 6, so the
  // rounding limit for the table as a whole is 5e-7.
  tolerance: 1e-6,
  rows: [
    { name: "black", hex: "#000000", L: 0, a: 0, b: 0, chroma: 0, hue: null },
    { name: "white", hex: "#FFFFFF", L: 1, a: 0, b: 0, chroma: 0, hue: null },
    {
      name: "red",
      hex: "#FF0000",
      L: 0.62795536,
      a: 0.22486307,
      b: 0.12584628,
      chroma: 0.2576833,
      hue: 29.23388,
    },
    {
      name: "lime",
      hex: "#00FF00",
      L: 0.86643962,
      a: -0.23388758,
      b: 0.17949845,
      chroma: 0.29482722,
      hue: 142.495345,
    },
    {
      name: "blue",
      hex: "#0000FF",
      L: 0.45201372,
      a: -0.03245698,
      b: -0.31152817,
      chroma: 0.31321439,
      hue: 264.052023,
    },
    {
      name: "yellow",
      hex: "#FFFF00",
      L: 0.96798273,
      a: -0.07136908,
      b: 0.19856972,
      chroma: 0.21100587,
      hue: 109.769236,
    },
    {
      name: "cyan",
      hex: "#00FFFF",
      L: 0.90539924,
      a: -0.14944394,
      b: -0.03939819,
      chroma: 0.15455002,
      hue: 194.76896,
    },
    {
      name: "magenta",
      hex: "#FF00FF",
      L: 0.70167386,
      a: 0.27456631,
      b: -0.16915608,
      chroma: 0.32249099,
      hue: 328.363415,
    },
    { name: "gray 50%", hex: "#808080", L: 0.59987081, a: 0, b: 0, chroma: 0, hue: null },
    { name: "silver", hex: "#C0C0C0", L: 0.80779624, a: 0, b: 0, chroma: 0, hue: null },
    { name: "dimgray", hex: "#696969", L: 0.52080655, a: 0, b: 0, chroma: 0, hue: null },
    {
      name: "rebeccapurple",
      hex: "#663399",
      L: 0.4402718,
      a: 0.08817676,
      b: -0.13386436,
      chroma: 0.160296,
      hue: 303.372988,
    },
    {
      name: "tomato",
      hex: "#FF6347",
      L: 0.69621935,
      a: 0.1652304,
      b: 0.10454086,
      chroma: 0.19552462,
      hue: 32.321434,
    },
    {
      name: "teal",
      hex: "#008080",
      L: 0.54312257,
      a: -0.08964706,
      b: -0.02363383,
      chroma: 0.09271005,
      hue: 194.76896,
    },
    {
      name: "olive",
      hex: "#808000",
      L: 0.58066458,
      a: -0.04281223,
      b: 0.11911618,
      chroma: 0.12657626,
      hue: 109.769236,
    },
  ],
};

export const MAX_CHROMA_HUES: readonly number[] = [
  0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330,
];

/**
 * Maximum in-gamut OKLCh chroma, indexed by the hues above. The 13× spread
 * across the table is the reason `maxChroma` has to exist at all — there is no
 * useful fixed chroma cap.
 *
 * The tolerance is 3e-3 rather than the 1e-3 the 3-decimal rounding suggests,
 * because the two bisections disagree about where the gamut ends: at the
 * published boundary for `L = 0.15` the green channel is already about -1e-3 in
 * gamma-encoded sRGB (measured), i.e. negative but under half an 8-bit code, so
 * it still *renders* as 0. Our `isInGamut` refuses it. The divergence is
 * therefore systematic and one-sided — our values are never larger — and it
 * concentrates at `L <= 0.25`, where the boundary is set by a channel going
 * slightly negative rather than by one saturating at 1. Every row from `L =
 * 0.35` up agrees to 6e-4.
 */
export const MAX_CHROMA_TABLE: Fixture<{ readonly L: number; readonly chroma: readonly number[] }> =
  {
    provenance: "UNVERIFIED_COMPUTED",
    source: "docs/research/color-science.md §5.2 (measured by bisection)",
    tolerance: 3e-3,
    rows: [
      {
        L: 0.15,
        chroma: [0.062, 0.063, 0.037, 0.032, 0.037, 0.043, 0.028, 0.027, 0.036, 0.1, 0.082, 0.07],
      },
      {
        L: 0.25,
        chroma: [0.102, 0.101, 0.059, 0.052, 0.06, 0.069, 0.046, 0.044, 0.058, 0.164, 0.134, 0.115],
      },
      {
        L: 0.35,
        chroma: [0.142, 0.141, 0.082, 0.072, 0.083, 0.097, 0.064, 0.061, 0.08, 0.23, 0.187, 0.16],
      },
      {
        L: 0.45,
        chroma: [0.183, 0.181, 0.106, 0.092, 0.107, 0.124, 0.082, 0.078, 0.103, 0.295, 0.24, 0.205],
      },
      {
        L: 0.55,
        chroma: [0.223, 0.221, 0.129, 0.112, 0.131, 0.152, 0.1, 0.095, 0.126, 0.248, 0.294, 0.251],
      },
      {
        L: 0.65,
        chroma: [0.26, 0.236, 0.153, 0.133, 0.154, 0.179, 0.118, 0.112, 0.149, 0.186, 0.221, 0.296],
      },
      {
        L: 0.75,
        chroma: [0.165, 0.151, 0.176, 0.153, 0.178, 0.207, 0.136, 0.13, 0.144, 0.128, 0.152, 0.247],
      },
      {
        L: 0.85,
        chroma: [
          0.089, 0.082, 0.101, 0.174, 0.202, 0.234, 0.154, 0.137, 0.083, 0.074, 0.087, 0.134,
        ],
      },
      {
        L: 0.95,
        chroma: [
          0.027, 0.025, 0.031, 0.064, 0.171, 0.083, 0.072, 0.044, 0.027, 0.024, 0.028, 0.041,
        ],
      },
    ],
  };
