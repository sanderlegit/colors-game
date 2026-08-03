/**
 * What a backup of this database is supposed to look like, in one place.
 *
 * `live-manifest.mjs` runs these queries against production and
 * `restore-drill.mjs` runs them against a scratch database loaded from the
 * export. The comparison between the two is the whole drill, and it is only
 * meaningful if both sides compute the same thing — so both sides import it from
 * here rather than each spelling it out.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

/** Must match `wrangler.toml`'s `database_name`. */
export const DATABASE = "colors";

/**
 * Every table the app reads or writes. Named explicitly rather than discovered,
 * because one failure this catches is a table *missing* from the dump — and a
 * discovered list would simply not look for it.
 *
 * `d1_migrations` is included deliberately: a restore that loses it makes the
 * next `migrations apply` re-run 0001 against a populated database.
 */
export const REQUIRED_TABLES = [
  "d1_migrations",
  "players",
  "games",
  "mint_buckets",
  "round_stats",
  "game_stats",
  "client_errors",
];

/**
 * The board, drawn from `games` — the best open, unflagged, named game per
 * `(player, name)` (ADR 0029), the same entry set the Worker's `topPlayers`
 * serves. It reads the game's snapshotted name, not `players.name`, so the
 * drill verifies the surface a player actually sees.
 *
 * Hashed rather than compared row by row, so the manifest stays small — and
 * taken over the *ordered* rows, because the order is as much a part of a
 * leaderboard as the numbers on it.
 */
export const LEADERBOARD_QUERY = `SELECT name, best_score FROM (
     SELECT g.player_id AS player_id, g.name AS name, g.total_score AS best_score,
            ROW_NUMBER() OVER (
              PARTITION BY g.player_id, g.name_key ORDER BY g.total_score DESC, g.id ASC
            ) AS rn
       FROM games g
      WHERE g.status = 'finished' AND g.flags = 0 AND g.kind = 'open'
        AND g.name_key IS NOT NULL AND g.total_score > 0
   )
   WHERE rn = 1
   ORDER BY best_score DESC, name ASC, player_id ASC`;

export function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/**
 * One `wrangler d1 execute`.
 *
 * `local` with a `persistTo` directory is miniflare's SQLite: no credentials, no
 * network. That is what lets the drill run on every push.
 */
export function d1(target, options) {
  const flags = ["d1", "execute", DATABASE];
  if (target.remote === true) flags.push("--remote");
  else flags.push("--local", "--persist-to", target.persistTo);
  flags.push("--yes");
  if (options.file !== undefined) flags.push("--file", options.file);
  if (options.command !== undefined) flags.push("--command", options.command);
  if (options.json === true) flags.push("--json");

  let stdout;
  try {
    stdout = execFileSync("npx", ["wrangler", ...flags], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
    });
  } catch (error) {
    // wrangler has already printed the SQL error on stderr; a stack trace
    // through child_process on top of it helps nobody.
    fail(`wrangler failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (options.json !== true) return null;
  // `--json` prints the result array and nothing else, but a stray banner line
  // would otherwise make the JSON parse error the thing you have to debug.
  const start = stdout.indexOf("[");
  if (start < 0) fail(`wrangler printed no JSON for: ${options.command ?? options.file}`);
  return JSON.parse(stdout.slice(start));
}

export function rows(target, command) {
  const parsed = d1(target, { command, json: true });
  const first = Array.isArray(parsed) ? parsed[0] : null;
  if (first === null || first === undefined || !Array.isArray(first.results)) {
    fail(`no rows came back for: ${command}`);
  }
  return first.results;
}

/**
 * Counts for every required table, plus the leaderboard's shape and checksum.
 *
 * This is the manifest. Run against production it records what we had; run
 * against a restored copy it records what we got back.
 */
export function describeDatabase(target) {
  const counts = {};
  for (const table of REQUIRED_TABLES) {
    // Table names come from REQUIRED_TABLES, never from input.
    const [row] = rows(target, `SELECT COUNT(*) AS n FROM "${table}"`);
    counts[table] = Number(row.n);
  }

  const board = rows(target, LEADERBOARD_QUERY);
  const checksum = createHash("sha256")
    .update(JSON.stringify(board.map((row) => [row.name, Number(row.best_score)])))
    .digest("hex");

  return { counts, leaderboard: { rows: board.length, checksum } };
}

export function tableNames(target) {
  return rows(target, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map(
    (row) => row.name,
  );
}
