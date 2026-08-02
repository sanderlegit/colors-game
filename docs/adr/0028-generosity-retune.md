# 0028 — Score-curve generosity τ 16 → 18, and a one-time leaderboard reset

Date: 2026-08-02 · Status: accepted
Refines: [ADR 0004](0004-perceptual-scoring.md) · Related: [ADR 0016](0016-server-side-replay-on-workers.md)

## Context

Playtesters reported that guesses "feel closer than the score says." Phase 1
(history 0013) established that a large part of that is perceptual — the
afterimage bias and the plane hiding lightness — and shipped a per-axis breakdown
that explains the score without changing it. But one part is the curve itself:
at reveal the guess and target sit **side by side**, where a ΔE00 of 5–8 reads as
"basically right," yet ADR 0004's τ = 16 scores it 85 / 71. Side by side, that
feels stingy in a way it does not when the target is only a memory.

The originally-planned Phase 2 also included **per-tier** generosity (equalising
the harder-to-score desaturated tiers). Two findings killed that for now:

- **Ranked play is single-tier.** The server only ever issues `normal`
  (`server/decode.ts` `ISSUABLE_DIFFICULTIES = [DEFAULT_DIFFICULTY]`); easy/hard
  are an unreachable backlog gap. Per-tier τ therefore changes *nothing* on the
  board until the tiers are made reachable — that is its own feature, with its own
  ADR, and it can carry the per-tier curve when it lands.
- **Per-tier τ does not cleanly equalise.** Measured, equalising *skilled* scores
  across tiers (τ ∝ the tier's ΔE amplification, ≈ 1 : 1.12 : 1.55) turns the
  desaturated tier into a **random-guess lottery** — chance-level P(score > 50)
  roughly doubles — because near-neutral targets compress the whole ΔE
  distribution, not just small errors. One knob cannot fix both ends.

So the scope here is deliberately narrow: a single global generosity nudge to the
one tier anyone plays.

## Decision

`SCORE_SCALE` (τ) moves **16 → 18**. Nothing else about the curve changes —
metric (CIEDE2000), shape (`k = 1.3`) and deadband (`d₀ = 1`) are ADR 0004's and
stay. The retuned reference points:

| ΔE00 | 2 | 5 | 8 | 12 | 20 | 30 | 45 |
|------|---|---|---|----|----|----|----|
| τ=16 (old) | 97 | 85 | 71 | 54 | 29 | 11 | 2 |
| **τ=18 (new)** | **98** | **87** | **75** | **59** | **34** | **16** | **4** |

The whole curve lifts a few points through the mid-range where "close but not
perfect" lives. The cost: a purely random guess beats 50 points ≈ 6.8% of the
time instead of 5.4% (ADR 0004's method) — still low enough that a good score
means something.

**This required a one-time leaderboard reset** (`migrations/0005_reset_leaderboard.sql`).
Stored `total_score` values were computed under τ = 16 and do not re-derive: the
server keeps each row's own total precisely so a retune never rewrites history
(ADR 0016), which is exactly what makes τ = 16 and τ = 18 scores incomparable.
The migration clears `games` and zeroes `players.best_score`, keeping identities,
names, and telemetry. There is no scoring-version column and we did not add one:
a single reset at the discontinuity is simpler than carrying an era tag on every
row for a curve we expect to touch rarely.

## Consequences

- The pinned constant and reference points in `src/domain/scoring.test.ts` move
  with the curve, as do the figures quoted in `SPEC.md` §6 and `player-guide.md`.
  These are the same three surfaces TUNING.md warned a retune must update.
- The replay gate (ADR 0016) is **unaffected**: the replay vectors pin target
  *colours*, not scores, and the metric is unchanged. `npm run e2e:backend` still
  agrees bit-for-bit; only the score a given ΔE maps to changed.
- **How to detect a mistake later:** if the board fills with implausibly high
  totals or chance-level scores climb, τ is too high — watch `game_stats`. If the
  reset is ever repeated, this ADR is the template; do not add a version column
  without a reason the single-reset approach cannot serve.
- The deferred per-tier work (S2) is unblocked the moment difficulty tiers are
  made issuable; this ADR's `SCORE_SCALE` becomes the `normal` entry of a
  per-tier table at that point.
