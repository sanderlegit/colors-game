-- Leaderboard reset for the SCORE_SCALE 16 → 18 generosity retune (ADR 0028).
--
-- Every stored `games.total_score` and `players.best_score` was computed under
-- τ = 16. The retune changes the curve, and stored scores do not re-derive
-- (ADR 0016) — the server keeps a row's own total precisely so a retune does not
-- silently rewrite history. That guarantee is what makes old and new entries
-- INCOMPARABLE once the constant moves: a 340 earned under τ = 16 and a 340
-- earned under τ = 18 are different achievements sharing a number. Rather than
-- carry two incomparable eras on one board, we reset it once, here, so every
-- ranked score on the board was earned under one curve.
--
-- This is data-only, not a shape change, so it does not break the expand-only
-- rule (the old Worker meets an empty board during the deploy window, which is a
-- valid state — it simply shows no rows). Telemetry (`round_stats`, `game_stats`)
-- is deliberately left intact: it stores ΔE/hue buckets and counts, not points,
-- so it stays valid across the retune and still answers the operational
-- questions (including the afterimage hue-skew query, OPERATIONS § 2.3).
--
-- Player identities and claimed names are kept — only their scores and per-player
-- game history are cleared, so a returning player is still themselves with a
-- clean slate.

DELETE FROM games;

UPDATE players
SET best_score = 0,
    best_game_id = NULL,
    games_played = 0;
