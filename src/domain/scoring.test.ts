import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { oklchToLab } from "@/color/convert";
import { ciede2000 } from "@/color/deltaE";
import { clipChromaToGamut } from "@/color/gamut";
import { type Oklch, oklch } from "@/color/types";
import {
  SCORE_DEADBAND,
  SCORE_EXPONENT,
  SCORE_SCALE,
  scoreFromDelta,
  scoreGuess,
} from "@/domain/scoring";
import type { ScoreFn } from "@/domain/state";

/**
 * The state machine declares `ScoreFn` and refuses to import this module, so
 * nothing but this line proves the two still agree. It is a compile-time
 * assertion; the runtime call is only there to keep the binding alive.
 */
const asScoreFn: ScoreFn = scoreGuess;

const BLACK: Oklch = oklch(0, 0, 0);
const WHITE: Oklch = oklch(1, 0, 0);

const anyOklch = fc
  .record({
    L: fc.double({ min: 0.02, max: 0.98, noNaN: true }),
    c: fc.double({ min: 0, max: 0.4, noNaN: true }),
    h: fc.double({ min: 0, max: 359.999, noNaN: true }),
  })
  .map(({ L, c, h }) => clipChromaToGamut(oklch(L, c, h)));

const anyDelta = fc.double({ min: 0, max: 200, noNaN: true });

describe("curve constants", () => {
  it("are the values ADR 0004 fixed", () => {
    // Pinned so that a retune is a deliberate, visible change rather than a
    // silent drift in gameplay feel.
    expect(SCORE_DEADBAND).toBe(1);
    expect(SCORE_SCALE).toBe(16);
    expect(SCORE_EXPONENT).toBe(1.3);
  });
});

describe("scoreFromDelta — ADR 0004 reference points", () => {
  const REFERENCE: ReadonlyArray<readonly [number, number]> = [
    [2, 97],
    [5, 85],
    [12, 54],
    [20, 29],
    [45, 2],
  ];

  for (const [deltaE, expected] of REFERENCE) {
    it(`ΔE00 ${deltaE} scores ${expected}`, () => {
      expect(Math.round(scoreFromDelta(deltaE))).toBe(expected);
    });
  }

  it("bottoms out where the research table says it does", () => {
    // color-science.md §2.3: 60 → 0.4, 100 (black↔white) → 0.0.
    expect(scoreFromDelta(60)).toBeCloseTo(0.4, 1);
    expect(Math.round(scoreFromDelta(100))).toBe(0);
  });
});

describe("scoreFromDelta — the deadband", () => {
  it("gives a full 100 everywhere below the perceptibility threshold", () => {
    for (const deltaE of [0, 0.25, 0.8, 0.999999, SCORE_DEADBAND]) {
      expect(scoreFromDelta(deltaE)).toBe(100);
    }
  });

  it("gives a full 100 for a negative distance", () => {
    // Not reachable through `ciede2000`, but "closer than zero" can only mean
    // "as close as it gets" — the deadband already says so, so no extra clamp.
    expect(scoreFromDelta(-5)).toBe(100);
    expect(scoreFromDelta(Number.NEGATIVE_INFINITY)).toBe(100);
  });

  it("drops below 100 as soon as the deadband is cleared", () => {
    expect(scoreFromDelta(1.0001)).toBeLessThan(100);
  });
});

