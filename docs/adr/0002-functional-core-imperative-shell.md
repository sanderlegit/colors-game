# 0002 — Functional core, imperative shell; injected time and randomness

Date: 2026-08-01 · Status: accepted

## Context

Two things in this game are notoriously painful to test if handled casually: a
five-second timer, and random color generation. The obvious implementations —
`setTimeout` inside a UI handler, `Math.random()` inside the round generator —
produce a test suite that is either slow (real waits), flaky (real randomness), or
full of timer mocks that drift from reality.

Separately, the color math and scoring are the parts most likely to be wrong in
ways users notice, so they need heavy, fast, exhaustive testing.

## Decision

`src/color/**` and `src/domain/**` are pure. The game state machine is a total
function `reduce(state, event) -> state`. Time enters only via `TICK` events
carrying a monotonic timestamp; randomness enters only via a seeded PRNG whose
state is explicit. The DOM, `requestAnimationFrame`, and `localStorage` live in
`src/ui/**` and `src/platform/**` and are wired together only in `src/main.ts`.

The rule is machine-checked by a guard test that scans the pure directories for
forbidden globals and cross-layer imports.

## Consequences

- The 5-second timer is tested by calling `reduce` with two timestamps. Tests run
  in milliseconds and never wait.
- Every game is reproducible from a seed. This is a testing win first, but it also
  makes daily-challenge and same-colors-multiplayer modes nearly free later, and
  it turns bug reports into "seed 41762, round 3".
- The shell is thin enough that its lower test coverage is acceptable; the
  interesting logic simply isn't there.
- Cost: a small amount of ceremony — the UI cannot "just call `Date.now()`", and
  new contributors (human or agent) will try to. Hence the guard test rather than
  a documented convention.
