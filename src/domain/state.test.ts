import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Oklch, oklch } from "@/color/types";
import {
  createReducer,
  DEFAULT_SETTINGS,
  type Event,
  type GameState,
  initialState,
  type Phase,
  pickerStart,
  type Reducer,
  ROUNDS_PER_GAME,
  type ScoreFn,
  type Settings,
  type TargetFn,
} from "@/domain/state";

/**
 * Deliberately trivial doubles. Transition tests must fail when a transition is
 * wrong, not when the scoring curve is retuned.
 */
const score: ScoreFn = (target, guess) => ({
  deltaE: Math.abs(target.L - guess.L),
  score: Math.abs(target.h - guess.h),
});
const target: TargetFn = (seed, roundIndex) => oklch(0.6, 0.12, (seed + roundIndex * 37) % 360);

const reduce: Reducer = createReducer({ score, target });

const PHASES: readonly Phase[] = ["idle", "memorize", "picking", "reveal", "summary"];
const START_AT = 1000;
const A_COLOR: Oklch = oklch(0.72, 0.09, 210);

function start(state: GameState = initialState(), seed = 41762, at = START_AT): GameState {
  return reduce(state, { type: "START", seed, at });
}

/** Drive one round from `memorize` all the way to `reveal`. */
function playRound(memorizing: GameState, pick: Oklch = A_COLOR): GameState {
  const picking = reduce(memorizing, {
    type: "TICK",
    at: memorizing.phaseStartedAt + memorizing.settings.memorizeMs,
  });
  return reduce(reduce(picking, { type: "PICK", value: pick }), { type: "CONFIRM" });
}

function playWholeGame(): GameState {
  let state = start();
  for (let round = 0; round < ROUNDS_PER_GAME; round++) {
    state = reduce(playRound(state), { type: "NEXT" });
  }
  return state;
}

/** One representative state per phase, all with `hasMoved` true where reachable. */
function statesByPhase(): Record<Phase, GameState> {
  const idle = initialState();
  const memorize = start(idle);
  const picking = reduce(reduce(memorize, { type: "TICK", at: START_AT + 5000 }), {
    type: "PICK",
    value: A_COLOR,
  });
  const reveal = reduce(picking, { type: "CONFIRM" });
  return { idle, memorize, picking, reveal, summary: playWholeGame() };
}

