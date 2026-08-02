#!/usr/bin/env node
/**
 * The restore drill: load a backup into a scratch D1 and prove it is the state
 * we had.
 *
 * > "you only know that you can recover your recent state if you actually do so"
 * > — Site Reliability Engineering, ch. 26
 *
 * A backup nobody has restored is a file, not a backup. The same chapter is
 * blunt about why a calendar reminder does not fix that: a manual drill "becomes
 * an unwelcome bit of drudgery that isn't performed either deeply or frequently
 * enough to deserve your confidence". For a single maintainer, a quarterly
 * manual drill will not happen. So this is automated and it runs in CI — the
 * backup equivalent of `tests/purity.node.test.ts`.
 *
 * ## What it proves
 *
 * 1. The dump loads into an empty database with no errors. Format, ordering and
 *    every constraint have to hold.
 * 2. Every table the app depends on is there afterwards.
 * 3. Row counts match the manifest taken from the live database at export time.
 * 4. The leaderboard — the one table a player would notice being wrong — hashes
 *    to the same value it did on the live database.
 *
 * (3) and (4) are what make this a *restore* test rather than a syntax check. A
 * truncated download, a partial export and a dump taken mid-write all load
 * cleanly and all fail here.
 *
 * ## Two ways it runs
 *
 * - **`.github/workflows/backup.yml`**, weekly, against the export just taken
 *   from production, with the manifest queried seconds earlier. That is the
 *   drill.
 * - **`.github/workflows/ci.yml`**, every push, against
 *   `scripts/backup.fixture.sql` and its committed manifest, with no Cloudflare
 *   credentials. That run proves nothing about production data — it proves this
 *   script still works, so the weekly drill is not what discovers it rotted.
 *
 * Usage:
 *   node scripts/restore-drill.mjs --dump <file.sql> [--manifest <file.json>]
 *
 * With no `--manifest` it prints one to stdout, which is how the fixture's was
 * made. With one, a mismatch exits non-zero naming the check that failed.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { d1, describeDatabase, fail, REQUIRED_TABLES, tableNames } from "./backup-shape.mjs";

function died(message) {
  fail(`restore drill FAILED: ${message}`);
}

function readArgs(argv) {
  const args = { dump: null, manifest: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dump") args.dump = argv[i + 1] ?? null;
    if (argv[i] === "--manifest") args.manifest = argv[i + 1] ?? null;
  }
  if (args.dump === null) died("no --dump given");
  return args;
}

/** Load the dump into an empty scratch database and describe what came back. */
function inspectRestored(dumpPath) {
  const persistTo = mkdtempSync(join(tmpdir(), "colors-restore-"));
  const target = { persistTo };
  try {
    d1(target, { file: dumpPath });

    const present = tableNames(target);
    const missing = REQUIRED_TABLES.filter((table) => !present.includes(table));
    if (missing.length > 0) died(`the dump restored without: ${missing.join(", ")}`);

    return describeDatabase(target);
  } finally {
    // A scratch database left behind would be the next run's starting state,
    // and "the restore worked" would then mean "something was already there".
    rmSync(persistTo, { recursive: true, force: true });
  }
}

function compare(actual, expected) {
  const problems = [];
  for (const table of REQUIRED_TABLES) {
    const want = expected.counts?.[table];
    if (want === undefined) {
      problems.push(`manifest has no count for ${table}`);
    } else if (want !== actual.counts[table]) {
      problems.push(`${table}: restored ${actual.counts[table]} rows, manifest says ${want}`);
    }
  }
  if (expected.leaderboard?.rows !== actual.leaderboard.rows) {
    problems.push(
      `leaderboard: restored ${actual.leaderboard.rows} rows, manifest says ${expected.leaderboard?.rows}`,
    );
  }
  if (expected.leaderboard?.checksum !== actual.leaderboard.checksum) {
    // The one that catches a dump which loaded cleanly and is still wrong.
    problems.push(
      `leaderboard checksum: restored ${actual.leaderboard.checksum}, manifest says ${expected.leaderboard?.checksum}`,
    );
  }
  return problems;
}

function main() {
  const args = readArgs(process.argv.slice(2));
  const actual = inspectRestored(args.dump);

  if (args.manifest === null) {
    process.stdout.write(`${JSON.stringify(actual, null, 2)}\n`);
    return;
  }

  const problems = compare(actual, JSON.parse(readFileSync(args.manifest, "utf8")));
  if (problems.length > 0) died(`\n  - ${problems.join("\n  - ")}`);

  const total = Object.values(actual.counts).reduce((sum, n) => sum + n, 0);
  process.stdout.write(
    `restore drill OK: ${total} rows across ${REQUIRED_TABLES.length} tables, ` +
      `leaderboard ${actual.leaderboard.rows} rows @ ${actual.leaderboard.checksum.slice(0, 12)}\n`,
  );
}

main();
