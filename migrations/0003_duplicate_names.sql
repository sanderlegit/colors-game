-- Display names no longer have to be unique (ADR 0024).
--
-- Apply with:
--   npx wrangler d1 migrations apply colors --local     (dev)
--   npx wrangler d1 migrations apply colors --remote    (production)
--
-- ## Why the unique index goes
--
-- Two people wanting to be `ada` is not contention to resolve, it is the normal
-- shape of a casual leaderboard. The old partial unique index on `name_key`
-- turned the second `ada` into `ada-2`, which reads as the game correcting the
-- player. Dropping the index lets both rows keep the name they typed. Existing
-- suffixed rows (`ada-2`) are left exactly as they are — they are valid names,
-- just no longer minted.
--
-- ## Why the board index gains `id`
--
-- `players_board` was `(best_score DESC, name)`, and that was a *total* order
-- only because names were unique: no two ranked rows could be equal, so a row's
-- position on the board and its rank from `countPlayersAbove` agreed by
-- construction. Allow duplicate names and two `ada`s on the same score are tied,
-- the leaderboard's positional rank and `/api/me`'s counted rank disagree, and
-- the order between them is left to SQLite. Adding `id` — the AUTOINCREMENT
-- primary key, unique and stable — restores a total order. It also gives the
-- tiebreak a defensible meaning: the earlier account sorts first. ADR 0024, and
-- the note on `Repo.countPlayersAbove`.

DROP INDEX players_name_key;

DROP INDEX players_board;
CREATE INDEX players_board ON players(best_score DESC, name, id)
  WHERE name_key IS NOT NULL AND best_score > 0;
