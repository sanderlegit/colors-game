# 0014 — Telemetry is aggregate counters, not events

Date: 2026-08-02 · Status: accepted

## Context

Two questions justify collecting anything at all: *is the difficulty right*, and
*is it fun*. Neither is answerable from the code, and both are answerable from a
very small amount of data — if it is the right shape.

The default shape is one row per event, keyed by player, queried later. That is
the shape that creates a subject-access obligation, a retention policy, a deletion
path, and a table that grows with player count.

There is also a platform constraint that turns out to be a design hint rather than
an obstacle. Workers Logs retains **3 days** on the free plan. Debugging exhaust
expiring in 3 days is correct. Difficulty history expiring in 3 days is useless.
The platform is enforcing a separation that ought to exist anyway.

## Decision

Two streams with different contracts:

| Stream | Where | Retention | Contract |
|---|---|---|---|
| Access + application logs | Workers Logs, one wide JSON event per request | 3 days | Debugging exhaust. Shape changes freely. |
| Game events | D1 pre-aggregated counter tables | indefinite | A data contract. Additive-only, versioned. |

Rule of thumb: *if you would be sad to lose it in 3 days, it goes in D1, not a log
line.*

Game events (`game_started`, `round_completed`, `round_abandoned`,
`game_completed`, `game_restarted`) upsert into bucketed counters:

```sql
CREATE TABLE round_stats (
  day TEXT, difficulty TEXT, round_index INTEGER,
  delta_e_bucket INTEGER, hue_bucket INTEGER, n INTEGER,
  PRIMARY KEY (day, difficulty, round_index, delta_e_bucket, hue_bucket)
);  -- INSERT … ON CONFLICT DO UPDATE SET n = n + 1
```

**Buckets and percentiles, never means.** SPEC §6 already reached this conclusion
for the UI — any averaged score shown is a median, because the random-guess
distribution is heavily right-skewed and a mean misleads. The identical reasoning
applies to telemetry, and a mean ΔE would be actively misleading about difficulty.

## Consequences

- **There is no per-player row to leak, subject-access, or delete.** Aggregates are
  not personal data, which is what keeps this inside the CNIL audience-measurement
  exemption criteria. A per-round table keyed by identity token would not be.
- Write volume tracks *distinct buckets*, not player count, so this stays free at
  any plausible scale.
- Percentiles are a `SELECT`, not a pipeline.
- **`hue_bucket` exists for one specific reason.** ADR 0008 knowingly accepted an
  unmitigated afterimage bias and said that if scores ever show a systematic
  hue-opponent skew, ADR 0006 is the first place to look. Bucketing by target hue
  is what makes that detectable at all — until now the instrument ADR 0008 asked
  for did not exist.
- The interpretive anchors are already ours: SPEC §6 puts chance level near ΔE 11,
  so a p50 near 11 means players are not beating chance and the game is broken
  regardless of how the scores read; under ΔE 2 it is trivial. `SCORE_SCALE` is
  the knob `TUNING.md` already names first.
- **Cost: you cannot ask a question you did not bucket for.** Re-slicing history by
  a dimension nobody chose up front is impossible, not merely expensive. That is
  the price of holding no raw events, and it is accepted.
- The identity token is a session identifier under OWASP's logging exclusion list,
  so it is never logged in the clear; raw IPs are never persisted at all, and
  request headers are allow-listed rather than dumped — a debugging
  `console.log({headers})` would otherwise put the cookie into the log store.
- Suppress buckets with `n < 20` before publishing anything public.
