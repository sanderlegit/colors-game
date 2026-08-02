# 0018 — Backups are a weekly off-platform export, drilled in CI

Date: 2026-08-02 · Status: accepted

## Context

D1 has Time Travel: point-in-time recovery with nothing to configure, which is
the right first answer to "I broke a table ten minutes ago". It is not a backup,
for three reasons that all bite in the same incident:

- Retention on the free plan is **7 days**. Anything noticed in week two is gone.
- A restore **overwrites in place**. There is no "bring it back beside the live
  one and compare", which is what you want precisely when you are not yet sure
  what went wrong.
- It lives in the account it protects. A mis-scoped API token, a deleted
  database or a billing lapse takes the data and its recovery mechanism together.

The data itself is small and, mostly, cheap to lose: seeds, guesses and counters.
One column is not. `players.best_score` and the names beside it are the only
thing a player would notice being wrong, and there is no second copy anywhere —
the identity is a cookie, so a player cannot re-prove a score we lost.

The harder problem is the one every backup story fails at. Google's SRE book is
blunt about it: *"you only know that you can recover your recent state if you
actually do so"*, and a manual drill *"becomes an unwelcome bit of drudgery that
isn't performed either deeply or frequently enough to deserve your confidence"*.
This repo has one maintainer. A quarterly calendar reminder will not happen.

## Decision

**A weekly `wrangler d1 export` to a GitHub artifact, and a restore drill that
runs in CI on every push.**

1. `.github/workflows/backup.yml`, weekly. Before the export it writes a
   *manifest* — row counts per table plus a SHA-256 over the ordered leaderboard
   — queried from the live database seconds earlier. Then it exports, then it
   restores the export into a scratch local D1 and asserts the restored copy
   matches the manifest. The dump and the manifest are kept for 90 days, which is
   ~13 restore points against Time Travel's 7 days.
2. **The manifest is what makes it a restore test rather than a syntax check.** A
   truncated download, a partial export and a dump taken mid-write all load
   cleanly. Only a comparison against what production held catches them.
3. `scripts/restore-drill.mjs` also runs in `ci.yml` on **every push**, against a
   committed fixture dump and its committed manifest, with no Cloudflare
   credentials — `wrangler d1 execute --local` is miniflare's SQLite. That run
   proves nothing about production data. It proves the drill still works, so the
   weekly run is not what discovers the script rotted. This is the same argument
   as `tests/purity.node.test.ts`: the check worth having is the one that runs
   every time.

Two supporting decisions come with it:

- **`/api/health` stays shallow and must not query D1.** A liveness probe that
  touches the database makes one D1 blip look like every edge location failing at
  once, and whatever is watching then takes out a Worker that is running
  perfectly well. The dependency check lives at `/api/health/deep`, which is
  hand-called, and the two have different remedies.
- **Migrations are applied by an explicit, gated CI step, never by the deploy.**
  `wrangler pages deploy` does not touch the database. Because the step runs
  before the deploy — and because a rolled-back Worker meets a migrated database
  — every migration must be expand-only, or split expand → migrate → contract
  across two deploys.

## Consequences

- **The recovery point objective is one week, not seven days of Time Travel.**
  Losing up to a week of scores is the accepted cost of a job that runs weekly.
  Time Travel remains the tool for anything recent; this is the tool for anything
  older, and for anything that takes the account with it.
- **The drill fails loudly on three distinct faults**, all verified against the
  fixture: a dump that will not load, a dump missing rows, and a dump that loads
  with different data. Nothing about it is a smoke test.
- **The export contains `players.token_hash`**, so a leaked artifact is a list of
  hashed session credentials. Hashes, not tokens (ADR 0016), so it is not a pile
  of working logins — but the artifact is private and must stay so, and the
  manifest is deliberately separate precisely so the *safe* half can be read in a
  CI log.
- **The whole thing needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.**
  Until those secrets exist the weekly job fails; the per-push drill does not,
  which is the right split.
- Restoring for real is still a manual decision and a manual command. This
  automates knowing you *can*, not deciding you *should* — see
  `../OPERATIONS.md` for the runbook.
- The fixture and its manifest have to be regenerated when the schema changes.
  The command is in the header of `scripts/backup.fixture.sql`, and the CI job
  that applies migrations to an empty local database will fail first if it is
  forgotten.
