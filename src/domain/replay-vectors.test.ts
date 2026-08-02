import { describe, expect, it } from "vitest";

import { generateTarget } from "@/domain/round";
import { REPLAY_VECTORS } from "../../server/replay.vectors";

/**
 * The happy-dom half of the ADR 0016 engine-agreement gate. Same literals as
 * `server/replay.vectors.test.ts`, different vitest project and environment.
 *
 * This is the one place the browser-side suite reaches into `server/` — for data,
 * not behaviour. The purity guard forbids only the *reverse* direction, and
 * checking one set of numbers from both sides is the entire point.
 */
describe("replay vectors agree under happy-dom (ADR 0016)", () => {
  it("reproduces every vector bit-for-bit", () => {
    const mismatches = REPLAY_VECTORS.filter(([seed, roundIndex, difficulty, L, c, h]) => {
      const t = generateTarget(seed, roundIndex, difficulty);
      return t.L !== L || t.c !== c || t.h !== h;
    }).map(([seed, roundIndex, difficulty]) => `${seed}/${roundIndex}/${difficulty}`);

    expect(mismatches).toEqual([]);
  });
});
