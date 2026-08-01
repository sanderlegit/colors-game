/**
 * Target-colour generation (SPEC §5.1, research `color-science.md` §5).
 *
 * ## Why not uniform in the sRGB cube
 *
 * Because it produces mud with a lopsided hue wheel. Measured over 200k samples:
 * greens take 18.6% of the wheel against a uniform 8.3% while azures take 4.1%
 * — a 4.5× spread that comes from the cube's geometry, not from perception. The
 * median OKLCh chroma is 0.147 and only 7.4% of samples clear C = 0.25, so most
 * of the cube is grey-brown. That is a dreary game.
 *
 * ## The construction
 *
 * Sample `L` and `h` freely, then take chroma as a *fraction of what the gamut
 * offers there*: `C = t · maxChroma(L, h)`.
 *
 * A fixed chroma cap cannot work: `maxChroma` swings ~13× across `(L, h)`, from
 * 0.024 at light red to ~0.32 at dark blue, and the cusp sits at a different
 * lightness for every hue. Any constant that keeps teal in gamut makes every
 * other hue pastel. Expressing chroma as a fraction gives uniform hue coverage
 * by construction, uses the whole gamut at every hue, and — the point of the
 * whole exercise — turns `t` into a hue-independent difficulty dial: `t = 0.9`
 * means "vivid" whether the hue is yellow or teal, though the absolute chroma
 * differs by 2×.
 *
 * Targets are therefore in gamut by construction and never need chroma
 * reduction: `t < 1` and `maxChroma` returns an in-gamut chroma by bisection.
 */

import { maxChroma } from "@/color/gamut";
import { type Oklch, oklch } from "@/color/types";
import { makeRng, mixSeed, nextInRange } from "@/domain/rng";

export type Difficulty = "easy" | "normal" | "hard";

type Range = { readonly min: number; readonly max: number };

export type Tier = {
  /** OKLab lightness, 0..1. Kept away from both extremes: `maxChroma → 0` there. */
  readonly lightness: Range;
  /** Fraction of `maxChroma(L, h)` — the difficulty dial. */
  readonly chromaFraction: Range;
  /**
   * Salt for this tier's random stream. Every value differs from the picker's
   * `0x50494b52` (`src/domain/state.ts`), so a target can never track the
   * starting hue of the picker that is used to guess it; and they differ from
   * each other, so replaying a seed on a harder tier is a genuinely different
   * game rather than the same hues with the chroma turned down.
   */
  readonly stream: number;
};

/**
 * The tiers, as a data table — SPEC §5.1 requires this to be data, so that a
 * playtest retune is an edit here and not a new code path to re-test.
 *
 * Ranges are the research doc's §5.3 recommendations. `normal` is its "Medium"
 * row, renamed to match the three-way difficulty the UI exposes. Its "Expert"
 * row is deliberately absent: on top of a narrower `t` it needs the hue
 * constrained to a band *across a session*, which is a property of a run rather
 * than of one round, and `generateTarget` sees only `(seed, roundIndex)`.
 *
 * The axis is chroma, not hue or lightness, and that rests on evidence rather
 * than on feel: colour memory stores a coarse category label plus a noisy
 * particular, and working memory amplifies the category bias (Bae, Olkkonen,
 * Allred & Flombaum 2015). Desaturating weakens the label, so low `t` is
 * genuinely harder to remember — not merely harder to see.
 */
export const TIERS: Record<Difficulty, Tier> = {
  // Vivid and mid-lightness: strong category labels ("red", "teal") that are
  // easy to rehearse verbally through the memorize phase.
  easy: {
    lightness: { min: 0.45, max: 0.75 },
    chromaFraction: { min: 0.8, max: 1 },
    stream: 0x54474531,
  },
  // Recognisable, but needs a modifier — "dusty rose", "deep olive".
  normal: {
    lightness: { min: 0.35, max: 0.85 },
    chromaFraction: { min: 0.45, max: 0.9 },
    stream: 0x54474532,
  },
  // Desaturated muddy mid-tones with weak category labels.
  hard: {
    lightness: { min: 0.25, max: 0.9 },
    chromaFraction: { min: 0.12, max: 0.5 },
    stream: 0x54474533,
  },
};

export const DEFAULT_DIFFICULTY: Difficulty = "normal";

/**
 * The target for one round. Pure in `(seed, roundIndex, difficulty)` per SPEC
 * §5.1, and a `TargetFn` (`src/domain/state.ts`) because `difficulty` defaults.
 *
 * The seed is mixed with the round index so consecutive rounds are uncorrelated,
 * then with the tier's salt so this stream is independent of the picker's.
 */
export function generateTarget(
  seed: number,
  roundIndex: number,
  difficulty: Difficulty = DEFAULT_DIFFICULTY,
): Oklch {
  const tier = TIERS[difficulty];
  const rng = makeRng(mixSeed(mixSeed(seed, roundIndex), tier.stream));
  const lightness = nextInRange(rng, tier.lightness.min, tier.lightness.max);
  const hue = nextInRange(rng, 0, 360);
  const fraction = nextInRange(rng, tier.chromaFraction.min, tier.chromaFraction.max);
  return oklch(lightness, fraction * maxChroma(lightness, hue), hue);
}
