# Documentation map

Start here. This file exists so an agent (or a person) can get to the right
document in one hop instead of grepping.

## Route by what you're doing

| You are… | Read, in this order |
|----------|---------------------|
| New to the repo | `../CLAUDE.md` → `SPEC.md` → `ARCHITECTURE.md` |
| Changing game rules, phases, scoring, or layout | `SPEC.md` (it is the product contract) |
| Adding or moving a module | `ARCHITECTURE.md` § Directory layout + § Core contracts |
| Touching anything in `src/color/**` | `research/color-science.md`, then `research/test-vectors.md`. **Do not re-derive constants from memory.** Its § Picker UX is superseded and banner-marked — check `adr/README.md` before building anything from that section. |
| Touching scoring | `adr/0004-perceptual-scoring.md`, then `TUNING.md` |
| **Tuning anything** — score curve, difficulty, timings, picker feel | `TUNING.md`. It names the constants so you don't have to grep. Note "difficulty" means two different things; that page disambiguates. |
| **About to write a test** | `history/README.md` § Environment traps → Testing. **Read it first, not after it bites** — happy-dom silently drops `oklch()`, has no layout and no canvas, and swallows `console.log`. |
| Touching the picker | `adr/0007-picker-shows-every-hue.md` (and `adr/0005` for what was rejected) |
| Touching the dissolve | `adr/0008-dissolve-straight-into-the-picker.md` (and `adr/0006`) |
| About to propose an idea | `adr/README.md` § Already rejected — check it isn't there |
| Wondering why something is the way it is | `adr/README.md`, then `history/` |
| Picking up work | `BACKLOG.md` § Known gaps |
| Writing player-facing copy | `player-guide.md` |
| Hitting a weird tooling failure | `history/README.md` § Environment traps |

## What each document is

| File | Role | Mutable? |
|------|------|----------|
| `../CLAUDE.md` | How to work here. Auto-loaded into agent context, so it stays short. | Yes |
| `SPEC.md` | What the game is and why. The product contract. | Yes — update when behaviour changes |
| `ARCHITECTURE.md` | Module boundaries and the type contracts every task builds against. | Yes — update in the same commit as the code |
| `BACKLOG.md` | Delivery plan, known gaps, risk register. | Yes |
| `adr/` | Decisions and their consequences. | **No — immutable. Supersede instead.** |
| `research/` | Cited color science with VERIFIED / UNVERIFIED marked. | Append-only |
| `history/` | What actually happened, session by session. | Append-only |
| `TUNING.md` | Every knob, what it does, where it lives. | Yes |
| `player-guide.md` | Player-facing explanation of scoring. | Yes |

## The two rules that matter most

1. **`src/domain/**` and `src/color/**` are pure.** No DOM, no clock, no
   `Math.random()`. Enforced by `tests/purity.node.test.ts`, which fails the
   build. Full rule in `../CLAUDE.md`.
2. **Nothing is done until `npm run verify` passes.** UI-visible changes also
   need `npm run e2e`. Both, actually run — not assumed.

## Verifying a change

```sh
npm run verify    # typecheck → lint → unit tests → build
npm run e2e       # Playwright, Desktop Chrome + iPhone 14
npm run test:cov  # 90% floor on src/color/** and src/domain/**, enforced
```

E2E needs browsers once: `npx playwright install chromium`.

Layout and geometry claims are only real if asserted in `e2e/game.spec.ts` —
three separate layout bugs in this repo were invisible to unit tests and to
desktop, and only showed up at the iPhone viewport. See
`history/0001-initial-build.md`.
