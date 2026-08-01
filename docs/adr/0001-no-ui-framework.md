# 0001 — No UI framework; pure TypeScript + DOM

Date: 2026-08-01 · Status: accepted

## Context

The app is a single screen with five states, one non-trivial custom input (the
picker), and one signature animation (the dissolve). Component count is under ten
and will stay there. The team wants a stack that is fast to reason about, cheap to
test, and stable enough that an agent can work in it without churn.

A framework would buy us: declarative rendering, keyed list reconciliation,
ecosystem components. We need approximately none of that — there are no lists, the
one component that matters is a canvas we must drive imperatively anyway, and
"ecosystem color picker" is exactly the thing we are building by hand because the
geometry constraint (§SPEC 2.1) rules out every off-the-shelf one.

It would cost us: a dependency with its own upgrade treadmill and idioms, a build
step we don't control, ~40KB+ of runtime, and a layer between our state and the
canvas we'd be fighting during the dissolve.

## Decision

No UI framework and no reactivity library. Rendering is a hand-rolled
component-factory pattern (`create*(root, handlers) -> { update(state), destroy() }`)
driven from a single animation-frame loop, described in `docs/ARCHITECTURE.md`.

Vite is used, but only as a dev server and bundler — it is a build tool, not a
framework, and the source is plain ESM TypeScript that would run without it.

Runtime dependencies remain zero.

## Consequences

- We own ~200 lines of render plumbing. That is the entire cost.
- No reconciliation means `update()` must be idempotent and cheap — enforced by
  the architecture doc and by review, not by a type.
- Adding a genuinely list-heavy screen later (a leaderboard) would make this
  decision worth revisiting; it does not invalidate it today.
- Bundle target of ≤30KB gzipped becomes easy rather than aspirational.