describe("scoreFromDelta — SPEC §6 invariants", () => {
  it("stays within [0, 100] for any finite distance", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), (deltaE) => {
        const score = scoreFromDelta(deltaE);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }),
    );
  });

  it("returns 0, not NaN, for a distance that is not a number", () => {
    // A NaN here would poison the running total silently, all the way to the
    // summary screen. Documented behaviour: an unevaluable guess earns nothing.
    expect(scoreFromDelta(Number.NaN)).toBe(0);
  });

  it("returns 0 for an infinite distance", () => {
    expect(scoreFromDelta(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("is monotonically non-increasing in the distance", () => {
    fc.assert(
      fc.property(anyDelta, anyDelta, (x, y) => {
        const [near, far] = x <= y ? [x, y] : [y, x];
        expect(scoreFromDelta(near)).toBeGreaterThanOrEqual(scoreFromDelta(far));
      }),
      { numRuns: 500 },
    );
  });

  it("is strictly decreasing once past the deadband", () => {
    // Monotonicity alone would be satisfied by a constant; this is what makes
    // the score carry information.
    let previous = scoreFromDelta(SCORE_DEADBAND);
    for (let deltaE = 2; deltaE <= 60; deltaE += 1) {
      const score = scoreFromDelta(deltaE);
      expect(score).toBeLessThan(previous);
      previous = score;
    }
  });
});

describe("scoreGuess", () => {
  it("satisfies ScoreFn", () => {
    expect(asScoreFn(BLACK, BLACK).score).toBe(100);
  });

  it("scores a colour against itself as exactly 100, with zero distance", () => {
    fc.assert(
      fc.property(anyOklch, (color) => {
        const result = scoreGuess(color, color);
        expect(result.deltaE).toBe(0);
        expect(result.score).toBe(100);
      }),
    );
  });

  it("is symmetric in its arguments, exactly", () => {
    // Non-negotiable, and the whole reason CIE94 was rejected (ADR 0004): its
    // S_C/S_H weight the *reference* colour's chroma, so swapping target and
    // guess changes the answer. Here the equality is bit-exact, not approximate.
    fc.assert(
      fc.property(anyOklch, anyOklch, (a, b) => {
        expect(scoreGuess(a, b)).toEqual(scoreGuess(b, a));
      }),
    );
  });

  it("keeps the score inside [0, 100] for any pair", () => {
    fc.assert(
      fc.property(anyOklch, anyOklch, (a, b) => {
        const { score } = scoreGuess(a, b);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }),
    );
  });

  it("is monotone in the guess: the worse the distance, the lower the score", () => {
    fc.assert(
      fc.property(anyOklch, anyOklch, anyOklch, (target, x, y) => {
        const first = scoreGuess(target, x);
        const second = scoreGuess(target, y);
        if (first.deltaE <= second.deltaE) {
          expect(first.score).toBeGreaterThanOrEqual(second.score);
        } else {
          expect(first.score).toBeLessThanOrEqual(second.score);
        }
      }),
    );
  });

  it("scores black against white at the published ΔE00 of exactly 100", () => {
    // color-science.md §1.4: ΔL′ = 100 with C′ = 0 makes S_L = 1, so the answer
    // is analytically exact. It is also the sharpest available check that the
    // Lab feeding CIEDE2000 is D65 with no adaptation.
    const { deltaE, score } = scoreGuess(BLACK, WHITE);
    expect(deltaE).toBeCloseTo(100, 6);
    expect(Math.round(score)).toBe(0);
  });

  it("reports the ΔE00 of the D65 Lab pair, unmodified", () => {
    // The reveal screen shows this number next to the score, so it has to be the
    // real metric rather than anything rescaled for display.
    fc.assert(
      fc.property(anyOklch, anyOklch, (a, b) => {
        expect(scoreGuess(a, b).deltaE).toBe(ciede2000(oklchToLab(a), oklchToLab(b)));
      }),
    );
  });

  it("still scores 100 for a guess nobody could see is wrong", () => {
    // A sub-JND miss earning less than full marks reads as the game being
    // broken. ~0.5 ΔE00 of lightness error at mid-grey sits under the deadband.
    const target = oklch(0.6, 0.1, 30);
    const nearMiss = oklch(0.6035, 0.1, 30);
    const { deltaE, score } = scoreGuess(target, nearMiss);
    expect(deltaE).toBeGreaterThan(0);
    expect(deltaE).toBeLessThan(SCORE_DEADBAND);
    expect(score).toBe(100);
  });
});
