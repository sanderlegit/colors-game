# Working agreement for agents in this repo

Read `docs/SPEC.md` and `docs/ARCHITECTURE.md` before writing code. They are the
source of truth; this file is how you work.

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
`tests/purity.test.ts` scans these directories and fails the build on violation.
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
supersede rather than edit.

## Scope discipline

Do the task asked. Do not opportunistically refactor adjacent code, rename things,
"improve" formatting of untouched files, or add features nobody asked for — it
buries the real diff. Note the opportunity in your report instead.
