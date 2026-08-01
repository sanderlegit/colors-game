# 0001 — Initial build

Date: 2026-08-01 · From an empty directory to a playable game.

## What was asked for

> A small webapp where you try to remember colors. You have 5 seconds to memorize
> the color; when it's over, the color fades into a color picker which covers the
> same shape area, and a preview of the full color is shown on the right. When the
> user confirms, their closeness is scored against distance from the correct answer.

Constraints set at the start: no framework, pure TypeScript, clean stack suitable
for macOS and mobile, heavy delegation of the setup work.

## Where it ended up

| | |
|---|---|
| Commits | 11, all on `main`, nothing pushed |
| Tests | 462 unit + 16 e2e (Desktop Chrome + iPhone 14) |
| Coverage | 100% on `src/color/**` and `src/domain/**` |
| Bundle | 9.6 kB gzipped, zero runtime dependencies |

## Order of work

1. **Toolchain** — TS 7 strict (`noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`), Vite 8 as bundler only, Vitest 4 + happy-dom,
   Biome, Playwright. CI on Node 26.
2. **Decision layer** — SPEC, ARCHITECTURE, CLAUDE.md, ADRs 0001–0002, backlog.
   The purity guard was written *and proven* by planting a `Math.random()` in
   `src/domain/` and watching the build fail.
3. **Colour-science research pass** — produced `research/color-science.md` and
   `research/test-vectors.md` with all 34 Sharma pairs. Everything downstream
   built against those numbers rather than re-deriving them.
4. **Pure core** — rng, state machine, selectors; then conversions, CIEDE2000,
   gamut, format; then scoring and target generation.
5. **Shell** — swatch, preview, hud, reveal, platform adapters, then the picker,
   then composition.
6. **Playtest → two reversals** (below).

## The two reversals

Both came from actually playing it, and both had already been decided the other
way with a written rationale. This is the most useful thing in this document.

### Picker: L×C plane → hue×chroma plane (ADR 0005 → 0007)

ADR 0005 chose an L×C plane at constant hue plus a hue slider, on a real
measurement: that layout has the flattest per-pixel scoring fairness, and
OKHSV/OKHSL are measurably worse than HSV.

The measurement was right and the conclusion was wrong, because it optimised
**precision** when the binding constraint is **searchability**. The plane showed
one hue at a time, so a player who had just memorised a colour had to *find* it by
scrubbing a slider and watching an unrelated plane churn. Per-pixel fairness is
irrelevant while you are lost.

The fix also removed a defect nobody had flagged: expressing chroma as a fraction
of the per-(L, h) maximum makes **the entire plane in gamut**, deleting the ~50%
inert region ADR 0005 had accepted.

**Lesson:** a good measurement can still answer the wrong question. Ask what the
user's *first* action is, not what their most precise one is.

### Dissolve: neutral mask → straight cross-fade (ADR 0006 → 0008)

The research pass surfaced a genuine perceptual defect in the original design:
five seconds of fixation leaves a negative afterimage, and because the picker
appears at the *same retinal location* — the whole point of the design — that
afterimage biases the guess away from the target hue. ADR 0006 added a 400ms
neutral grey mask.

Played, it reads as a hitch at exactly the moment the interaction must feel
continuous. Reverted.

**The bias is still real and is now unmitigated.** ADR 0008 records this
explicitly: it is invisible to playtesters, it costs points without feeling like
anything, and if scores ever show a hue-opponent skew, ADR 0006 is where to look.

**Lesson:** when overruling a measured effect on feel, write down what you are
accepting and how you would detect it. "We decided it felt better" is not
recoverable six months later.

## Bugs worth remembering

| Bug | How it was found | Why it matters |
|-----|------------------|----------------|
| HUD reflowed 44→73px between `memorize` and `picking`, dropping the stage 15px | e2e geometry assertion, **mobile only** | The picker and swatch were pixel-identical the whole time — the *page* moved under them. The memorised rect was not where the picker appeared. Two separate guarantees; only one holds by construction. |
| Reveal panel pushed the board 110px (desktop) / 43px (mobile) | User report | Reserving its height is the obvious fix and does not work: ~300px does not fit on a 664px phone. It became an overlay. |
| Reveal rendered at y=563, height 300, in a 664px viewport | Measuring while fixing the above | **The score was partly below the fold on mobile** and nobody had noticed. Masked by the bug above it. |
| `RoundResult` carried only `{deltaE, score}` | Writing the summary screen | A five-round breakdown would have shown the final target five times. Fixed the contract, not the symptom. |
| "A new best" could never fire | Reviewing own ordering | The composition root saved the record before the summary rendered, so `total > bestScore` was always false. The decision is now captured once on entry. |
| `?.click()` in a test silently no-opped | Test passed for the wrong reason | Optional chaining in tests hides selector typos. Use a `must()` helper that throws. |

## Deliberate deviations from the original request

- **Scored in CIEDE2000, not RGB distance.** Naive RGB distance does not match
  perception and players notice; the game would read as broken. (ADR 0004)
- **Seeded RNG from day one.** Not asked for. It makes the 5s timer and random
  colours testable and deterministic, and it makes a daily-challenge mode nearly
  free later. (ADR 0002)
- **Picker start position is neutral grey with a seeded-random hue.** A fixed
  start advantages targets near that hue; a random start hands out free wins.
  At C=0 the hue is invisible, so it leaks nothing. (SPEC §5.3)
- **The afterimage mask was added, then removed.** See above.

## The documentation was audited cold, and it failed in four places

After writing the docs, a **fresh agent with no session context** was asked five
questions that each required navigating to a different corner, and told to record
every file it opened and to be harsh. This is cheap and worth repeating whenever
the doc set changes shape.

Four of five questions were answered on the second file opened. The failures were
the useful part:

1. **`research/color-science.md` § Picker UX was superseded but unmarked** — and
   the routing table sent every `src/color/**` task straight into it. It still
   prescribed the ADR 0005 picker *and* the ADR 0006 mask, both reverted. Worse,
   its picker ranking opens with "OKHSL — best", so an agent entering through
   research rather than the ADR log would have confidently recommended the one
   thing the decision log lists as pre-rejected. **Both sections now carry
   superseded banners.** Append-only means adding a banner, not editing the body.
2. **No route to "I want to tune the score curve."** The answer was split across
   three documents with nothing linking them, and no document named the constants,
   so the only path to `SCORE_SCALE` was grepping source. `TUNING.md` now exists.
3. **The happy-dom `oklch()` trap was filed under "hitting a weird failure"** —
   i.e. discoverable only after it had already cost an hour. It is prevention
   material, so it moved into `CLAUDE.md` § Tests, which every agent loads.
4. **Two stale sentences survived in the conclusions readers act on**:
   ARCHITECTURE's performance budget and BACKLOG's known gaps both still said the
   canvas repaints on *hue* change, while passing prose elsewhere in the same
   files correctly said lightness. Anyone profiling would have instrumented the
   wrong event.

Also worth knowing: **the audit reported one finding that was simply wrong** — it
claimed `CLAUDE.md` still named `tests/purity.test.ts`, which had already been
fixed. Every finding was re-verified against the files before acting; a confident
audit is still just a claim.

## What was not done

Tracked in `../BACKLOG.md` § Known gaps. In short: no real-device pass, no
keyboard-only playthrough, repaint budget missed (11ms vs 4ms), difficulty tiers
implemented but not reachable from the UI, no settings screen, `src/platform/seed.ts`
untested.
