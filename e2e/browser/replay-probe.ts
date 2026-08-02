/**
 * The browser half of the ADR 0016 engine-agreement gate — the part that has to
 * run *inside the page*.
 *
 * Loaded by `e2e/replay-vectors.spec.ts` with `page.addScriptTag`, which the Vite
 * dev server transforms and serves like any other module under the project root.
 * A file rather than a `page.evaluate` closure so the imports are ordinary static
 * ones: `generateTarget` is the same module the app itself runs, resolved through
 * the same `@/` alias, and `REPLAY_VECTORS` is the same table Node, happy-dom and
 * workerd are checked against.
 *
 * The answer goes onto `document.body.dataset` because that is a DOM read the
 * spec can make without casting anything.
 */

import { generateTarget } from "@/domain/round";
import { REPLAY_VECTORS } from "../../server/replay.vectors";

const mismatches = REPLAY_VECTORS.filter(([seed, roundIndex, difficulty, L, c, h]) => {
  const target = generateTarget(seed, roundIndex, difficulty);
  // `!==`, never a tolerance: "close" is precisely the failure being hunted.
  return target.L !== L || target.c !== c || target.h !== h;
}).map(([seed, roundIndex, difficulty]) => `${seed}/${roundIndex}/${difficulty}`);

document.body.dataset.replayVectors = JSON.stringify({
  // `checked` so an empty vector table cannot pass this vacuously.
  checked: REPLAY_VECTORS.length,
  mismatches,
});
