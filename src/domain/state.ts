/**
 * The game state machine (SPEC §3, §5).
 *
 * `reduce` is a total function: every (state, event) pair returns a state and it
 * never throws. Illegal pairs return the *same object reference*, so a caller can
 * detect a no-op with `next === prev` and skip a render.
 *
 * There is no timer in here and none in the UI either. Time arrives as `TICK`
 * timestamps and the memorize→picking transition is computed from them, so the
 * five-second rule is tested by two function calls rather than by waiting.
 *
 * ## Deviation from docs/ARCHITECTURE.md § "Core contracts"
 *
 * The documented signature is a bare `reduce(state, event)`. This module exports
 * `createReducer(deps)` instead, which returns that exact function. Two things
 * forced it:
 *
 * - `CONFIRM` has to produce a `RoundResult`, which means calling `scoreGuess`
 *   from `src/domain/scoring.ts`.
 * - `START`/`NEXT` have to produce a target, which means calling
 *   `generateTarget` from `src/domain/round.ts`.
 *
 * Importing both would make the state machine untestable in isolation and would
 * couple transition tests to scoring-curve tuning. Injecting them keeps every
 * transition test driven by a two-line fake, and it makes the composition root
 * the single place where the real implementations are chosen. `reduce` itself is
 * unchanged in shape — `createReducer` is a partial application, not a new
 * protocol.
 */

import { type Oklch, oklch } from "@/color/types";
import { makeRng, mixSeed, nextInRange } from "@/domain/rng";

/** SPEC §3: long enough to smooth out luck, short enough for one sitting. */
export const ROUNDS_PER_GAME = 5;

export type Phase = "idle" | "memorize" | "picking" | "reveal" | "summary";

/**
 * Mirrors `RoundResult` in `src/domain/scoring.ts`. It is declared here as well
 * so the state machine carries no import from the scoring module; the two are
 * structurally identical and interchangeable.
 */
export type RoundResult = { readonly deltaE: number; readonly score: number };

export type Settings = {
  readonly memorizeMs: number;
  readonly reducedMotion: boolean;
};

export type GameState = {
  readonly phase: Phase;
  readonly seed: number;
  readonly roundIndex: number;
  readonly target: Oklch;
  readonly guess: Oklch;
  readonly hasMoved: boolean;
  /** ms, injected — never read from a clock in here. */
  readonly phaseStartedAt: number;
  /** ms, advanced only by TICK. */
  readonly now: number;
  readonly results: readonly RoundResult[];
  readonly settings: Settings;
};

export type Event =
  | { readonly type: "START"; readonly seed: number; readonly at: number }
  | { readonly type: "TICK"; readonly at: number }
  | { readonly type: "PICK"; readonly value: Oklch }
  | { readonly type: "CONFIRM" }
  | { readonly type: "NEXT" }
  | { readonly type: "RESTART"; readonly seed: number; readonly at: number };

/** Injected from `src/domain/scoring.ts`. */
export type ScoreFn = (target: Oklch, guess: Oklch) => RoundResult;

/** Injected from `src/domain/round.ts`. Pure in `(seed, roundIndex)` per SPEC §5.1. */
export type TargetFn = (seed: number, roundIndex: number) => Oklch;

export type ReducerDeps = {
  readonly score: ScoreFn;
  readonly target: TargetFn;
};

export type Reducer = (state: GameState, event: Event) => GameState;

/** SPEC §8: 5s default, adjustable to 3s or 8s before play. */
export const DEFAULT_SETTINGS: Settings = { memorizeMs: 5000, reducedMotion: false };

/**
 * The neutral gray the picker starts on. Also stands in for `target` while
 * `phase === "idle"`, where no target exists yet; the field is non-optional so
 * that every consumer has a color to render without a null check, and nothing
 * reads `target` before `START`.
 */
const NEUTRAL: Oklch = oklch(0.5, 0, 0);

/**
 * SPEC §5.3. Zero chroma, mid lightness, seeded-random hue.
 *
 * At C=0 the hue is invisible, so the starting swatch is the same neutral gray
 * every round and leaks nothing about the target. The hue still has to be
 * randomised because it decides which way the player travels once they raise
 * chroma, and a fixed hue would systematically favour targets near it.
 *
 * The seed is mixed with the round index so consecutive rounds are uncorrelated,
 * and mixed again so this stream cannot line up with the target generator's.
 */
export function pickerStart(seed: number, roundIndex: number): Oklch {
  const rng = makeRng(mixSeed(mixSeed(seed, roundIndex), 0x50494b52));
  return oklch(0.5, 0, nextInRange(rng, 0, 360));
}

export function initialState(settings: Settings = DEFAULT_SETTINGS): GameState {
  return {
    phase: "idle",
    seed: 0,
    roundIndex: 0,
    target: NEUTRAL,
    guess: NEUTRAL,
    hasMoved: false,
    phaseStartedAt: 0,
    now: 0,
    results: [],
    settings,
  };
}

function beginRound(
  state: GameState,
  deps: ReducerDeps,
  seed: number,
  roundIndex: number,
  at: number,
): GameState {
  return {
    ...state,
    phase: "memorize",
    seed,
    roundIndex,
    target: deps.target(seed, roundIndex),
    guess: pickerStart(seed, roundIndex),
    hasMoved: false,
    phaseStartedAt: at,
    now: at,
  };
}

function onTick(state: GameState, at: number): GameState {
  // Ignore stalled or rewound clocks. rAF timestamps are monotonic in practice,
  // but a duplicate frame must not be reported as a state change.
  if (!(at > state.now)) return state;

  const advanced: GameState = { ...state, now: at };
  if (state.phase !== "memorize") return advanced;

  const elapsed = at - state.phaseStartedAt;
  if (!(elapsed >= state.settings.memorizeMs)) return advanced;

  // SPEC §3: the memorize phase is not pausable and not skippable; it ends here,
  // in the domain, and nowhere else.
  return { ...advanced, phase: "picking", phaseStartedAt: at };
}

/**
 * Build the reducer. See the module header for why this is a factory.
 */
export function createReducer(deps: ReducerDeps): Reducer {
  return function reduce(state: GameState, event: Event): GameState {
    switch (event.type) {
      case "START":
        if (state.phase !== "idle") return state;
        return beginRound({ ...state, results: [] }, deps, event.seed, 0, event.at);

      case "TICK":
        return onTick(state, event.at);

      case "PICK":
        if (state.phase !== "picking") return state;
        return { ...state, guess: event.value, hasMoved: true };

      case "CONFIRM":
        // SPEC §5.4: disabled until the player has moved the picker at least
        // once, so a neutral gray can never be scored by accident.
        if (state.phase !== "picking" || !state.hasMoved) return state;
        return {
          ...state,
          phase: "reveal",
          phaseStartedAt: state.now,
          results: [...state.results, deps.score(state.target, state.guess)],
        };

      case "NEXT": {
        if (state.phase !== "reveal") return state;
        const next = state.roundIndex + 1;
        if (next >= ROUNDS_PER_GAME) {
          return { ...state, phase: "summary", phaseStartedAt: state.now };
        }
        return beginRound(state, deps, state.seed, next, state.now);
      }

      case "RESTART":
        // SPEC §3: summary is the only exit that offers a replay. Mid-game there
        // is no restart affordance, so accepting one here would be inventing UI.
        if (state.phase !== "summary") return state;
        return beginRound({ ...state, results: [] }, deps, event.seed, 0, event.at);

      default:
        return state;
    }
  };
}
