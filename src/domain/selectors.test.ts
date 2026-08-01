import { describe, expect, it } from "vitest";
import { oklch } from "@/color/types";
import {
  isConfirmEnabled,
  isFinalRound,
  memorizeProgress,
  memorizeRemainingMs,
  roundNumber,
  totalScore,
} from "@/domain/selectors";
import {
  type GameState,
  initialState,
  type Phase,
  ROUNDS_PER_GAME,
  type RoundResult,
} from "@/domain/state";

const PHASES: readonly Phase[] = ["idle", "memorize", "picking", "reveal", "summary"];

function stateWith(overrides: Partial<GameState>): GameState {
  return { ...initialState(), ...overrides };
}

/** A state parked mid-memorize, `elapsed` ms in. */
function memorizing(elapsed: number, memorizeMs = 5000): GameState {
  return stateWith({
    phase: "memorize",
    phaseStartedAt: 1000,
    now: 1000 + elapsed,
    settings: { memorizeMs, reducedMotion: false },
  });
}

describe("memorizeRemainingMs", () => {
  it("is the full duration before the first tick", () => {
    expect(memorizeRemainingMs(memorizing(0))).toBe(5000);
  });

  it("counts down with the clock", () => {
    expect(memorizeRemainingMs(memorizing(1500))).toBe(3500);
    expect(memorizeRemainingMs(memorizing(4999))).toBe(1);
  });

  it("clamps to zero at and past the deadline", () => {
    expect(memorizeRemainingMs(memorizing(5000))).toBe(0);
    expect(memorizeRemainingMs(memorizing(60000))).toBe(0);
  });

  it("clamps to the duration if the clock ran backwards", () => {
    expect(memorizeRemainingMs(memorizing(-2000))).toBe(5000);
  });

  it("follows the configured duration (SPEC §8)", () => {
    expect(memorizeRemainingMs(memorizing(1000, 3000))).toBe(2000);
    expect(memorizeRemainingMs(memorizing(1000, 8000))).toBe(7000);
  });

  it("is zero outside the memorize phase", () => {
    for (const phase of PHASES) {
      if (phase === "memorize") continue;
      expect(memorizeRemainingMs({ ...memorizing(1000), phase })).toBe(0);
    }
  });

  it("is zero for a non-positive duration instead of going negative", () => {
    expect(memorizeRemainingMs(memorizing(100, 0))).toBe(0);
    expect(memorizeRemainingMs(memorizing(100, -1))).toBe(0);
  });
});

describe("memorizeProgress", () => {
  it("runs 0 → 1 across the phase", () => {
    expect(memorizeProgress(memorizing(0))).toBe(0);
    expect(memorizeProgress(memorizing(2500))).toBe(0.5);
    expect(memorizeProgress(memorizing(5000))).toBe(1);
  });

  it("clamps at both ends", () => {
    expect(memorizeProgress(memorizing(-9999))).toBe(0);
    expect(memorizeProgress(memorizing(999999))).toBe(1);
  });

  it("is complete rather than NaN when the duration is non-positive", () => {
    expect(memorizeProgress(memorizing(100, 0))).toBe(1);
    expect(memorizeProgress(memorizing(0, -50))).toBe(1);
  });

  it("resets to 0 outside the memorize phase, ready for the next round", () => {
    for (const phase of PHASES) {
      if (phase === "memorize") continue;
      expect(memorizeProgress({ ...memorizing(4000), phase })).toBe(0);
    }
  });

  it("stays finite for a NaN clock", () => {
    expect(memorizeProgress({ ...memorizing(0), now: Number.NaN })).toBe(0);
  });
});

describe("totalScore", () => {
  const results = (...scores: number[]): readonly RoundResult[] =>
    scores.map((score) => ({ deltaE: 1, score }));

  it("is zero with no rounds played", () => {
    expect(totalScore(initialState())).toBe(0);
  });

  it("sums the round scores", () => {
    expect(totalScore(stateWith({ results: results(100, 80, 55) }))).toBe(235);
  });

  it("reaches the 500 maximum of a perfect game (SPEC §6)", () => {
    expect(totalScore(stateWith({ results: results(100, 100, 100, 100, 100) }))).toBe(500);
  });
});

describe("roundNumber", () => {
  it("is 1-based for display", () => {
    expect(roundNumber(stateWith({ roundIndex: 0 }))).toBe(1);
    expect(roundNumber(stateWith({ roundIndex: 4 }))).toBe(5);
  });

  it("clamps to the game length at both ends", () => {
    expect(roundNumber(stateWith({ roundIndex: -7 }))).toBe(1);
    expect(roundNumber(stateWith({ roundIndex: 99 }))).toBe(ROUNDS_PER_GAME);
  });
});

describe("isConfirmEnabled", () => {
  it("is false until the picker has moved (SPEC §5.4)", () => {
    expect(isConfirmEnabled(stateWith({ phase: "picking", hasMoved: false }))).toBe(false);
    expect(isConfirmEnabled(stateWith({ phase: "picking", hasMoved: true }))).toBe(true);
  });

  it("is false in every other phase, even with a guess already made", () => {
    for (const phase of PHASES) {
      if (phase === "picking") continue;
      const state = stateWith({ phase, hasMoved: true, guess: oklch(0.5, 0.1, 30) });
      expect(isConfirmEnabled(state)).toBe(false);
    }
  });
});

describe("isFinalRound", () => {
  it("is true only on the last round", () => {
    for (let roundIndex = 0; roundIndex < ROUNDS_PER_GAME; roundIndex++) {
      const expected = roundIndex === ROUNDS_PER_GAME - 1;
      expect(isFinalRound(stateWith({ roundIndex }))).toBe(expected);
    }
  });

  it("stays true past the end, since summary keeps the last index", () => {
    expect(isFinalRound(stateWith({ roundIndex: ROUNDS_PER_GAME }))).toBe(true);
  });
});
