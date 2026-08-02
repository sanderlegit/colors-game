# 0012 — Tab state is shell state, not game state

Date: 2026-08-02 · Status: accepted

## Context

The leaderboard needs somewhere to live, which means the app grows its first
notion of "which screen am I on". There is no route, no router and no screen
concept today — visibility is per-component `hidden` toggling driven by
`state.phase`, and `.menu` is the only screen-like thing in the codebase.

The obvious move is to put the active tab in `GameState`: a sixth phase, or a
field plus a seventh event. It is the wrong move for four reasons, in weight
order.

**A leaderboard is async and impure, and `GameState` is the one thing that cannot
be.** Board rows, request status, identity and submission status all arrive from
`fetch`. Even if only `activeTab` went into the state, the panel it selects reads
data that structurally cannot — so half the tab's world lives in the reducer and
half does not. Splitting one concern across the purity boundary is how the
boundary erodes.

**The reducer's totality contract makes a seventh event expensive for nothing.**
`state.test.ts` and the fast-check "never throws for any (state, event) pair"
property both enumerate the phase × event matrix. `SET_TAB` adds a row in every
phase and buys zero behaviour, because the tab has no interaction with the round
lifecycle.

**It would have to opt out of the same-reference contract.** `main.ts` skips the
render when `next === state`, and the reducer returns the same object reference
for every illegal transition. A tab change must always re-render, so `SET_TAB`
would be the one event that returns a new object unconditionally — opting out of
the very contract that the contract exists for.

**Precedent already exists.** `view.setBestScore()` is exactly this shape: a value
the reducer must not own, pushed in from the composition root, with the component
doing its own dirty check.

## Decision

`activeTab` lives in a new `src/ui/shell.ts`, which sits above `createGameView`.
`createGameView` keeps its current job and public surface unchanged.

Async data reaches components through pushed setters — `setLeaderboard`,
`setIdentity`, `setSubmission` — alongside the existing `setBestScore`. The
leaderboard panel is **not** in `render.ts`'s `parts` array and never receives
`update(state)`.

This is generalised into a rule: **every `await` lives in `src/main.ts` or
`src/platform/**`; `src/ui/**` is synchronous.**

## Consequences

- The frame loop stays at six `update(state)` calls. A panel that re-renders on a
  tab visit rather than 60 times a second is the point.
- **Every UI component stays testable by calling a setter with a literal** — no
  promise flushing, no fake timers, no `await tick()` in happy-dom. This is the
  main practical payoff and it is worth more than the tidiness argument.
- `src/domain/**` gains zero lines for this feature. The only domain addition is
  `isMenuVisible(state)`, a two-line pure selector extracted from logic already
  inlined in `menu.ts`.
- `main.ts` grows three small async orchestrators (~60 lines). That is squarely
  the composition root's documented job and does not justify a new layer.
- The cost: there are now two places to look for "what is on screen" — the reducer
  for phase, the shell for tab. That is the honest trade, and it is bounded by the
  fact that the shell owns exactly one variable.
