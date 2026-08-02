# 0015 — Phase 2: score generosity, the chroma-axis warp, and a measurement that said "wait"

2026-08-02. The deferred half of the picker/scoring work (history 0013). It did
not land the way the plan assumed, and the reasons are the useful part.

## The plan assumed tiers mattered. They don't (yet).

Phase 2 was staged as "one scoring reset" whose headline was **per-tier**
generosity (S2): equalise the score for the desaturated tiers that CIEDE2000
scores more harshly. Mapping the backend first killed that:

- **Ranked play is single-tier.** `server/decode.ts` `ISSUABLE_DIFFICULTIES =
  [DEFAULT_DIFFICULTY]` — the server only ever issues `normal`; the client sends
  no difficulty. Easy/hard are an unreachable backlog gap. Per-tier τ changes
  **nothing** on the board until the tiers are made reachable, which is its own
  feature with its own ADR.
- **Per-tier τ does not cleanly equalise anyway.** Measured (20k targets/tier,
  isotropic OKLab error): equalising *skilled* scores needs τ ∝ the tier's ΔE
  amplification (≈ 1 : 1.12 : 1.55), but that turns the desaturated tier into a
  **random-guess lottery** — P(random > 50) roughly doubles — because near-neutral
  targets compress the whole ΔE distribution, not just small errors. One knob
  cannot fix both the skilled and the chance end.

So S2 was dropped, and the owner chose the one scoring change that touches the
tier people actually play: a **global** generosity bump.

## What shipped

1. **Score generosity τ 16 → 18** (ADR 0028), refining ADR 0004. Mid-range scores
   lift a few points (ΔE 12: 54 → 59), so a guess that reads close *side by side at
   reveal* is rewarded more like it looks. Cost: random-beats-50 rises 5.4% →
   ~6.8%. This forced a **one-time leaderboard reset**
   (`migrations/0005_reset_leaderboard.sql`) because stored scores were computed
   under τ = 16 and do not re-derive (ADR 0016). The migration clears `games` and
   zeroes `players.best_score` but **keeps telemetry** (`round_stats`) and player
   identities. The replay gate is unaffected — vectors pin target *colours*, not
   scores — and `e2e:backend` still agrees bit-for-bit.

2. **The plane's chroma (y) axis is perceptually warped** (`CHROMA_WARP = 8`).
   Measured, a linear chroma axis is badly front-loaded: the bottom quarter holds
   ~half the grey→vivid ΔE, so near grey a pixel moved ~3× the ΔE it did near full
   chroma. The warp `t = ((1+β)^s − 1)/β` spends screen space in proportion to
   perceptual distance; it roughly halves the unevenness (max/min ΔE per equal
   step ~3.1 → ~1.8). It is **hue-independent on purpose** — the exact curve varies
   per hue, but a per-column warp would cost a ΔE bisection per rendered pixel and
   break "a row is one chroma level". The screen↔t map lives in four functions
   (`planePointFromPointer`, `planeFraction`, `renderPlanePixels`, the vertical
   nudge); the vertical nudge now steps *screen* space, so it is constant ΔE
   everywhere. This does **not** need a reset — it is picker feel, not scoring.

## The measurement that said "not yet" (afterimage, P4)

The owner chose "measure before touching the dissolve." Ran OPERATIONS § 2.3
against prod: **25 rounds total, max 4 in any hue bucket**, against the query's
floor of 20/bucket. The afterimage hue-skew is simply not measurable yet — needs
~50× more play. So P4 (the neutral-ramp mitigation) stays deferred, which is
exactly what "measure first" is for. The reset deliberately preserves
`round_stats`, so those 25 rows and everything after them survive for when the
question can actually be answered.

## Non-obvious bits

- **A stale doc number propagated into two files.** The `SCORE_SCALE` comment and
  TUNING both claimed "at 18, ΔE 12 scores 67" — it is 59 (67 is τ ≈ 22). Fixed
  while retuning; the lesson is the usual one (prose next to a decision is trusted
  as hard as the decision).
- **The warp round-trips cleanly, so the DOM pointer tests didn't move.** Cursor
  placement is `planeFraction ∘ planePointForColor ∘ planePointFromPointer`; the
  warp and its inverse cancel, so a pointer at y still lands the cursor at y. Only
  tests that inspected the *intermediate* `t` against a linear assumption broke
  (five of them), plus the reveal reticle's vertical position.
- **`chromaFractionFromScreen(0.5)` is exactly 0.25** and `screenFromChromaFraction(0.25)`
  exactly 0.5, because `9^0.5 = 3` and `ln 9 = 2 ln 3` hold in IEEE doubles — handy
  for exact-match tests.
