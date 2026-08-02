/**
 * The replay. This is the file ADR 0016 exists for.
 *
 * The server is authoritative because it *replays* — it calls the same
 * `generateTarget` and the same `scoreGuess` the client ran, imported unmodified
 * from `src/domain/**` with relative paths. Nothing here recomputes a colour or
 * a curve. A second implementation of CIEDE2000 would agree with the first for
 * most inputs and disagree in the third decimal for the rest, and the player
 * would see that as the reveal screen and the leaderboard telling them different
 * things about the same game.
 *
 * So the rule for this module is narrow and absolute: it may arrange calls to
 * the pure core, and it may add up what comes back. It may not do colour maths.
 *
 * ## The flags
 *
 * `games.flags` was left as a bitfield with no bits defined (ADR 0016 § What
 * this does not decide). These are the first two, and both describe an input a
 * hand cannot produce rather than a score that is merely good:
 *
 * - **Bit 0, exact match.** A player dragging a canvas lands on a float that
 *   agrees with the target to fifteen digits by coincidence at most once in a
 *   lifetime. Twice in one game means the target was read out of memory rather
 *   than remembered, which is the residual hole ARCHITECTURE.md § Known
 *   limitation documents.
 * - **Bit 1, improbable accuracy.** Every round inside the perceptibility
 *   threshold. No eye does that five times running from memory.
 *
 * A flagged game is never rejected and the player is never told: the response is
 * the ordinary one. It simply may not raise `players.best_score`, which is the
 * column the board is built from. Telling a cheat which heuristic caught them is
 * handing them the test suite for their next attempt.
 */

import type { Oklch } from "../src/color/types";
import { type Difficulty, generateTarget } from "../src/domain/round";
import { scoreGuess } from "../src/domain/scoring";

/** Bit 0: two or more rounds guessed to fifteen digits. */
export const FLAG_EXACT_MATCH = 1;
/** Bit 1: every round inside the perceptibility threshold. */
export const FLAG_IMPROBABLE_ACCURACY = 2;

/**
 * Float equality with room for one JSON round-trip and nothing else. The picker
 * reports coordinates from pointer positions divided by a canvas size, so even a
 * deliberate pixel-perfect click is off by ~1e-3.
 */
const EXACT_EPSILON = 1e-9;

/** One coincidence is a coincidence. */
const EXACT_ROUNDS_TO_FLAG = 2;

/** `SCORE_DEADBAND` is 1.0; half of it is comfortably below what an eye resolves. */
const IMPROBABLE_DELTA_E = 0.5;

export type RoundReport = { readonly deltaE: number; readonly score: number };

/**
 * A round with the colours that produced it (ADR 0024), for the attempt view a
 * leaderboard row expands into. The `target` is derived from `(seed, roundIndex,
 * difficulty)` by the same `generateTarget` the client runs, so no colour maths
 * happens twice and the seed itself never has to leave the server to draw it —
 * the response carries the colours, not the seed (`server/hygiene.test.ts`).
 */
export type RoundDetail = RoundReport & {
  readonly target: Oklch;
  readonly guess: Oklch;
};

export type Replay = {
  readonly rounds: readonly RoundReport[];
  /**
   * The replayed targets' hues, in round order.
   *
   * Kept beside `rounds` rather than inside a `RoundReport` because `rounds` is
   * echoed to the client verbatim and this is not: it exists only to be bucketed
   * into `round_stats.hue_bucket` (ADR 0014), which is the instrument ADR 0008
   * asked for to make the afterimage bias detectable.
   */
  readonly targetHues: readonly number[];
  /**
   * The rounded sum, which is what `games.total_score` stores and what the board
   * orders on. The unrounded total never leaves this function.
   */
  readonly totalScore: number;
  readonly flags: number;
};

function isExact(target: Oklch, guess: Oklch): boolean {
  return (
    Math.abs(target.L - guess.L) < EXACT_EPSILON &&
    Math.abs(target.c - guess.c) < EXACT_EPSILON &&
    Math.abs(target.h - guess.h) < EXACT_EPSILON
  );
}

/**
 * Score a whole game from the row's own `(seed, difficulty)` and the submitted
 * guesses. Both come from the `games` row, never from the request body — a
 * client that could name its own seed could search for an easy one.
 */
export function replayGame(
  seed: number,
  difficulty: Difficulty,
  guesses: readonly Oklch[],
): Replay {
  const rounds: RoundReport[] = [];
  const targetHues: number[] = [];
  let total = 0;
  let exactRounds = 0;

  for (const [index, guess] of guesses.entries()) {
    const target = generateTarget(seed, index, difficulty);
    const { deltaE, score } = scoreGuess(target, guess);
    rounds.push({ deltaE, score });
    targetHues.push(target.h);
    total += score;
    if (isExact(target, guess)) exactRounds += 1;
  }

  const exact = exactRounds >= EXACT_ROUNDS_TO_FLAG ? FLAG_EXACT_MATCH : 0;
  const improbable =
    rounds.length > 0 && rounds.every((round) => round.deltaE < IMPROBABLE_DELTA_E)
      ? FLAG_IMPROBABLE_ACCURACY
      : 0;

  return { rounds, targetHues, totalScore: Math.round(total), flags: exact | improbable };
}

/**
 * Replay a stored game into per-round detail — target, guess, ΔE and score — for
 * the attempt breakdown. Same arrangement of the pure core as `replayGame`, and
 * deliberately no flags or total: this is a view of a game already scored and
 * stored, not a scoring path, so it adds up nothing and decides nothing.
 */
export function replayRounds(
  seed: number,
  difficulty: Difficulty,
  guesses: readonly Oklch[],
): readonly RoundDetail[] {
  return guesses.map((guess, index) => {
    const target = generateTarget(seed, index, difficulty);
    return { ...scoreGuess(target, guess), target, guess };
  });
}
