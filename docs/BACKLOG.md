# Delivery plan

Sliced so that each item is independently verifiable, has an explicit contract
from `docs/ARCHITECTURE.md`, and can be handed to a separate agent without
coordination. Dependencies are noted; anything at the same depth can run in
parallel.

Every item's exit criteria include `npm run verify` green.

## Phase 0 — foundation (done / in flight)

| # | Item | Exit criteria |
|---|------|---------------|
| 0.1 | Toolchain scaffold: TS strict, Vite, Vitest, Biome, Playwright, CI, git | `npm run verify` passes on an empty project |
| 0.2 | Spec, architecture, ADRs, agent working agreement | This directory + `CLAUDE.md` |
| 0.3 | Color-science research: metric, curve, conversion math, test vectors | `docs/research/*.md` with cited values |
| 0.4 | Purity guard test | `tests/purity.test.ts` fails on a planted violation |

## Phase 1 — the pure core (parallelizable, no UI)

| # | Item | Depends | Exit criteria |
|---|------|---------|---------------|
| 1.1 | `src/color/convert.ts` — sRGB↔linear↔XYZ↔Lab, linear↔OKLab↔OKLCh | 0.3 | Matches cited reference values; round-trip property tests pass |
| 1.2 | `src/color/deltaE.ts` — CIEDE2000 + OKLab ΔE | 1.1 | Passes the published CIEDE2000 test set, including the hue-wraparound pairs |
| 1.3 | `src/color/gamut.ts` — in-gamut test, chroma reduction at constant L/h | 1.1 | Property test: output always in gamut, hue preserved within ε |
| 1.4 | `src/color/format.ts` — hex parse/format, CSS strings | 1.1 | Round-trip + malformed-input tests |
| 1.5 | `src/domain/rng.ts` — seeded PRNG, explicit state | — | Same seed ⇒ identical sequence; distribution sanity check |
| 1.6 | `src/domain/round.ts` — target generation per difficulty tier | 1.3, 1.5 | Pure in (seed, index); 10k samples all in gamut and inside tier bounds |
| 1.7 | `src/domain/scoring.ts` — ΔE → 0..100 curve | 1.2 | Invariants: identity=100, bounded, monotonic, symmetric |
| 1.8 | `src/domain/state.ts` — `reduce`, total, timer transition in-domain | 1.6, 1.7 | Every (phase × event) pair covered incl. illegal ones; 5s transition tested with two timestamps, no waiting |

## Phase 2 — the shell

| # | Item | Depends | Exit criteria |
|---|------|---------|---------------|
| 2.1 | `src/platform/*` — rAF clock, storage, seed source | 1.8 | Adapters swappable; in-memory doubles used in tests |
| 2.2 | `src/ui/swatch.ts` — the shared grid cell + dissolve | 1.8 | Both layers share one grid cell; reduced-motion path collapses duration to 0 |
| 2.3 | `src/ui/picker.ts` — canvas plane + hue slider, pointer + keyboard | 2.2 | Pointer capture works for mouse/touch/pen; arrow keys nudge; gradient repaints only on hue change |
| 2.4 | `src/ui/preview.ts` — live guess + numeric readout | 1.8 | Updates during drag |
| 2.5 | `src/ui/hud.ts` — countdown, round counter, confirm | 1.8 | Confirm disabled until first move |
| 2.6 | `src/ui/reveal.ts` — target vs guess, ΔE, score | 1.7 | Shows raw ΔE alongside score |
| 2.7 | `src/ui/render.ts` + `src/main.ts` — composition root, frame loop | 2.1–2.6 | One-way data flow; no layout reads inside `update` |
| 2.8 | Responsive layout + safe-area + touch loupe | 2.3 | Swatch and preview both visible at iPhone 14 portrait without scrolling |

## Phase 3 — proving it

| # | Item | Depends | Exit criteria |
|---|------|---------|---------------|
| 3.1 | E2E geometry assertion: picker box == swatch box within 1px | 2.7 | Green on Desktop Chrome and iPhone 14 projects |
| 3.2 | E2E happy path + no-target-in-DOM check | 2.7 | Green on both projects |
| 3.3 | Keyboard-only playthrough, visible focus, reduced motion | 2.7 | Manual pass logged + e2e where automatable |
| 3.4 | Real-device pass over LAN dev server | 2.8 | Signed off manually |
| 3.5 | Perf budget check: bundle ≤30KB gz, repaint ≤4ms @2× | 2.7 | Measured, recorded in the PR |

## Deliberately deferred

Daily challenge (seeds already support it), share cards, leaderboard + server-side
target generation, sound, PWA offline install, difficulty progression tuning based
on real score distributions.

## Risk register

| Risk | Mitigation |
|------|------------|
| CIEDE2000 implemented subtly wrong; scores feel arbitrary | Test against the published Sharma/Wu/Dalal vectors, which are designed to catch exactly these bugs |
| Scoring curve feels punishing; near-misses read as failures | Curve is a single pure function with a tuning table; playtest and adjust without touching anything else |
| Picker unusable on touch due to finger occlusion | Loupe offset above contact point; e2e at real mobile viewport from day one, not at the end |
| Dissolve geometry drifts as layout changes | Shared grid cell makes it correct by construction; e2e asserts it anyway |
| Scope creep into a framework rewrite | ADR 0001; any dependency needs an ADR |