describe("initialState", () => {
  it("starts idle with no results and a zeroed clock", () => {
    const state = initialState();
    expect(state.phase).toBe("idle");
    expect(state.results).toEqual([]);
    expect(state.roundIndex).toBe(0);
    expect(state.hasMoved).toBe(false);
    expect(state.now).toBe(0);
    expect(state.phaseStartedAt).toBe(0);
    expect(state.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("defaults to the 5s memorize rule from SPEC §3", () => {
    expect(DEFAULT_SETTINGS.memorizeMs).toBe(5000);
    expect(DEFAULT_SETTINGS.reducedMotion).toBe(false);
  });

  it("accepts the settings chosen before play (SPEC §8)", () => {
    const settings: Settings = { memorizeMs: 3000, reducedMotion: true };
    expect(initialState(settings).settings).toEqual(settings);
  });
});

describe("the (phase × event) matrix is total", () => {
  const LEGAL = new Set([
    "idle/START",
    "idle/TICK",
    "memorize/TICK",
    "picking/TICK",
    "picking/PICK",
    "picking/CONFIRM",
    "reveal/TICK",
    "reveal/NEXT",
    "summary/TICK",
    "summary/RESTART",
  ]);

  const states = statesByPhase();

  for (const phase of PHASES) {
    const state = states[phase];
    const events: readonly Event[] = [
      { type: "START", seed: 5, at: state.now + 1 },
      { type: "TICK", at: state.now + 1 },
      { type: "PICK", value: oklch(0.3, 0.02, 99) },
      { type: "CONFIRM" },
      { type: "NEXT" },
      { type: "RESTART", seed: 5, at: state.now + 1 },
    ];

    it(`builds a representative ${phase} state`, () => {
      expect(state.phase).toBe(phase);
    });

    for (const event of events) {
      const legal = LEGAL.has(`${phase}/${event.type}`);
      it(`${phase} × ${event.type} is ${legal ? "legal" : "a no-op"}`, () => {
        const next = reduce(state, event);
        if (legal) {
          expect(next).not.toBe(state);
        } else {
          // Same reference, so the shell can skip a render with `next === prev`.
          expect(next).toBe(state);
        }
      });
    }
  }

  it("never throws for a structurally invalid event from an untyped boundary", () => {
    // JSON is a real boundary: a replayed event log is not compile-time checked.
    const fromTheWire = JSON.parse('{"type":"WAT","at":1}') as Event;
    expect(reduce(states.picking, fromTheWire)).toBe(states.picking);
  });
});

describe("START", () => {
  it("moves idle → memorize and generates round 0 from the seed", () => {
    const state = start();
    expect(state.phase).toBe("memorize");
    expect(state.seed).toBe(41762);
    expect(state.roundIndex).toBe(0);
    expect(state.target).toEqual(target(41762, 0));
    expect(state.phaseStartedAt).toBe(START_AT);
    expect(state.now).toBe(START_AT);
    expect(state.results).toEqual([]);
    expect(state.hasMoved).toBe(false);
  });

  it("starts the picker on a neutral gray (SPEC §5.3)", () => {
    const state = start();
    expect(state.guess.c).toBe(0);
    expect(state.guess.L).toBe(0.5);
    expect(state.guess).toEqual(pickerStart(41762, 0));
  });

  it("preserves the settings chosen before play", () => {
    const settings: Settings = { memorizeMs: 8000, reducedMotion: true };
    expect(start(initialState(settings)).settings).toEqual(settings);
  });
});

describe("the memorize timer lives in reduce, not in a setTimeout", () => {
  it("stays in memorize while elapsed < memorizeMs", () => {
    const state = reduce(start(), { type: "TICK", at: START_AT + 4999 });
    expect(state.phase).toBe("memorize");
    expect(state.now).toBe(START_AT + 4999);
    expect(state.phaseStartedAt).toBe(START_AT);
  });

  it("transitions to picking on the tick that reaches memorizeMs exactly", () => {
    const state = reduce(start(), { type: "TICK", at: START_AT + 5000 });
    expect(state.phase).toBe("picking");
    expect(state.phaseStartedAt).toBe(START_AT + 5000);
  });

  it("transitions on the first tick past the deadline, however coarse the frame", () => {
    // A dropped frame must not strand the player in memorize.
    const state = reduce(start(), { type: "TICK", at: START_AT + 99999 });
    expect(state.phase).toBe("picking");
  });

  it("needs only two timestamps and no real waiting", () => {
    const before = reduce(start(), { type: "TICK", at: START_AT + 100 });
    const after = reduce(before, { type: "TICK", at: START_AT + 5000 });
    expect(before.phase).toBe("memorize");
    expect(after.phase).toBe("picking");
  });

  it("honours a shortened memorize setting", () => {
    const short = start(initialState({ memorizeMs: 3000, reducedMotion: false }));
    expect(reduce(short, { type: "TICK", at: START_AT + 2999 }).phase).toBe("memorize");
    expect(reduce(short, { type: "TICK", at: START_AT + 3000 }).phase).toBe("picking");
  });

  it("does not re-enter picking or restamp the phase on later ticks", () => {
    const picking = reduce(start(), { type: "TICK", at: START_AT + 5000 });
    const later = reduce(picking, { type: "TICK", at: START_AT + 9000 });
    expect(later.phase).toBe("picking");
    expect(later.phaseStartedAt).toBe(START_AT + 5000);
    expect(later.now).toBe(START_AT + 9000);
  });

  it("ignores a stalled or rewound clock", () => {
    const state = start();
    expect(reduce(state, { type: "TICK", at: START_AT })).toBe(state);
    expect(reduce(state, { type: "TICK", at: START_AT - 500 })).toBe(state);
  });

  it("advances `now` in every phase so selectors can rely on it", () => {
    const states = statesByPhase();
    for (const phase of PHASES) {
      const state = states[phase];
      expect(reduce(state, { type: "TICK", at: state.now + 250 }).now).toBe(state.now + 250);
    }
  });
});

describe("PICK", () => {
  const picking = reduce(start(), { type: "TICK", at: START_AT + 5000 });

  it("sets the guess and flags the move", () => {
    const state = reduce(picking, { type: "PICK", value: A_COLOR });
    expect(state.guess).toEqual(A_COLOR);
    expect(state.hasMoved).toBe(true);
  });

  it("keeps streaming during a drag", () => {
    const dragged = [oklch(0.4, 0.01, 10), oklch(0.5, 0.05, 20), oklch(0.6, 0.09, 30)].reduce(
      (state, value) => reduce(state, { type: "PICK", value }),
      picking,
    );
    expect(dragged.guess).toEqual(oklch(0.6, 0.09, 30));
  });

  it("does not mutate the state it was given", () => {
    const before = { ...picking };
    reduce(picking, { type: "PICK", value: A_COLOR });
    expect(picking).toEqual(before);
    expect(picking.hasMoved).toBe(false);
  });
});

describe("CONFIRM", () => {
  const picking = reduce(start(), { type: "TICK", at: START_AT + 5000 });

  it("is blocked until the picker has moved (SPEC §5.4)", () => {
    expect(picking.hasMoved).toBe(false);
    expect(reduce(picking, { type: "CONFIRM" })).toBe(picking);
  });

  it("is blocked for the whole memorize phase, moved or not", () => {
    const memorizing = start();
    expect(reduce(memorizing, { type: "CONFIRM" })).toBe(memorizing);
  });

  it("moves picking → reveal and appends the scored result", () => {
    const moved = reduce(picking, { type: "PICK", value: A_COLOR });
    const state = reduce(moved, { type: "CONFIRM" });
    expect(state.phase).toBe("reveal");
    expect(state.results).toEqual([
      { ...score(moved.target, A_COLOR), target: moved.target, guess: A_COLOR },
    ]);
    expect(state.phaseStartedAt).toBe(moved.now);
  });

  it("scores the confirmed guess against the round's target", () => {
    const moved = reduce(picking, { type: "PICK", value: A_COLOR });
    const state = reduce(moved, { type: "CONFIRM" });
    expect(state.results[0]?.deltaE).toBeCloseTo(Math.abs(moved.target.L - A_COLOR.L), 12);
  });

  it("cannot be replayed to score the same round twice", () => {
    const revealed = reduce(reduce(picking, { type: "PICK", value: A_COLOR }), { type: "CONFIRM" });
    expect(reduce(revealed, { type: "CONFIRM" })).toBe(revealed);
    expect(revealed.results).toHaveLength(1);
  });
});

describe("NEXT and the five-round game (SPEC §3)", () => {
  it("advances the round index and starts a fresh memorize phase", () => {
    const revealed = playRound(start());
    const state = reduce(revealed, { type: "NEXT" });
    expect(state.phase).toBe("memorize");
    expect(state.roundIndex).toBe(1);
    expect(state.hasMoved).toBe(false);
    expect(state.phaseStartedAt).toBe(revealed.now);
    expect(state.target).toEqual(target(revealed.seed, 1));
    expect(state.guess).toEqual(pickerStart(revealed.seed, 1));
  });

  it("keeps the accumulated results across rounds", () => {
    const second = reduce(playRound(start()), { type: "NEXT" });
    expect(second.results).toHaveLength(1);
    expect(reduce(playRound(second), { type: "NEXT" }).results).toHaveLength(2);
  });

  it("reaches summary on the fifth NEXT, with five results", () => {
    let state = start();
    for (let round = 0; round < ROUNDS_PER_GAME; round++) {
      expect(state.roundIndex).toBe(round);
      state = reduce(playRound(state), { type: "NEXT" });
      const isLast = round === ROUNDS_PER_GAME - 1;
      expect(state.phase).toBe(isLast ? "summary" : "memorize");
    }
    expect(state.results).toHaveLength(ROUNDS_PER_GAME);
    expect(state.roundIndex).toBe(ROUNDS_PER_GAME - 1);
  });

  it("gives every round a different target for the same seed", () => {
    const targets = new Set<number>();
    let state = start();
    for (let round = 0; round < ROUNDS_PER_GAME; round++) {
      targets.add(state.target.h);
      state = reduce(playRound(state), { type: "NEXT" });
    }
    expect(targets.size).toBe(ROUNDS_PER_GAME);
  });

  it("is a no-op once in summary", () => {
    const summary = playWholeGame();
    expect(reduce(summary, { type: "NEXT" })).toBe(summary);
  });
});

describe("RESTART", () => {
  it("starts a new game from summary with the new seed", () => {
    const summary = playWholeGame();
    const state = reduce(summary, { type: "RESTART", seed: 777, at: summary.now + 10 });
    expect(state.phase).toBe("memorize");
    expect(state.seed).toBe(777);
    expect(state.roundIndex).toBe(0);
    expect(state.results).toEqual([]);
    expect(state.hasMoved).toBe(false);
    expect(state.target).toEqual(target(777, 0));
    expect(state.phaseStartedAt).toBe(summary.now + 10);
  });

  it("keeps the settings across the restart", () => {
    const settings: Settings = { memorizeMs: 3000, reducedMotion: true };
    let state = start(initialState(settings));
    for (let round = 0; round < ROUNDS_PER_GAME; round++) {
      state = reduce(playRound(state), { type: "NEXT" });
    }
    expect(reduce(state, { type: "RESTART", seed: 1, at: 0 }).settings).toEqual(settings);
  });

  it("replays identical colors for an identical seed (SPEC §5.2)", () => {
    const summary = playWholeGame();
    const replay = reduce(summary, { type: "RESTART", seed: 41762, at: 0 });
    expect(replay.target).toEqual(start().target);
    expect(replay.guess).toEqual(start().guess);
  });
});

describe("pickerStart (SPEC §5.3)", () => {
  it("is neutral gray at mid lightness, so it leaks nothing", () => {
    for (let round = 0; round < ROUNDS_PER_GAME; round++) {
      const color = pickerStart(2026, round);
      expect(color.c).toBe(0);
      expect(color.L).toBe(0.5);
    }
  });

  it("puts the hue in [0, 360)", () => {
    for (let seed = 0; seed < 500; seed++) {
      const { h } = pickerStart(seed, seed % ROUNDS_PER_GAME);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it("is a pure function of (seed, roundIndex)", () => {
    expect(pickerStart(9, 2)).toEqual(pickerStart(9, 2));
  });

  it("decorrelates consecutive rounds", () => {
    const hues = new Set(Array.from({ length: 64 }, (_, i) => pickerStart(1234, i).h));
    expect(hues.size).toBe(64);
  });
});

describe("the reducer is total (SPEC §9.2)", () => {
  const finiteArb = fc.double({ noDefaultInfinity: false, noNaN: false });

  const oklchArb: fc.Arbitrary<Oklch> = fc
    .record({ L: finiteArb, c: finiteArb, h: finiteArb })
    .map(({ L, c, h }) => oklch(L, c, h));

  const stateArb: fc.Arbitrary<GameState> = fc.record({
    phase: fc.constantFrom(...PHASES),
    seed: fc.integer(),
    roundIndex: fc.integer({ min: -3, max: 12 }),
    target: oklchArb,
    guess: oklchArb,
    hasMoved: fc.boolean(),
    phaseStartedAt: finiteArb,
    now: finiteArb,
    results: fc.array(
      fc.record({ deltaE: finiteArb, score: finiteArb, target: oklchArb, guess: oklchArb }),
      { maxLength: 8 },
    ),
    settings: fc.record({ memorizeMs: finiteArb, reducedMotion: fc.boolean() }),
  });

  const eventArb: fc.Arbitrary<Event> = fc.oneof(
    fc.record({ type: fc.constant("START" as const), seed: fc.integer(), at: finiteArb }),
    fc.record({ type: fc.constant("TICK" as const), at: finiteArb }),
    fc.record({ type: fc.constant("PICK" as const), value: oklchArb }),
    fc.record({ type: fc.constant("CONFIRM" as const) }),
    fc.record({ type: fc.constant("NEXT" as const) }),
    fc.record({ type: fc.constant("RESTART" as const), seed: fc.integer(), at: finiteArb }),
  );

  it("never throws and always yields a valid phase", () => {
    fc.assert(
      fc.property(stateArb, eventArb, (state, event) => {
        const next = reduce(state, event);
        expect(PHASES).toContain(next.phase);
      }),
      { numRuns: 2000 },
    );
  });

  it("never mutates the state it is given", () => {
    fc.assert(
      fc.property(stateArb, eventArb, (state, event) => {
        const before = structuredClone(state);
        reduce(state, event);
        expect(state).toEqual(before);
      }),
      { numRuns: 1000 },
    );
  });

  it("never drops or reorders results already recorded", () => {
    fc.assert(
      fc.property(stateArb, eventArb, (state, event) => {
        const next = reduce(state, event);
        // A round is only ever appended, or the whole log is cleared for a new game.
        const kept = next.results.length >= state.results.length;
        expect(kept || next.results.length === 0).toBe(true);
        if (kept) {
          expect(next.results.slice(0, state.results.length)).toEqual(state.results);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
