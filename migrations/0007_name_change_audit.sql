-- A durable, subject-bearing audit of name changes (ADR 0031).
--
-- Apply with:
--   npx wrangler d1 migrations apply colors --local     (dev)
--   npx wrangler d1 migrations apply colors --remote    (production, via CI)
--
-- ## Why this table exists, and why it is a different kind of table
--
-- A bug where one device renamed itself back and forth was undetectable from the
-- logs: a rename left no distinct signal, and Workers Logs keep only 3 days
-- anyway. This records each name change durably so "this identity toggled between
-- two names repeatedly" is a query, not a lost cause.
--
-- Unlike the ADR 0014 counters (`round_stats`, `game_stats`), which are day-keyed
-- aggregates with **no subject**, this row names a `player_id` — so it carries a
-- subject-access and delete obligation. Two things follow, both enforced in code:
-- it is deleted with the player (`Repo.deletePlayer`), and it is bounded by a
-- retention sweep pass (ADR 0031, `server/sweep.ts`, OPERATIONS § 6).
--
-- ## What it stores, and what it deliberately does not
--
-- Folded name **keys**, never display names: enough to see that two changes are
-- the same or different names, not enough to read the names back out. `old` is
-- null on a first claim (there was no prior name); `new` is never null, because a
-- name only reaches the fold point (`decodeName`) non-empty.

CREATE TABLE name_changes_audit (
  player_id    INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  at           INTEGER NOT NULL,
  old_name_key TEXT,
  new_name_key TEXT NOT NULL
);

-- `player_id` for the delete cascade and per-player forensics; `at` for the
-- oldest-first, bounded retention sweep.
CREATE INDEX name_changes_audit_player ON name_changes_audit(player_id);
CREATE INDEX name_changes_audit_at ON name_changes_audit(at);
