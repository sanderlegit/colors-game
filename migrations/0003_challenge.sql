-- Seed challenges (ADR 0024).
--
-- A game is now one of two kinds:
--
--   'open'      — a self-minted seed, the only kind before this migration and
--                 the only kind that may raise `players.best_score`.
--   'challenge' — a game played on a seed that was *chosen* from an existing
--                 game (a share link). Chosen seeds cannot raise the global
--                 best score, or a player would farm the easiest seed on the
--                 board — the exact thing ADR 0015 forbids. They rank only on
--                 that seed's own board.
--
-- The distinction is what `submit.ts` reads to decide `ranked`: an open game is
-- ranked when unflagged, a challenge game never is. Everything else about a
-- challenge game — replay, flags, telemetry, the resubmit guard — is identical.

ALTER TABLE games ADD COLUMN kind TEXT NOT NULL DEFAULT 'open';

-- The per-seed board (`GET /api/leaderboard?forGame=…`): best finished, unflagged
-- game per seed. Both kinds appear here — the open game that originated the seed
-- competes on it too — so the index is on `(seed, total_score DESC)` with the
-- board's own `status='finished' AND flags=0` filter, not on `kind`. The window
-- query in `d1.ts` picks the top row per player under exactly this order.
CREATE INDEX games_seed_board ON games(seed, total_score DESC)
  WHERE status = 'finished' AND flags = 0;
