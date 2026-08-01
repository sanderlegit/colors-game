/**
 * Composition root — the one place where the pure core meets the browser.
 *
 * Everything above this file is either pure (`src/color`, `src/domain`) or a
 * component that receives what it needs. Here is where the real clock, the real
 * storage and the real seed source get chosen, and nowhere else. That is what
 * keeps the rest of the codebase testable without a browser.
 */

import { oklchToSrgb } from "@/color/convert";
import { toHex } from "@/color/format";
import { clipChromaToGamut } from "@/color/gamut";
import type { Oklch } from "@/color/types";
import { generateTarget } from "@/domain/round";
import { scoreGuess } from "@/domain/scoring";
import { totalScore } from "@/domain/selectors";
import type { Event, GameState } from "@/domain/state";
import { createReducer, initialState } from "@/domain/state";
import { createClock } from "@/platform/clock";
import { createSeed } from "@/platform/seed";
import { browserStore, createMemoryStore, createStorage } from "@/platform/storage";
import { createPicker } from "@/ui/picker";
import { createGameView } from "@/ui/render";

/**
 * The readout's hex value. Chroma is reduced into gamut first: a guess can sit in
 * the out-of-gamut region of the picker plane, and clamping RGB channels instead
 * would shift the hue by as much as 69° (ADR 0005).
 */
function formatHex(color: Oklch): string {
  return toHex(oklchToSrgb(clipChromaToGamut(color)));
}

function main(): void {
  const root = document.querySelector<HTMLElement>("#app");
  if (root === null) throw new Error("#app is missing from index.html");

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const storage = createStorage(browserStore() ?? createMemoryStore());

  const reduce = createReducer({ score: scoreGuess, target: generateTarget });

  let state: GameState = initialState(storage.readSettings());
  let stats = storage.readStats();

  const view = createGameView(root, {
    dispatch: (event: Event) => dispatch(event),
    createPicker,
    nextSeed: createSeed,
    reducedMotion,
    formatHex,
    bestScore: stats.bestScore,
  });

  function dispatch(event: Event): void {
    const next = reduce(state, event);
    // The reducer returns the same reference for a no-op, which skips both the
    // render and the persistence check on the majority of frames.
    if (next === state) return;

    const justFinished = next.phase === "summary" && state.phase !== "summary";
    state = next;
    view.update(state);

    if (!justFinished) return;

    const total = Math.round(totalScore(state));
    stats = {
      bestScore: Math.max(stats.bestScore, total),
      gamesPlayed: stats.gamesPlayed + 1,
    };
    view.setBestScore(stats.bestScore);
    storage.writeStats(stats);
  }

  view.update(state);
  createClock((ms) => dispatch({ type: "TICK", at: ms })).start();
}

main();
