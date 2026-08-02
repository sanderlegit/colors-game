/**
 * Reading a finished game's guesses back out of `guesses_json`.
 *
 * Both the resubmit path (`submit.ts`) and the attempt view (`attempt.ts`) have
 * to reconstruct a stored game, and they must narrow the column by the *same*
 * rules that let it be written — `decodeGuesses`, exactly as a fresh submission
 * is decoded — or a stored row becomes a second, unvalidated entry point.
 *
 * We wrote this column, so a row that will not narrow is a schema divergence,
 * not a bad request: it throws, and the failure boundary in `app.ts` turns it
 * into a 500. Fail at the seam, not three frames later where a `NaN` has already
 * reached a score.
 */

import type { Oklch } from "../src/color/types";
import type { Game } from "./db/repo";
import { decodeGuesses } from "./decode";

export function storedGuesses(game: Game): readonly Oklch[] {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(game.guessesJson ?? "");
  } catch {
    parsed = null;
  }
  const guesses = decodeGuesses(parsed);
  if (guesses === null) throw new Error(`unreadable guesses_json on game ${game.id}`);
  return guesses;
}
