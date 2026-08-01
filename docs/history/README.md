# History

Append-only record of what actually happened, session by session. ADRs say what
was decided and why; history says what was *tried*, what broke, and what the
environment did to us. Neither is reconstructable from the code.

**Write a new entry when a session produces reversals, non-obvious bugs, or
tooling surprises.** Do not rewrite old entries — if something recorded here later
turned out to be wrong, say so in the newer entry.

## Index

| # | Session | What came out of it |
|---|---------|---------------------|
| [0001](0001-initial-build.md) | 2026-08-01 — initial build | Whole game from empty directory. Two design reversals after playtest, three layout bugs only visible at phone viewport. |

## Auditing the docs

When the documentation set changes shape, hand a **fresh agent with no session
context** four or five questions whose answers live in different corners, and tell
it to record every file it opens and to be blunt about what broke. Session 0001
did this and it found a superseded research section that would have led an agent
to rebuild two reverted designs.

Two rules: route it through the real entry point (`CLAUDE.md` → `docs/README.md`)
rather than pointing it at answers, and **re-verify every finding against the
files before acting** — that audit included one confident claim that was false.

## Environment traps

Discovered the hard way. Each one cost real time; none is guessable from the code.

### Toolchain

- **TypeScript 7 removed `baseUrl`.** Path aliases in `tsconfig.json` must be
  relative: `"@/*": ["./src/*"]`. The alias must be kept in sync across
  `tsconfig.json`, `vite.config.ts` and `vitest.config.ts`.
- **Two TypeScript projects, deliberately.** `tsconfig.json` covers browser code
  with DOM libs; `tsconfig.node.json` covers config files and `*.node.test.ts`
  with Node types. Mixing them makes `setTimeout` return `NodeJS.Timeout` in
  browser code. `npm run typecheck` runs both. A test that reads the filesystem
  belongs in the node project — name it `*.node.test.ts`.
- **`exactOptionalPropertyTypes` rejects `{ foo: undefined }`.** To pass an
  optional prop through, omit the key entirely:
  `deps.formatHex === undefined ? {} : { formatHex: deps.formatHex }`.
- **Playwright's `iPhone 14` descriptor defaults to WebKit.** Pinned to
  `browserName: "chromium"` so CI only installs one browser. You get the viewport,
  DPR, touch and UA — not true iOS Safari fidelity. For that, drop the override
  and add webkit to the CI install step.
- **Biome's `complexity/noImportantStyles` is disabled repo-wide** for one reason:
  the `prefers-reduced-motion` block legitimately needs `!important` to beat the
  inline `--dissolve-duration` the swatch writes.

### Testing

- **happy-dom's CSS parser silently drops `oklch()`** from `background` and
  `background-color`. Assigning `el.style.background = "oklch(...)"` leaves `""`,
  so every component test would assert on an empty string. **All colour rendering
  goes through the `--fill-color` custom property** via `setFillColor` in
  `src/ui/swatch.ts`; custom properties round-trip raw. This is why the pattern
  exists — do not "simplify" it back to `style.background`.
- **`console.log` inside vitest is swallowed** in this setup. To surface a value
  while debugging, assert on it rather than logging it.
- **happy-dom has no layout and no canvas rendering.** Geometry and pixels cannot
  be tested there. `src/ui/picker.ts` is therefore split: pure exported coordinate
  maths (fully tested, property-based) plus a thin DOM wrapper that takes
  `measure` and `getContext` injections. Keep that split.
- **Layout bugs are invisible to unit tests and to desktop.** Three separate ones
  in this repo only appeared at the iPhone 14 viewport. Assert geometry in
  `e2e/game.spec.ts`.

### Colour science

Full detail in `../research/color-science.md`. The three that bite hardest:

- **CSS `lab()` is D50. We use D65 with no chromatic adaptation.** Mixing them
  puts sRGB blue at L\* 29.57 instead of 32.30 — a large, silent divergence. A
  test asserts the D65 value *and* that it is not the D50 one, so a switch fails
  the build.
- **The two sRGB transfer-function thresholds are different numbers**
  (0.04045 decode, 0.0031308 encode). One shared constant is a bug. Continuity at
  the encode breakpoint is only ~2.9e-8, not exact — that step is real.
- **CIEDE2000 is full of traps** — signed ΔC′/ΔH′, a four-case mean hue, the R_T
  rotation term. Naive implementations pass the CIE's own worked examples while
  being wrong. This is why `src/color/deltaE.test.ts` runs all 34 Sharma/Wu/Dalal
  pairs; keep them.
