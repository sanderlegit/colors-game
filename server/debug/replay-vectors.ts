/**
 * The workerd half of the ADR 0016 engine-agreement gate.
 *
 * ADR 0016 rests on the claim that the client and the Worker, running the same
 * pure `generateTarget`, produce bit-identical targets — and the argument for it
 * is about IEEE arithmetic, which means it has to hold on *every* engine, not on
 * the two that happen to be V8 under vitest. `server/replay.vectors.ts` says so
 * in prose; four checks make it a build gate:
 *
 * | Engine       | Where                                |
 * |--------------|--------------------------------------|
 * | happy-dom    | `src/domain/replay-vectors.test.ts`   |
 * | Node         | `server/replay.vectors.test.ts`       |
 * | Chromium     | `e2e/replay-vectors.spec.ts`          |
 * | **workerd**  | here, via `e2e/replay-workerd.spec.ts`|
 *
 * The comparison is `!==` and never a tolerance: "close" is precisely the
 * failure being hunted, because a target that is close produces a ΔE that is
 * close, and the reveal screen and the leaderboard then disagree about the same
 * game.
 *
 * Running it inside the real route table rather than in a throwaway Worker is
 * deliberate: this is the bundle `wrangler deploy` ships, built by the same
 * esbuild pass with the same module resolution, so the thing proved is the thing
 * deployed.
 *
 * **Inert unless `DEBUG_REPLAY` is `"1"`.** See `server/env.d.ts` for why that
 * cannot be true in production, and `tests/debug-flag.node.test.ts` for the
 * guard that keeps it that way for every file in this directory.
 */

import { generateTarget } from "../../src/domain/round";
import type { Handler, RequestContext } from "../context";
import { jsonResponse, problem } from "../http/json";
import { REPLAY_VECTORS } from "../replay.vectors";

export const replayVectors: Handler = (context: RequestContext): Promise<Response> => {
  if (context.env.DEBUG_REPLAY !== "1") {
    // Byte-for-byte the router's own 404, so a probe cannot tell a gated route
    // from a path that was never there.
    return Promise.resolve(problem(404, "not_found", "No such endpoint."));
  }

  const mismatches = REPLAY_VECTORS.filter(([seed, roundIndex, difficulty, L, c, h]) => {
    const target = generateTarget(seed, roundIndex, difficulty);
    return target.L !== L || target.c !== c || target.h !== h;
  }).map(([seed, roundIndex, difficulty]) => `${seed}/${roundIndex}/${difficulty}`);

  // `checked` so an empty vector table cannot pass this vacuously.
  return Promise.resolve(jsonResponse(200, { checked: REPLAY_VECTORS.length, mismatches }));
};
