-- The display name is snapshotted onto each game (ADR 0029 — the name-model
-- rework). This is the EXPAND step; readers still draw the board from
-- `players.name` until the reader flip lands. Apply with:
--   npx wrangler d1 migrations apply colors --local     (dev)
--   npx wrangler d1 migrations apply colors --remote    (production, via CI)
--
-- ## Why the name moves onto the game
--
-- Today the name lives on the mutable `players` row and the board reads it live,
-- so renaming relabels every past entry and a shared device (one cookie) merges
-- two people into one row. A game is the thing that earned a score, so the name
-- it was earned under belongs on the game, not on the identity. Once boards read
-- `games.name`, a rename can no longer rewrite history and two names on one
-- device become two board rows. See ADR 0029.
--
-- ## Expand-only, and the backfill's honest limit
--
-- Adding two nullable columns and an index is invisible to the pre-flip Worker
-- (it never selects them), so this is safe to apply before the code that reads
-- them (OPERATIONS § 3). The backfill copies each finished game's name from its
-- player's *current* name — the only name in the system. For a player who has
-- since renamed, that is not the name the game was actually played under: that
-- value was never stored and is unrecoverable. The snapshot is therefore correct
-- from here forward and best-effort for history; ADR 0029 records this.

ALTER TABLE games ADD COLUMN name TEXT;
ALTER TABLE games ADD COLUMN name_key TEXT;

-- The global board is the best finished, unflagged, `open` game per named player.
-- This index serves the reader flip; it is added here so the expand step is one
-- migration. `name_key IS NOT NULL` mirrors the board's "has a name" predicate.
CREATE INDEX games_name_board ON games(total_score DESC)
  WHERE status = 'finished' AND flags = 0 AND kind = 'open' AND name_key IS NOT NULL;

-- Best-effort backfill from the player's current name (see the limit above).
UPDATE games
   SET name = (SELECT p.name FROM players p WHERE p.id = games.player_id),
       name_key = (SELECT p.name_key FROM players p WHERE p.id = games.player_id)
 WHERE status = 'finished' AND player_id IS NOT NULL AND name IS NULL;
