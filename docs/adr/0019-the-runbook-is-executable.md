# 0019 — The runbook is executable: a justfile that wraps npm

Date: 2026-08-02 · Status: accepted

## Context

`package.json` scripts are the entry points and CI calls them directly. They are
a good fit for the things CI runs, and a bad fit for three things it does not:

- **Sequences.** "Run the real stack locally" was three commands copy-pasted out
  of `OPERATIONS.md` § 3. Prose that has to be retyped is prose that drifts, and
  the reader has no way to tell that it has.
- **Parameters.** `npm run x -- --flag` works; `npm run health <origin>` does
  not. A health check that cannot be pointed at a different origin is a health
  check for one origin.
- **Lifecycles.** Putting the stack on a tailnet and taking it off again is two
  operations on a resource that outlives the process, which is not what an npm
  script is shaped like.

The alternative was more npm scripts and a longer runbook. That is how
`OPERATIONS.md` § 3 got a three-line block nobody could verify was still right.

## Decision

**A `justfile` at the repo root. `npm run *` stays canonical.**

1. **CI calls npm and never `just`.** No recipe can become the only way to run
   something, and a broken justfile cannot break a deploy. `just` is not in
   `package.json`, not in the bundle, and the repo is completely usable without
   it — so this is not a dependency in the sense CLAUDE.md governs, and it is
   recorded here rather than in § Already rejected for that reason.
2. **Anything CI runs is a one-line forward** — `check` is `npm run verify`,
   nothing more. A recipe that reimplements a command instead of calling it is
   the bug this decision is trying not to create.
3. **Only the things npm cannot express get real bodies**: `serve`, `tailnet`,
   `health`, `smoke`. None of them runs in CI today. If one ever needs to, it
   moves into `scripts/` and both callers invoke the script.
4. `just` with no arguments lists every recipe with a one-line summary, so the
   file is the index as well as the implementation.

## Consequences

- **Two files name the same operations**, which is a drift risk taken
  deliberately and bounded by rule 2: the npm script is the definition and the
  recipe is a pointer to it. A recipe body containing anything other than
  `npm run …` for a CI-run task should fail review.
- **`just` has to be installed** (`brew install just`). Everything it wraps still
  works without it, and `just --list` is the only thing you lose.
- **`OPERATIONS.md` documents commands that can be run**, rather than sequences
  that must be retyped. The runbook and the tool can still disagree, but now only
  about *why*, not about *what*.
- The recipes that are not forwards are exactly the ones with no test coverage,
  because they are about processes and hostnames rather than code. `just smoke`
  is the mitigation: it is the only thing that checks the serving path end to
  end, and it is deliberately runnable against any origin.
