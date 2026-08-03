-- A synthetic backup, produced by `wrangler d1 export` from a seeded local D1.
--
-- It exists so `scripts/restore-drill.mjs` runs on every push with no Cloudflare
-- credentials: that run proves the drill still works, so the weekly drill in
-- `.github/workflows/backup.yml` is not the thing that discovers it rotted.
--
-- Every value here is invented. The `token_hash` columns are counting patterns,
-- not hashes of anything, and no row corresponds to a person. Games carry the
-- name they were played under (`games.name`, ADR 0029); `name_changes_audit`
-- carries folded name keys, never display names (ADR 0031). Regenerate with:
--
--   npx wrangler d1 migrations apply colors --local
--   npx wrangler d1 execute colors --local --file <seed rows>
--   npx wrangler d1 export colors --local --output scripts/backup.fixture.sql
--   node scripts/restore-drill.mjs --dump scripts/backup.fixture.sql \
--     > scripts/backup.fixture.manifest.json
--   # then re-add this header, which the export strips.

PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE IF NOT EXISTS "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(1,'0001_initial.sql','2026-08-03 14:33:29');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(2,'0002_telemetry.sql','2026-08-03 14:33:29');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(3,'0003_duplicate_names.sql','2026-08-03 14:33:30');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(4,'0004_challenge.sql','2026-08-03 14:33:30');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(5,'0005_reset_leaderboard.sql','2026-08-03 14:33:30');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(6,'0006_game_name_snapshot.sql','2026-08-03 14:33:30');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(7,'0007_name_change_audit.sql','2026-08-03 14:33:30');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(8,'0008_drop_players_board.sql','2026-08-03 14:33:30');
CREATE TABLE players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  
  token_hash TEXT NOT NULL UNIQUE,
  
  
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
INSERT INTO "players" ("id","token_hash","name","name_key","name_changes","name_changed_at","best_score","best_game_id","games_played","created_at","last_seen_at") VALUES(1,'0000000000000000000000000000000000000000000000000000000000000001','Ada','ada',1,1754000000000,412,'g1',7,1753900000000,1754100000000);
INSERT INTO "players" ("id","token_hash","name","name_key","name_changes","name_changed_at","best_score","best_game_id","games_played","created_at","last_seen_at") VALUES(2,'0000000000000000000000000000000000000000000000000000000000000002','Grace','grace',1,1754000100000,388,'g2',4,1753900100000,1754100100000);
INSERT INTO "players" ("id","token_hash","name","name_key","name_changes","name_changed_at","best_score","best_game_id","games_played","created_at","last_seen_at") VALUES(3,'0000000000000000000000000000000000000000000000000000000000000003',NULL,NULL,0,NULL,0,NULL,1,1753900200000,1754100200000);
CREATE TABLE games (
  
  
  
  id TEXT PRIMARY KEY,
  
  
  player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
  status TEXT NOT NULL,                   
  seed INTEGER NOT NULL,
  difficulty TEXT NOT NULL,
  memorize_ms INTEGER NOT NULL,
  
  
  
  total_score INTEGER NOT NULL DEFAULT 0,
  guesses_json TEXT,
  
  
  flags INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
, kind TEXT NOT NULL DEFAULT 'open', name TEXT, name_key TEXT);
INSERT INTO "games" ("id","player_id","status","seed","difficulty","memorize_ms","total_score","guesses_json","flags","started_at","finished_at","kind","name","name_key") VALUES('g1',1,'finished',41762,'normal',5000,412,'[]',0,1753990000000,1753990043000,'open','Ada','ada');
INSERT INTO "games" ("id","player_id","status","seed","difficulty","memorize_ms","total_score","guesses_json","flags","started_at","finished_at","kind","name","name_key") VALUES('g2',2,'finished',22114,'normal',8000,388,'[]',0,1753990100000,1753990160000,'open','Grace','grace');
CREATE TABLE mint_buckets (
  bucket TEXT NOT NULL,
  day INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (bucket, day)
) WITHOUT ROWID;
INSERT INTO "mint_buckets" ("bucket","day","count") VALUES('abc',20300,4);
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
INSERT INTO "round_stats" ("day","difficulty","memorize_ms","round_index","delta_e_bucket","hue_bucket","n") VALUES('2026-08-01','normal',5000,0,4,2,3);
INSERT INTO "round_stats" ("day","difficulty","memorize_ms","round_index","delta_e_bucket","hue_bucket","n") VALUES('2026-08-01','normal',5000,1,9,7,2);
CREATE TABLE game_stats (
  day TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  memorize_ms INTEGER NOT NULL,
  event TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (day, difficulty, memorize_ms, event)
) WITHOUT ROWID;
INSERT INTO "game_stats" ("day","difficulty","memorize_ms","event","n") VALUES('2026-08-01','normal',5000,'completed',5);
INSERT INTO "game_stats" ("day","difficulty","memorize_ms","event","n") VALUES('2026-08-01','normal',5000,'started',9);
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
INSERT INTO "client_errors" ("fingerprint","day","message","stack","n","first_seen_at","last_seen_at") VALUES('deadbeef','2026-08-01','TypeError: nope','at update',2,1754000000000,1754000500000);
CREATE TABLE name_changes_audit (
  player_id    INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  at           INTEGER NOT NULL,
  old_name_key TEXT,
  new_name_key TEXT NOT NULL
);
INSERT INTO "name_changes_audit" ("player_id","at","old_name_key","new_name_key") VALUES(1,1754000000000,NULL,'ada');
INSERT INTO "name_changes_audit" ("player_id","at","old_name_key","new_name_key") VALUES(2,1754000100000,NULL,'grace');
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('d1_migrations',8);
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('players',3);
CREATE INDEX players_idle ON players(last_seen_at);
CREATE INDEX games_player_started ON games(player_id, started_at DESC);
CREATE INDEX games_daily ON games(finished_at DESC) WHERE status = 'finished' AND flags = 0;
CREATE INDEX games_sweep ON games(started_at) WHERE status = 'active';
CREATE INDEX client_errors_day ON client_errors(day);
CREATE INDEX games_seed_board ON games(seed, total_score DESC)
  WHERE status = 'finished' AND flags = 0;
CREATE INDEX games_name_board ON games(total_score DESC)
  WHERE status = 'finished' AND flags = 0 AND kind = 'open' AND name_key IS NOT NULL;
CREATE INDEX name_changes_audit_player ON name_changes_audit(player_id);
CREATE INDEX name_changes_audit_at ON name_changes_audit(at);