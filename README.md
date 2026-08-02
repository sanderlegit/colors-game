# Colors

A small browser game. You get five seconds to memorize a color. Then it dissolves
into a color picker occupying the exact same shape, and you have to find it again.
Your guess is scored on perceptual distance from the truth.

There is a leaderboard. Pick a name when you finish a game — no login, no email;
the name lives in a cookie on your device. The server re-scores every submission,
and a game played while offline still counts for your personal best.

No UI framework. Zero runtime dependencies. Pure TypeScript and the DOM, on the
client and on the server.

## Running it

```sh
npm install
npm run dev          # http://localhost:5173 — UI only, /api goes nowhere
```

For the whole thing — the Worker, its static assets, a local D1 and the real
security headers — and for reaching it from a phone:

```sh
just serve                      # the real stack, HTTPS on loopback
just tailnet                    # publish it to your tailnet; prints both URLs
just smoke "$(just tailnet-ip)" # and prove it is usable, not merely up
```

`just tailnet` gives you two addresses: one by MagicDNS name (trusted
certificate) and one by tailnet IP (self-signed, one tap-through). **On iOS use
the IP** — MagicDNS is unreliable there, and an IP cannot be served over
`tailscale serve --https` at all.

`just` on its own lists every recipe (`brew install just`; it wraps the npm
scripts and replaces none of them — ADR 0019). **Do not use a LAN address for
phone testing.** The identity cookie is `Secure`, so a plain-HTTP origin silently
discards it: the game plays and the name claim never sticks. ADR 0020 and
`docs/OPERATIONS.md` § 5.

## The one command

```sh
npm run verify       # typecheck → lint → unit tests → build
```

Everything else:

| Script | What it does |
|--------|--------------|
| `npm run test` / `test:watch` / `test:cov` | Vitest — two projects, `app` on happy-dom and `server` on node |
| `npm run e2e` | Playwright, Desktop Chrome + iPhone 14, `/api` stubbed in the browser |
| `npm run e2e:backend` | The same browser against a real Worker + a local D1. No credentials needed. |
| `npm run dev:api` | The Worker locally on miniflare + a local D1 |
| `npm run migrate:local` / `d1:reset` | Apply migrations to the local D1; reset wipes it first |
| `npm run lint` / `lint:fix` / `format` | Biome |
| `npm run build` / `preview` | Production bundle |

## Where things are

```
src/color/      pure — conversions, ΔE, gamut mapping
src/domain/     pure — seeded rng, round generation, scoring, state machine
src/shared/     pure — untrusted-JSON narrowing, shared with the backend
src/ui/         the imperative shell — DOM nodes, canvas, pointer input
src/platform/   adapters — rAF clock, storage, seed source, HTTP
src/main.ts     composition root; every `await` in the client lives here
server/         the backend — Worker entry, router, handlers, D1 repo (ADR 0016,
                ADR 0022), plus debug/ routes gated on a binding that never ships
migrations/     D1 schema, applied by wrangler
e2e/            Playwright specs — two configs, see docs/README.md
docs/           spec, architecture, ADRs, color-science research, operations
```

`server/` re-scores submitted games by replaying the *same* pure functions the
client ran — not a second implementation. `src/domain` and `src/color` are
compiled a second time under `tsconfig.server.json` with no DOM lib, so "the core
runs unmodified under Workers" is a compile error when it stops being true.

`src/color` and `src/domain` are pure: no DOM, no clock, no `Math.random()`. Time
and randomness are parameters. That is what makes a five-second timer and random
color generation testable in milliseconds and reproducible from a seed — see
`docs/adr/0002-functional-core-imperative-shell.md`. A guard test enforces it.

## Reading order

Start at **`docs/README.md`** — it is the map, and routes you to the right
document in one hop.

1. `docs/SPEC.md` — what the game is and why it's shaped this way
2. `docs/ARCHITECTURE.md` — module boundaries and the core contracts
3. `docs/adr/README.md` — the decision log, including what was tried and rejected
4. `CLAUDE.md` — the working agreement for agents in this repo
5. `docs/BACKLOG.md` — the delivery plan and known gaps
6. `docs/history/` — what actually happened, and the environment traps
7. `docs/player-guide.md` — how scoring works, in player-facing terms
