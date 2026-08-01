# Colors

A small browser game. You get five seconds to memorize a color. Then it dissolves
into a color picker occupying the exact same shape, and you have to find it again.
Your guess is scored on perceptual distance from the truth.

No UI framework. Zero runtime dependencies. Pure TypeScript and the DOM.

## Running it

```sh
npm install
npm run dev          # http://localhost:5173
npm run dev -- --host   # then open the LAN URL on a phone
```

## The one command

```sh
npm run verify       # typecheck → lint → unit tests → build
```

Everything else:

| Script | What it does |
|--------|--------------|
| `npm run test` / `test:watch` / `test:cov` | Vitest |
| `npm run e2e` | Playwright, Desktop Chrome + iPhone 14 |
| `npm run lint` / `lint:fix` / `format` | Biome |
| `npm run build` / `preview` | Production bundle |

## Where things are

```
src/color/      pure — conversions, ΔE, gamut mapping
src/domain/     pure — seeded rng, round generation, scoring, state machine
src/ui/         the imperative shell — DOM nodes, canvas, pointer input
src/platform/   adapters — rAF clock, storage, seed source
src/main.ts     composition root
e2e/            Playwright specs
docs/           spec, architecture, ADRs, color-science research
```

`src/color` and `src/domain` are pure: no DOM, no clock, no `Math.random()`. Time
and randomness are parameters. That is what makes a five-second timer and random
color generation testable in milliseconds and reproducible from a seed — see
`docs/adr/0002-functional-core-imperative-shell.md`. A guard test enforces it.

## Reading order

1. `docs/SPEC.md` — what the game is and why it's shaped this way
2. `docs/ARCHITECTURE.md` — module boundaries and the core contracts
3. `docs/adr/` — the decisions and their consequences
4. `CLAUDE.md` — the working agreement for agents in this repo
5. `docs/BACKLOG.md` — the delivery plan
