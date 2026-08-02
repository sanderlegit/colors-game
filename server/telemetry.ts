/**
 * ADR 0014's counters, built from a finished game. Pure: it takes numbers and
 * returns rows, and the writing is the Repo's job.
 *
 * ## Buckets and percentiles, never means
 *
 * SPEC §6 already reached this conclusion for the UI — any averaged score shown
 * is a median, because the random-guess distribution is heavily right-skewed. A
 * mean ΔE would be actively misleading about difficulty, so nothing here records
 * one: the counters are a histogram, and every question in
 * `docs/OPERATIONS.md` is answered with a percentile over it.
 *
 * ## `hue_bucket` is an instrument, not a dimension somebody liked
 *
 * ADR 0008 knowingly accepted an unmitigated afterimage bias — five seconds of
 * fixation biases the guess away from the target hue, invisibly — and said that
 * if scores ever show a systematic hue-opponent skew, ADR 0006 is the first
 * place to look. Twelve 30° buckets is what makes that visible: the opponent
 * axes fall on bucket pairs six apart, so the comparison is a single query.
 *
 * ## There are no per-round or per-player rows
 *
 * Nothing here identifies anybody, which is the whole point of ADR 0014: there
 * is no subject-access obligation and nothing to delete. `day` is a date, not a
 * timestamp, so two games by one player on one day are indistinguishable from
 * two games by two players.
 */

import type { Difficulty } from "../src/domain/round";
import type { GameCounter, RoundCounter, TelemetryWrite } from "./db/repo";

/**
 * ΔE lands in 1-unit buckets up to this, then everything above shares the cap.
 *
 * 1 unit is the resolution the interpretive anchors need: SPEC §6 puts chance
 * level near ΔE 11 and "trivial" under 2, so a p50 has to distinguish 10 from
 * 12. Above 40 the score is already under 3/100 and the exact value carries no
 * information about difficulty.
 */
export const DELTA_E_BUCKET_CAP = 40;

/** Twelve buckets: the hue-opponent axes are pairs six apart. */
export const HUE_BUCKET_DEGREES = 30;
export const HUE_BUCKETS = 360 / HUE_BUCKET_DEGREES;

/**
 * The bucket floor, so `delta_e_bucket = 11` means "ΔE in [11, 12)".
 *
 * A negative or non-finite ΔE cannot come out of `scoreGuess`, but this reads a
 * number that has been through JSON and a replay, and a `NaN` reaching SQLite
 * becomes NULL and poisons every later aggregate over the column.
 */
export function deltaEBucket(deltaE: number): number {
  if (!Number.isFinite(deltaE) || deltaE <= 0) return 0;
  return Math.min(DELTA_E_BUCKET_CAP, Math.floor(deltaE));
}

export function hueBucket(hue: number): number {
  if (!Number.isFinite(hue)) return 0;
  const wrapped = ((hue % 360) + 360) % 360;
  // `Math.min` rather than a modulus on the quotient: a hue of exactly 360 would
  // otherwise land in bucket 12, which no primary key expects.
  return Math.min(HUE_BUCKETS - 1, Math.floor(wrapped / HUE_BUCKET_DEGREES));
}

/**
 * UTC date, `YYYY-MM-DD`. The counters are keyed by day rather than by hour
 * because a day is the smallest window that is still an aggregate at this
 * volume, and because a UTC day is the same day for everyone reading it.
 */
export function dayKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** The game-level events the server can actually observe. See `docs/OPERATIONS.md`. */
export type GameEvent = "started" | "completed" | "flagged";

export type GameShape = {
  readonly difficulty: Difficulty;
  /**
   * From the `games` row, never the submit body — it is the player's own
   * difficulty knob (SPEC §8) and the only one v1 exposes, so a distribution
   * that did not carry it could not answer whether the setting changes anything.
   */
  readonly memorizeMs: number;
};

export function gameCounter(shape: GameShape, at: number, event: GameEvent): GameCounter {
  return {
    day: dayKey(at),
    difficulty: shape.difficulty,
    memorizeMs: shape.memorizeMs,
    event,
  };
}

export type SubmissionShape = GameShape & {
  readonly at: number;
  readonly deltaEs: readonly number[];
  /** The replayed target hues, which never reach the response body. */
  readonly targetHues: readonly number[];
  readonly flags: number;
};

/**
 * Every counter one finished game increments: one row per round, one for the
 * completion, and one more if the game carried anti-abuse flags.
 *
 * The flagged counter is what makes ADR 0015's "expect approximately zero"
 * check readable at all — `games.flags` is written and nothing has ever read it
 * back.
 */
export function submissionCounters(input: SubmissionShape): TelemetryWrite {
  const day = dayKey(input.at);
  const rounds: RoundCounter[] = [];
  for (const [index, deltaE] of input.deltaEs.entries()) {
    const hue = input.targetHues[index];
    if (hue === undefined) continue;
    rounds.push({
      day,
      difficulty: input.difficulty,
      memorizeMs: input.memorizeMs,
      roundIndex: index,
      deltaEBucket: deltaEBucket(deltaE),
      hueBucket: hueBucket(hue),
    });
  }

  const games: GameCounter[] = [gameCounter(input, input.at, "completed")];
  if (input.flags !== 0) games.push(gameCounter(input, input.at, "flagged"));

  return { rounds, games };
}
