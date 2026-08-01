import { describe, expect, it } from "vitest";
import { isInGamut, maxChroma } from "@/color/gamut";
import type { Oklch } from "@/color/types";
import { DEFAULT_DIFFICULTY, type Difficulty, generateTarget, TIERS } from "@/domain/round";
import { pickerStart, type TargetFn } from "@/domain/state";

/**
 * The state machine declares `TargetFn` and refuses to import this module, so
 * nothing but this line proves the two still agree — in particular that
 * `difficulty` stays optional.
 */
const asTargetFn: TargetFn = generateTarget;

const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];

/** Fixed seeds, so every assertion below is reproducible rather than sampled. */
function sample(count: number, difficulty?: Difficulty): Oklch[] {
  const out: Oklch[] = [];
  for (let index = 0; index < count; index++) {
    const seed = 41762 + index * 7919;
    out.push(
      difficulty === undefined
        ? generateTarget(seed, index % 5)
        : generateTarget(seed, index % 5, difficulty),
    );
  }
  return out;
}

describe("TIERS", () => {
  it("covers every difficulty with a usable range", () => {
    for (const difficulty of DIFFICULTIES) {
      const tier = TIERS[difficulty];
      expect(tier.lightness.min).toBeGreaterThan(0);
      expect(tier.lightness.max).toBeLessThan(1);
      expect(tier.lightness.max).toBeGreaterThan(tier.lightness.min);
      expect(tier.chromaFraction.min).toBeGreaterThan(0);
      expect(tier.chromaFraction.max).toBeLessThanOrEqual(1);
      expect(tier.chromaFraction.max).toBeGreaterThan(tier.chromaFraction.min);
    }
  });

  it("orders the difficulty by chroma, which is the axis memory cares about", () => {
    expect(TIERS.easy.chromaFraction.min).toBeGreaterThan(TIERS.normal.chromaFraction.min);
    expect(TIERS.normal.chromaFraction.min).toBeGreaterThan(TIERS.hard.chromaFraction.min);
    expect(TIERS.easy.chromaFraction.max).toBeGreaterThan(TIERS.normal.chromaFraction.max);
    expect(TIERS.normal.chromaFraction.max).toBeGreaterThan(TIERS.hard.chromaFraction.max);
  });

  it("widens the lightness range as difficulty rises", () => {
    const span = (difficulty: Difficulty): number =>
      TIERS[difficulty].lightness.max - TIERS[difficulty].lightness.min;
    expect(span("normal")).toBeGreaterThan(span("easy"));
    expect(span("hard")).toBeGreaterThan(span("normal"));
  });

  it("gives every tier a stream distinct from each other and from the picker's", () => {
    // `pickerStart` salts with 0x50494b52. A collision would make the target
    // track the picker's starting hue — a free win, every round.
    const streams = DIFFICULTIES.map((difficulty) => TIERS[difficulty].stream);
    expect(new Set(streams).size).toBe(streams.length);
    expect(streams).not.toContain(0x50494b52);
  });
});

describe("generateTarget — purity", () => {
  it("is deterministic in (seed, roundIndex, difficulty)", () => {
    for (const difficulty of DIFFICULTIES) {
      for (let round = 0; round < 5; round++) {
        expect(generateTarget(41762, round, difficulty)).toEqual(
          generateTarget(41762, round, difficulty),
        );
      }
    }
  });

  it("depends on nothing else — repeated calls interleaved still agree", () => {
    const first = generateTarget(7, 3, "hard");
    generateTarget(999, 1, "easy");
    generateTarget(1234, 0);
    expect(generateTarget(7, 3, "hard")).toEqual(first);
  });

  it("defaults to the normal tier and satisfies TargetFn", () => {
    expect(asTargetFn(41762, 2)).toEqual(generateTarget(41762, 2, DEFAULT_DIFFICULTY));
    expect(DEFAULT_DIFFICULTY).toBe("normal");
  });

  it("gives each tier its own stream", () => {
    const easy = generateTarget(41762, 0, "easy");
    const normal = generateTarget(41762, 0, "normal");
    const hard = generateTarget(41762, 0, "hard");
    expect(easy.h).not.toBe(normal.h);
    expect(normal.h).not.toBe(hard.h);
    expect(easy.h).not.toBe(hard.h);
  });
});

