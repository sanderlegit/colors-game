/**
 * Turning "how different do these look" into 0–100 (SPEC §6, ADR 0004).
 *
 * Two decisions live here and both are binding:
 *
 * 1. **The metric is CIEDE2000 on D65 CIELAB**, `kL = kC = kH = 1`. CIE94 was
 *    rejected because its `S_C`/`S_H` weight the *reference* colour's chroma, so
 *    `ΔE(a, b) ≠ ΔE(b, a)`. In a game neither colour is privileged — target and
 *    guess are just two colours — so a score that depends on argument order is
 *    indefensible. `symmetric` is therefore an asserted invariant, not a
 *    coincidence of the implementation.
 * 2. **D65, never D50.** `oklchToLab` goes through XYZ with no chromatic
 *    adaptation, which is what ADR 0004 requires. CSS's `lab()` is D50 and puts
 *    sRGB blue at L* 29.57 instead of 32.30 — the single most likely way for
 *    this module to be quietly wrong, and invisible if you only eyeball outputs.
 *
 * The curve constants below are the tuning surface. Retuning is a one-line
 * change; the property tests around it hold whatever the numbers become.
 */

import { oklchToLab } from "@/color/convert";
import { ciede2000 } from "@/color/deltaE";
import type { Oklch } from "@/color/types";

/**
 * ΔE00 below which a guess is worth a full 100 (`d₀` in the research doc).
 *
 * Paravina et al. 2015 measured the 50:50 perceptibility threshold at 0.8 and
 * W3C treats 2 as one JND; 1 sits between them. Being told you scored 97 for a
 * miss no human eye can resolve reads as the game being broken, not as
 * precision — this is the constant to leave alone.
 */
export const SCORE_DEADBAND = 1;

/**
 * The generosity knob (`τ`). Larger is kinder: at 18 a ΔE00 of 12 scores 67
 * rather than 54, and a random guess beats 50 points 6.8% of the time instead of
 * 5.4%. Vary this per difficulty tier if tiers ever need to move the curve —
 * never change the shape.
 */
export const SCORE_SCALE = 16;

/**
 * The shape (`k`), and the one genuinely tuned number. A Gaussian (k = 2) puts
 * chance level at ΔE00 ≈ 19 and lets a random guess score over 50 about 12% of
 * the time, which makes a good score meaningless. A plain exponential (k = 1)
 * charges 6 points for a barely-perceptible ΔE00 of 2, so near-misses feel
 * unrewarded. 1.3 is flat at the top, steep through the middle, and bottoms out.
 */
export const SCORE_EXPONENT = 1.3;

/** What the scorer returns: the perceptual distance and the points it earned. */
export type Score = { readonly deltaE: number; readonly score: number };

/**
 * The score curve alone, so it can be tested and plotted without a colour.
 *
 * Total by construction, and the range is exactly [0, 100]:
 *
 * - `+Infinity` falls out of the maths as 0 — an infinitely wrong guess.
 * - Negative input, including `-Infinity`, lands inside the deadband and scores
 *   100. A negative distance is not a thing CIEDE2000 can produce, and the
 *   honest reading of "closer than zero" is "as close as it gets".
 * - `NaN` scores 0, by explicit guard rather than by arithmetic. It cannot arise
 *   from `ciede2000`, but a caller that manages it deserves a number rather than
 *   a `NaN` that silently poisons a running total all the way to the summary.
 */
export function scoreFromDelta(deltaE: number): number {
  if (Number.isNaN(deltaE)) return 0;
  const excess = Math.max(0, deltaE - SCORE_DEADBAND);
  return 100 * Math.exp(-((excess / SCORE_SCALE) ** SCORE_EXPONENT));
}

/**
 * Score a guess against a target. Structurally a `ScoreFn` (`src/domain/state.ts`);
 * the state machine deliberately does not import this module, so the compatibility
 * is asserted in the tests instead of by a shared import.
 */
export function scoreGuess(target: Oklch, guess: Oklch): Score {
  const deltaE = ciede2000(oklchToLab(target), oklchToLab(guess));
  return { deltaE, score: scoreFromDelta(deltaE) };
}
