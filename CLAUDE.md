# Working agreement for agents in this repo

Read `docs/SPEC.md` and `docs/ARCHITECTURE.md` before writing code. They are the
source of truth; this file is how you work.

## Finding things

`docs/README.md` is the map — it routes you to the right document in one hop.
Do not go spelunking; the answer is almost certainly already written down.

Before you start, in order of how often it saves you:

| Situation | Go to |
|-----------|-------|
| About to propose an approach | `docs/adr/README.md` § Already rejected. Twelve ideas in there look obviously right and are not. |
| Touching `src/color/**` | `docs/research/color-science.md`. Constants and test vectors are cited there — **never re-derive them from memory or fetch alternatives**. |
| Hit a baffling tooling or test failure | `docs/history/README.md` § Environment traps. happy-dom dropping `oklch()`, TS 7 removing `baseUrl`, and swallowed `console.log` are all in there. |
| Wondering why the code is shaped this way | `docs/adr/README.md`, then `docs/history/`. |
| Tuning a number (score curve, difficulty, timings) | `docs/TUNING.md`. Two different things are called "difficulty"; that page disambiguates. |
| Looking for work | `docs/BACKLOG.md` § Known gaps. |

Two decisions have already been reversed after playtesting (ADR 0005→0007,
0006→0008). The superseded ADRs are kept deliberately — the reasoning that turned
out to be wrong is the most useful thing in the log. Read both halves before
re-litigating either.

## The one command

```
npm run verify        # typecheck → lint → unit tests → build
```

Nothing is "done" until `npm run verify` passes. Do not report a task complete
without running it and seeing it pass. If it fails, fix it — do not describe the
failure and hand it back.

For UI-visible changes also run `npm run e2e`.

## The purity rule (the most important rule here)

Files under `src/domain/**` and `src/color/**` are pure:

- No imports from `src/ui/**` or `src/platform/**`.
- No `document`, `window`, `navigator`, `localStorage`, `fetch`.
- No `Date.now()`, `new Date()`, `performance.now()` — time is a parameter.
- No `Math.random()` — randomness comes from the seeded `Rng` port.
- No mutation of inputs; return new objects.

This is what makes the test suite fast and deterministic. A guard test in
`tests/purity.node.test.ts` scans these directories and fails the build on violation.
If you think you need an exception, you need an ADR instead.

## Types

- `strict` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on.
- **No `any`.** No `as` casts to silence the compiler — if a cast seems necessary,
  the model is wrong; fix the model. `as const` and narrowing casts on
  `unknown` at true boundaries are fine.
- No non-null assertions (`!`) in `src/domain/**` or `src/color/**`.
- Prefer discriminated unions over optional-field soup. Prefer `type` over
  `interface` unless you need declaration merging.
- Exported functions get explicit return types.

## Tests

- Test files sit next to their subject: `src/color/deltaE.test.ts`.
- **happy-dom silently drops `oklch()` from `background`/`background-color`**, so
  asserting on a rendered colour string compares against `""`. All colour goes
  through the `--fill-color` custom property (`setFillColor` in `src/ui/swatch.ts`);
  assert on that. happy-dom also has no layout and no canvas — geometry belongs in
  `e2e/`. More in `docs/history/README.md` § Environment traps.
- No optional chaining on the thing under test: `root.querySelector(".x")?.click()`
  silently passes when the selector is wrong. Use a `must()` helper that throws.
- Test **behavior and invariants**, not implementation details. No snapshot tests
  of markup.
- Every bug fix starts with a failing test that reproduces it.
- Color math must be checked against published reference values, not against
  whatever our implementation currently returns. If you cannot find a citable
  reference value, say so — do not invent one and do not pin the test to our own
  output.
- Property-based tests (fast-check) for anything with an algebraic invariant:
  round-trips, symmetry, monotonicity, bounds.
- Coverage floor: 90% on `src/color/**` and `src/domain/**`. UI has no floor —
  coverage there is a vanity metric.

## Dependencies

Runtime dependencies: **zero**. The shipped bundle is our own code.
Adding *any* dependency — runtime or dev — requires an ADR in `docs/adr/`
explaining what it replaces and why writing it ourselves is worse. "It's popular"
is not a reason.

## Style

- ESM only, `.ts` extension omitted in imports, `@/` alias for `src/`.
- Small modules, one concept each. If a file passes ~200 lines, it's probably two.
- Comments explain *why*, never *what*. Delete a comment that restates the code.
- No dead code, no commented-out code, no `TODO` without an issue reference.
- Biome owns formatting. Never hand-format; run `npm run lint:fix`.

## Commits

- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.
- One logical change per commit. Working tree stays green at every commit.
- Trailer: `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Never commit or push unless asked.

## Decisions

Anything architectural, any new dependency, any deviation from this file: write an
ADR in `docs/adr/NNNN-title.md` using the existing ones as the template. ADRs are
short — context, decision, consequences. They are immutable once merged;
supersede rather than edit, and add a superseded banner to the old one's status
line. Add the row to `docs/adr/README.md` in the same commit.

When you overrule a measured effect on judgement or feel, **write down what you
are accepting and how you would detect it later**. ADR 0008 is the worked example:
the afterimage bias it accepts is invisible, so the ADR says where to look if
scores ever skew.

## Keeping the docs true

Documentation that drifts is worse than none, because it is trusted. In the same
commit as the code:

- Behaviour changed → `docs/SPEC.md`
- A contract or module boundary changed → `docs/ARCHITECTURE.md`
- A decision changed → new ADR + banner on the old one + `docs/adr/README.md`
- Work completed or a gap found → `docs/BACKLOG.md`
- A decision superseded a `docs/research/` recommendation → add a banner at the head
  of that section. The file is append-only, so a banner is the sanctioned repair —
  editing the body destroys the citation trail. An unmarked superseded
  recommendation is the most dangerous artefact in the repo: it reads as current.

At the end of a session that produced reversals, non-obvious bugs, or tooling
surprises, append an entry to `docs/history/` and add any new gotcha to
`docs/history/README.md` § Environment traps. History is append-only: if an older
entry turns out to be wrong, say so in the new one rather than editing it.

Before claiming a doc is current, grep for stale references — file renames and
superseded decisions leave dangling mentions:

```
grep -rn "<old name>" docs/ src/ e2e/ CLAUDE.md README.md
```

## Scope discipline

Do the task asked. Do not opportunistically refactor adjacent code, rename things,
"improve" formatting of untouched files, or add features nobody asked for — it
buries the real diff. Note the opportunity in your report instead.
