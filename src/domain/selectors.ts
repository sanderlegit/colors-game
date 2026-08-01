/**
 * Derived view data.
 *
 * Everything the UI wants to *show* but that is not stored in `GameState` is
 * computed here, not in a component. Two reasons: the same derivation is needed
 * by more than one component (the countdown ring and the numeric countdown read
 * the same number, SPEC §8), and a derivation living in a render function is a
 * derivation that only an e2e test can reach.
 *
 * Every function is total and clamped. A selector must never throw and never
 * hand the UI a value it has to sanity-check — out-of-range inputs are clamped
 * here, once.
 */

import type { GameState } from "@/domain/state";
import { ROUNDS_PER_GAME } from "@/domain/state";

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Milliseconds left in the memorize phase, clamped to `[0, memorizeMs]`.
 * Zero outside the memorize phase — there is nothing counting down.
 */
export function memorizeRemainingMs(state: GameState): number {
  if (state.phase !== "memorize") return 0;
  const { memorizeMs } = state.settings;
  if (!(memorizeMs > 0)) return 0;
  return clamp(memorizeMs - (state.now - state.phaseStartedAt), 0, memorizeMs);
}

/**
 * Fraction of the memorize phase elapsed, in `[0, 1]`. Drives the countdown
 * ring, so it is 0 before any tick and reaches exactly 1 at the transition.
 *
 * Outside the memorize phase it is 0 rather than 1: the ring is not rendered
 * then, and 0 is the value it should be reset to for the next round. A
 * non-positive `memorizeMs` reports 1 (instantly complete) rather than dividing
 * by zero.
 */
export function memorizeProgress(state: GameState): number {
  if (state.phase !== "memorize") return 0;
  const { memorizeMs } = state.settings;
  if (!(memorizeMs > 0)) return 1;
  return clamp((state.now - state.phaseStartedAt) / memorizeMs, 0, 1);
}

/** Sum of round scores so far. SPEC §6: max 500 over five rounds. */
export function totalScore(state: GameState): number {
  return state.results.reduce((sum, result) => sum + result.score, 0);
}

/** 1-based round number for display ("Round 3 of 5"), clamped to the game length. */
export function roundNumber(state: GameState): number {
  return clamp(state.roundIndex + 1, 1, ROUNDS_PER_GAME);
}

/** SPEC §5.4: confirm is live only while picking, and only after a move. */
export function isConfirmEnabled(state: GameState): boolean {
  return state.phase === "picking" && state.hasMoved;
}

/** True when `NEXT` from the current round leads to the summary rather than another round. */
export function isFinalRound(state: GameState): boolean {
  return state.roundIndex >= ROUNDS_PER_GAME - 1;
}
