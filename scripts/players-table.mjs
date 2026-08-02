#!/usr/bin/env node
/**
 * Turn `wrangler d1 execute --json` rows into fixed-width lines for `fzf`.
 *
 * The operator delete (`just delete-player`, ADR 0025) is the only way a player
 * comes off the board — there is no self-serve delete in the app. This is its
 * picker's formatter: it reads the wrangler JSON on stdin and prints one line
 * per player, `id` first so the recipe can pull it back out with `awk`, and the
 * name last because it is the only field that can contain spaces.
 *
 * Usage (see the `delete-player` recipe in the justfile):
 *   wrangler d1 execute colors --local --json --command '…' | node scripts/players-table.mjs
 */

import process from "node:process";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch {
    // No usable rows is not an error here: an empty database prints nothing and
    // fzf shows an empty list, which is the honest thing.
    process.exit(0);
  }
  // wrangler wraps results as `[{ results: [...] }]`; tolerate a bare object too.
  const rows = Array.isArray(parsed) ? (parsed[0]?.results ?? []) : (parsed?.results ?? []);
  for (const row of rows) {
    const id = String(row.id ?? "");
    const score = String(row.best_score ?? 0);
    const games = String(row.games_played ?? 0);
    const created = row.created_at
      ? new Date(Number(row.created_at)).toISOString().slice(0, 10)
      : "----------";
    const name = row.name ?? "(unnamed)";
    process.stdout.write(
      `${id.padEnd(6)} ${score.padStart(5)} ${games.padStart(5)}  ${created}  ${name}\n`,
    );
  }
});
