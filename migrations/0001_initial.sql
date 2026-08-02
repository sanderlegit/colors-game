-- Initial schema.
--
-- Apply with:
--   npx wrangler d1 migrations apply colors --local     (dev)
--   npx wrangler d1 migrations apply colors --remote    (production)
--
-- ## There is deliberately no `rounds` table
--
-- The server re-scores what the client played by replaying the same pure
-- functions: every target, every ΔE and every round score is a pure function of
-- (seed, roundIndex, difficulty, guesses). Per-round rows would therefore store
-- derived data, which can only ever disagree with the functions that derive it.
-- The guesses are the sole irreducible input, so they are the only thing stored.
--
-- ## Timestamps
--
-- INTEGER milliseconds since the epoch, everywhere. SQLite has no date type and
-- no float that is safe to order on; ms integers sort correctly and survive
-- JSON round-trips exactly.

CREATE TABLE players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Hex SHA-256 of the cookie token, never the token itself: a database dump
  -- must not be a pile of working session credentials.
  token_hash TEXT NOT NULL UNIQUE,
  -- `name` keeps the player's own casing for display; `name_key` is the folded
  -- form uniqueness is enforced on, so "Ada" and "ada" cannot both exist.
  name TEXT,
  name_key TEXT,
  name_changes INTEGER NOT NULL DEFAULT 0,
  name_changed_at INTEGER,
  best_score INTEGER NOT NULL DEFAULT 0,
  best_game_id TEXT,
  games_played INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

-- Partial, so the unnamed majority do not all collide on NULL.
CREATE UNIQUE INDEX players_name_key ON players(name_key) WHERE name_key IS NOT NULL;
-- Covers the leaderboard query and its rank counterpart in one order.
CREATE INDEX players_board ON players(best_score DESC, name)
  WHERE name_key IS NOT NULL AND best_score > 0;
-- For reaping identities nobody has used in a long time.
CREATE INDEX players_idle ON players(last_seen_at);

CREATE TABLE games (
  -- 43-char base64url. This id *is* the single-use submit token: it is minted
  -- unguessably and the finalising UPDATE is conditional on the row still being
  -- active, so possession plus first-arrival is the whole authorisation story.
  id TEXT PRIMARY KEY,
  -- NULL until submission: minting a game must not require an identity, so a
  -- first-time player is not made to accept a cookie before they have played.
  player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
  status TEXT NOT NULL,                   -- 'active' | 'finished' | 'expired'
  seed INTEGER NOT NULL,
  difficulty TEXT NOT NULL,
  memorize_ms INTEGER NOT NULL,
  -- Rounded 0..500. INTEGER rather than REAL so board ordering is provably
  -- immune to float drift; the unrounded score never leaves the request that
  -- computed it.
  total_score INTEGER NOT NULL DEFAULT 0,
  guesses_json TEXT,
  -- Bitfield for anti-abuse marks. Flagged games stay on the player's history
  -- and out of the board, which is why the board indexes require flags = 0.
  flags INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE INDEX games_player_started ON games(player_id, started_at DESC);
CREATE INDEX games_daily ON games(finished_at DESC) WHERE status = 'finished' AND flags = 0;
CREATE INDEX games_sweep ON games(started_at) WHERE status = 'active';

-- Mint-rate accounting. The bucket is SHA-256(ip || a daily-rotating salt), so
-- no IP is ever stored and yesterday's buckets cannot be re-derived from an
-- address even with the table in hand.
CREATE TABLE mint_buckets (
  bucket TEXT NOT NULL,
  day INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (bucket, day)
) WITHOUT ROWID;
