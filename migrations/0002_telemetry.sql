-- ADR 0014's aggregate counters, plus the client-error store.
--
-- Apply with:
--   npx wrangler d1 migrations apply colors --local     (dev)
--   npx wrangler d1 migrations apply colors --remote    (production, gated in CI)
--
-- **D1 migrations are not applied by a deploy.** `wrangler pages deploy` ships
-- the Worker and touches nothing else, so a schema change that is not applied by
-- hand — or by the gated step in `.github/workflows/ci.yml` — is a Worker
-- talking to the old schema. That is the classic D1 outage.
--
-- ## This migration is expand-only, which is what makes it safe to roll back
--
-- It adds three tables and alters none. A Worker rolled back to the code before
-- it meets these tables and simply never writes to them; a Worker rolled forward
-- before the migration runs fails only inside `waitUntil`, where nothing a
-- player sees is waiting. Any later change that *narrows* a shape has to be
-- expand → migrate → contract across two deploys for the same reason.
--
-- ## There are still no per-round and no per-player rows
--
-- ADR 0016 explains why there is no `rounds` table; ADR 0014 explains why there
-- is no per-event one. Everything below is a counter keyed by a bucket, so write
-- volume tracks distinct buckets rather than player count, and there is nothing
-- here to subject-access or delete. `day` is a UTC date, never a timestamp: two
-- games by one player on one day are indistinguishable from two by two players.

-- Round-level difficulty evidence. One row per (day, tier, window, round, ΔE
-- bucket, hue bucket); `n` is how many rounds landed in it.
--
-- Two departures from the DDL sketched in ADR 0014, both additive, which is the
-- contract that ADR names ("additive-only, versioned"):
--
--   * `memorize_ms` is part of the key. It is the *only* difficulty knob v1
--     exposes (SPEC §8 — 3s/5s/8s), because `decodeStartGame` refuses any tier
--     but `normal`, so a distribution without it cannot answer whether the
--     memorize setting changes anything. Without bucketing for it now, that
--     question is unanswerable later — re-slicing history by a dimension nobody
--     chose up front is impossible, not merely expensive.
--   * `NOT NULL` on every column and `WITHOUT ROWID`, matching `mint_buckets`.
--     A NULL in any key column would silently split a bucket in two.
--
-- `delta_e_bucket` is the floor of ΔE00 in 1-unit steps, capped at 40; the cap
-- exists because above it the round already scores under 3/100 and the exact
-- value says nothing about difficulty. SPEC §6 puts chance level near ΔE 11, so
-- 1-unit resolution is what a p50 needs to distinguish "beating chance" from
-- "not". `hue_bucket` is the target hue in twelve 30° buckets — see ADR 0008 and
-- `docs/OPERATIONS.md` for why that column is the point of this table.
CREATE TABLE round_stats (
  day TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  memorize_ms INTEGER NOT NULL,
  round_index INTEGER NOT NULL,
  delta_e_bucket INTEGER NOT NULL,
  hue_bucket INTEGER NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (day, difficulty, memorize_ms, round_index, delta_e_bucket, hue_bucket)
) WITHOUT ROWID;

-- Game-level counters. `event` is text rather than an enum so a new observable
-- event is a new value, not a migration.
--
-- v1 writes three: 'started' when a game is minted, 'completed' when one is
-- submitted for the first time, and 'flagged' alongside 'completed' when the
-- game carried an ADR 0015 flag bit — which is the first time anything has read
-- `games.flags` back at all.
--
-- **'started' counts mints, not plays.** `src/main.ts` issues a ranked game
-- ahead of the Play click, so a session that never plays still increments it.
-- completed/started is therefore a lower bound on the completion rate; see
-- `docs/OPERATIONS.md`.
CREATE TABLE game_stats (
  day TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  memorize_ms INTEGER NOT NULL,
  event TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (day, difficulty, memorize_ms, event)
) WITHOUT ROWID;

-- Browser exceptions, deduplicated by a hash of (message, stack) and a day.
--
-- This is the one table here that holds text rather than counts, and it is the
-- one with a retention limit: 30 days, enforced by `Repo.recordClientError`
-- deleting older days on every write. A retention promise that depends on a cron
-- job nobody has written is not a promise.
--
-- NOTE (ADR 0023, after this migration was applied): the cron now exists, and
-- the write-side purge turned out to be half the answer — it bounds new rows and
-- leaves old ones once reports stop arriving, which is the healthy state. Both
-- run now. The schema is unchanged; this note is here because the paragraph
-- above reads as current and is no longer complete.
--
-- Nothing identifies the reporter: no token, no address, no URL. The dedup key
-- is what keeps one broken browser in a reload loop from becoming a firehose,
-- and `limits.ts` bounds the case dedup cannot help with.
CREATE TABLE client_errors (
  fingerprint TEXT NOT NULL,
  day TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  n INTEGER NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (fingerprint, day)
) WITHOUT ROWID;

-- Both the retention delete and "what broke today" scan by day.
CREATE INDEX client_errors_day ON client_errors(day);