describe("generateTarget — round independence", () => {
  it("gives a different colour for every round of a game", () => {
    for (const difficulty of DIFFICULTIES) {
      const seen = new Set<string>();
      for (let round = 0; round < 50; round++) {
        const { L, c, h } = generateTarget(41762, round, difficulty);
        seen.add(`${L}|${c}|${h}`);
      }
      expect(seen.size).toBe(50);
    }
  });

  it("leaves consecutive rounds uncorrelated in hue", () => {
    // Deterministic sample, so this is a fixed computation and not a coin flip;
    // the tolerance is nonetheless ~5σ wide for n = 3000.
    const n = 3000;
    const first: number[] = [];
    const second: number[] = [];
    for (let index = 0; index < n; index++) {
      first.push(generateTarget(index, 0).h);
      second.push(generateTarget(index, 1).h);
    }
    expect(Math.abs(pearson(first, second))).toBeLessThan(0.1);
  });
});

describe("generateTarget — the gamut guarantee", () => {
  it("puts 10,000 targets inside sRGB, every one of them", () => {
    // The property that matters most: a target the player cannot physically
    // select with the picker is a broken round, not a hard one.
    const targets = [...sample(4000, "easy"), ...sample(3000, "normal"), ...sample(3000, "hard")];
    expect(targets).toHaveLength(10_000);
    expect(targets.filter((target) => !isInGamut(target))).toEqual([]);
  });

  it("never asks for a colour with no chroma to guess", () => {
    for (const difficulty of DIFFICULTIES) {
      for (const target of sample(300, difficulty)) {
        expect(target.c).toBeGreaterThan(0);
      }
    }
  });
});

describe("generateTarget — tier bounds", () => {
  for (const difficulty of DIFFICULTIES) {
    it(`keeps ${difficulty} inside its documented L and chroma-fraction ranges`, () => {
      const tier = TIERS[difficulty];
      for (const target of sample(800, difficulty)) {
        expect(target.L).toBeGreaterThanOrEqual(tier.lightness.min);
        expect(target.L).toBeLessThan(tier.lightness.max);

        // Recovering `t` exactly requires recomputing the same bisection, which
        // is deterministic; the epsilon only absorbs the division.
        const fraction = target.c / maxChroma(target.L, target.h);
        expect(fraction).toBeGreaterThanOrEqual(tier.chromaFraction.min - 1e-12);
        expect(fraction).toBeLessThanOrEqual(tier.chromaFraction.max + 1e-12);
      }
    });
  }
});

describe("generateTarget — hue coverage", () => {
  it("spreads hue evenly around the circle", () => {
    // The reason for the whole C = t · maxChroma(L, h) construction: uniform
    // sRGB-cube sampling gives greens 2.2× their share and azures half of it.
    const bins = 12;
    const total = 12_000;
    const counts = new Array<number>(bins).fill(0);
    for (let index = 0; index < total; index++) {
      const { h } = generateTarget(index, index % 5);
      const bin = Math.min(bins - 1, Math.floor((h / 360) * bins));
      counts[bin] = (counts[bin] ?? 0) + 1;
    }

    const expected = total / bins;
    for (const count of counts) {
      expect(count).toBeGreaterThan(expected * 0.85);
      expect(count).toBeLessThan(expected * 1.15);
    }
  });

  it("reaches both the light and the dark end of each tier", () => {
    for (const difficulty of DIFFICULTIES) {
      const tier = TIERS[difficulty];
      const lightnesses = sample(500, difficulty).map((target) => target.L);
      const span = tier.lightness.max - tier.lightness.min;
      expect(Math.min(...lightnesses)).toBeLessThan(tier.lightness.min + span * 0.05);
      expect(Math.max(...lightnesses)).toBeGreaterThan(tier.lightness.max - span * 0.05);
    }
  });
});

describe("generateTarget vs pickerStart", () => {
  it("never starts the player on the answer", () => {
    // SPEC §5.3: the picker starts at C = 0, so it can only coincide with a
    // target that has no chroma — which the gamut guarantee already forbids.
    for (const difficulty of DIFFICULTIES) {
      for (let seed = 0; seed < 500; seed++) {
        for (let round = 0; round < 5; round++) {
          const target = generateTarget(seed, round, difficulty);
          const start = pickerStart(seed, round);
          expect(target).not.toEqual(start);
          expect(target.c).not.toBe(start.c);
        }
      }
    }
  });
});

function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  const mean = (values: readonly number[]): number =>
    values.reduce((sum, value) => sum + value, 0) / n;
  const mx = mean(xs);
  const my = mean(ys);
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let index = 0; index < n; index++) {
    const dx = (xs[index] ?? 0) - mx;
    const dy = (ys[index] ?? 0) - my;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  return covariance / Math.sqrt(varianceX * varianceY);
}
