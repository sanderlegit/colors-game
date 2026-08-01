# Decision log

ADRs are **immutable once merged**. To change a decision, write a new ADR that
supersedes the old one and add a superseded banner to the old one's status line.
Never edit the body of a merged ADR — the reasoning that turned out to be wrong is
the most valuable thing in here.

## Index

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-no-ui-framework.md) | No UI framework; pure TypeScript + DOM | accepted |
| [0002](0002-functional-core-imperative-shell.md) | Functional core, imperative shell; injected time and randomness | accepted |
| [0003](0003-fast-check-for-property-tests.md) | fast-check for property tests | accepted |
| [0004](0004-perceptual-scoring.md) | CIEDE2000 + stretched-exponential score curve | accepted |
| [0005](0005-picker-geometry.md) | L×C plane at constant hue + hue slider | **superseded by 0007** |
| [0006](0006-afterimage-mask.md) | Dissolve through a neutral afterimage mask | **superseded by 0008** |
| [0007](0007-picker-shows-every-hue.md) | Picker plane shows every hue; lightness on a bar | accepted |
| [0008](0008-dissolve-straight-into-the-picker.md) | Dissolve goes straight into the picker | accepted |
| [0009](0009-score-screen-in-place-reticle.md) | Score screen keeps the picker in place with a target reticle | **superseded by 0010** |
| [0010](0010-result-in-a-persistent-side-panel.md) | Result lives in a persistent side panel; nothing shifts on reveal | accepted |

## Already rejected — do not re-propose without new evidence

Each of these looks like an obvious improvement and is not. If you are about to
suggest one, read the linked ADR first; if you still think it's right, you need an
argument that engages with the reason it was rejected.

| Idea | Why not | Where |
|------|---------|-------|
| Add React/Vue/Svelte/Lit | ~10 components, no lists, the one hard component is a canvas driven imperatively anyway | 0001 |
| Any runtime dependency | Bundle is ours. Zero runtime deps is a standing constraint; even a dev dep needs an ADR | 0001, CLAUDE.md |
| `setTimeout` for the 5s memorize timer | Timer is domain logic; it lives in `reduce` and is tested with two timestamps | 0002 |
| CIE94 for scoring | Asymmetric: ΔE(a,b) ≠ ΔE(b,a). Neither colour is a "reference" in a game | 0004 |
| CAM16-UCS | Needs viewing-condition parameters a web page cannot know | 0004 |
| OKLab ΔE as a cheaper ΔE00 | No single scaling constant — the ratio swings 2.7× across the gamut | 0004 |
| OKHSV / OKHSL picker | Does not fix what it looks like it fixes: dead-axis area gets *worse* (HSV 24% → OKHSV 26% → OKHSL 29%), because the problem is topological, not colorimetric. (On the other measured column, unfairness ratio, OKHSL does beat HSV 3.5× vs 4.0× — the rejection rests on dead-axis area and, decisively, on 0007's searchability argument.) | 0005 → 0007 |
| L×C plane at constant hue | Flattest fairness, but the player cannot *find* the colour — hue is invisible | 0005 → 0007 |
| Neutral mask in the dissolve | Perceptually justified, but reads as a hitch at the moment that must feel continuous | 0006 → 0008 |
| Clamping RGB channels to fix out-of-gamut | Shifts hue by up to 69°. Reduce chroma at constant L and h instead | 0004, `src/color/gamut.ts` |
| Reserving the reveal panel's height in the grid | ~300px does not fit on a 664px phone beside the swatch, HUD and preview. It is an overlay | history/0001 |
| Pixel-diff visual regression on the picker | GPU and font differences make it flaky across machines for no real defect signal | SPEC §9.5 |

## Open tensions we are knowingly carrying

- **The afterimage bias is real and unmitigated** (0006 → 0008). Five seconds of
  fixation biases the guess away from the target hue, invisibly. If scores ever
  show a systematic hue-opponent skew, 0006 is the first place to look.
- **Hue precision is now bounded by plane width** (0007). Fine on desktop and a
  modern phone; would degrade on a very narrow viewport.
- **Repaint budget is missed** — 11ms against a 4ms target, on lightness change
  only. See `../BACKLOG.md`.
