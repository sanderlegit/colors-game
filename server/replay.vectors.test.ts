import { describe, expect, it } from "vitest";

import { generateTarget } from "../src/domain/round";
import { REPLAY_VECTORS } from "./replay.vectors";

/**
 * Engine agreement, two of the four. This file covers Node (the `server` vitest
 * project); `src/domain/replay-vectors.test.ts` covers happy-dom from the same
 * literals. The real browser and workerd halves live in `e2e/`.
 */
describe("replay vectors (ADR 0016)", () => {
  it("has enough coverage to be worth trusting", () => {
    expect(REPLAY_VECTORS.length).toBeGreaterThanOrEqual(50);
    // All three tiers, or a tier could drift unnoticed.
    const tiers = new Set(REPLAY_VECTORS.map(([, , difficulty]) => difficulty));
    expect([...tiers].sort()).toEqual(["easy", "hard", "normal"]);
  });

  for (const [seed, roundIndex, difficulty, L, c, h] of REPLAY_VECTORS) {
    it(`seed ${seed} round ${roundIndex} ${difficulty} is bit-identical`, () => {
      const target = generateTarget(seed, roundIndex, difficulty);
      // `toBe`, never `toBeCloseTo`. "Close" is the failure being hunted: a
      // divergence of 1e-6 is invisible to a player and fatal to replay.
      expect(target.L).toBe(L);
      expect(target.c).toBe(c);
      expect(target.h).toBe(h);
    });
  }
});
