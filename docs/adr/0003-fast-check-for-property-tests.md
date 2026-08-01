# 0003 — fast-check for property-based tests

Date: 2026-08-01 · Status: accepted

## Context

CLAUDE.md and SPEC §9.2 both call for property-based tests: the reducer must never
throw for *any* (state, event) pair, sRGB→OKLab must round-trip across the cube,
ΔE must be symmetric, scores must be bounded and monotonic. These are universally
quantified claims. Example-based tests can only sample them by hand, and hand-picked
samples are exactly the ones an implementation already handles — the interesting
inputs are NaN, ±Infinity, a rewound clock, a negative round index, hue at the
0/360 seam.

CLAUDE.md requires an ADR for any dependency, including dev dependencies, and the
default answer is "write it ourselves". The build-it question here is real: a
`for` loop over a seeded generator producing random inputs is twenty lines, and
we already own a seeded PRNG (`src/domain/rng.ts`).

## Decision

Add `fast-check` as a **dev** dependency. Runtime dependencies stay at zero; this
never enters the bundle.

What twenty lines of our own would not give us:

- **Shrinking.** The value of a property test is not finding a failure, it is
  reporting the *minimal* failure. A hand-rolled loop reports "failed on
  `{L: 0.483..., c: 0.29..., h: 271.6...}` after 4,000 iterations"; fast-check
  reports `{L: 0, c: 0, h: 0}`. Reimplementing type-directed shrinking well is a
  project, not a helper.
- **Deterministic replay.** A failing run prints a seed and path that reproduces
  it exactly, which matters because these tests run in CI where we cannot attach
  a debugger.
- **Adversarial generators.** `fc.double()` deliberately biases toward NaN,
  ±Infinity, ±0, and boundary values. Our own generator would produce uniform
  doubles and would never have found the NaN-clock case.

It is the standard choice for TypeScript, is already named in SPEC §9.2, and it
ships one transitive dependency (`pure-rand`, by the same author).

## Consequences

- Property tests are written against the `fc.assert(fc.property(...))` API, and
  arbitraries live next to the tests that use them.
- Any test that fails must be reproducible from the printed seed before it is
  "fixed"; a flaky property test is a real bug in the property or the code, and
  raising `numRuns` to hide one is forbidden.
- `src/domain/rng.ts` stays the *production* source of randomness. fast-check is
  test infrastructure only; it must never be imported from `src/**` non-test code.
- One more dev dependency to keep current. Accepted: the alternative is a
  home-grown shrinker nobody maintains.
