#!/usr/bin/env node
/**
 * What production currently holds, as JSON on stdout.
 *
 * Run immediately *before* `wrangler d1 export` in
 * `.github/workflows/backup.yml`, so that `restore-drill.mjs` has something to
 * compare the restored copy against. Without it the drill can only prove that
 * the dump parses, which every truncated download also does.
 *
 * It reads nothing but counts and the public leaderboard — no tokens, no game
 * rows, no error text — so the manifest is safe to keep beside the dump and to
 * print in a CI log. The dump itself is not, which is why it goes to a private
 * artifact and this does not.
 *
 * Needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. It is the one script
 * here that cannot run locally without credentials.
 *
 * Usage:
 *   node scripts/live-manifest.mjs > backup-2026-08-02.manifest.json
 */

import { describeDatabase } from "./backup-shape.mjs";

process.stdout.write(`${JSON.stringify(describeDatabase({ remote: true }), null, 2)}\n`);
