# 0023 — Retention is a daily cron sweep, and it does not release names

Date: 2026-08-02 · Status: accepted

## Context

ADR 0022 moved this project from Pages to a Worker with static assets for one
reason, stated in its own § Consequences: **cron triggers are available, and that
is the next commit.** This is that commit.

Four things accumulate and nothing removes them. Each has an owner already
written down, and each was verified against the schema before being implemented:

| Rows | Owner | State before this ADR |
|---|---|---|
| `games` stuck in `active` past the 30-minute submit TTL | ADR 0015 § Consequences, ADR 0016 § What this does not decide | `games_sweep` indexes them; nothing reads it, so `expired` is an unreachable status |
| `mint_buckets` for days that are over | ADR 0015 § 3 | `bumpMintBucket` only ever touches today's day; nothing deletes yesterday's |
| `client_errors` past 30 days | ADR 0014, `migrations/0002` | Purged **on write** — real, and incomplete |
| `players` with `games_played = 0` after 7 days | ADR 0011 § Consequences | Nothing does it |

Two of those descriptions in the existing docs were wrong, and the code is what
settles it:

- **`BACKLOG.md` said the sweep "is still probabilistic-on-write".** It never
  was. ADR 0022 described a probabilistic pass as the thing being replaced, but
  `grep` finds no `Math.random` in `server/**` and no purge on any write path
  except the client-error one. It was proposed during scaffolding and never
  written. Nothing is being replaced here; this is the first implementation.
- **`OPERATIONS.md` said `client_errors` retention is "enforced by the write".**
  Half true. `Repo.recordClientError` really does
  `DELETE FROM client_errors WHERE day < ?` on every insert, so while reports are
  arriving the promise holds. It cannot hold once they stop — and "no browser has
  thrown for a month" is the *healthy* state, in which the last 30 days of rows
  sit there indefinitely. A write-triggered purge bounds new rows, not old ones.

## Decision

**A daily Cron Trigger, `17 4 * * *` UTC, running four bounded passes through the
`Repo` port.** `server/sweep.ts` holds the passes; `server/index.ts` gains a
five-line `scheduled` export beside `fetch`.

1. **Daily, not hourly.** Three of the four windows are measured in days — 30 for
   `client_errors`, 7 for orphaned players, 1 for `mint_buckets` — so a more
   frequent run could not delete anything sooner. The fourth, stale `active`
   games, has a 30-minute TTL, but the row is inert: the submit path already
   answers 410 from `started_at`, so the only cost of leaving one a few hours is
   the row. `04:17` rather than `04:00` because cron schedules cluster on the
   hour and Cloudflare runs triggers best-effort; the odd minute avoids the
   queue.

2. **Every statement goes through `Repo`**, like everything else, so the passes
   are testable against `memoryRepo()` with no Worker and no D1. The double
   reproduces the `LIMIT` and the `ORDER BY`, not just the predicate — a double
   that swept everything in one go would make the bounding test pass against a
   lie.

3. **Every `DELETE` is bounded by a `LIMIT` and reports its row count.** These
   tables have grown unattended since the schema was written; an unbounded
   `DELETE` on the first run after a backlog is how a scheduled job takes out a
   database. Oldest rows go first, so a capped pass makes progress rather than
   churning one window, and a pass that hits its ceiling says so in the log.
   `UPDATE … LIMIT` needs `SQLITE_ENABLE_UPDATE_DELETE_LIMIT` at compile time, so
   the bound is a subquery; `mint_buckets` and `client_errors` are `WITHOUT
   ROWID` and have no `rowid`, so theirs is SQLite's row-value form on the
   primary key — measured against a real local D1, not assumed.

4. **One wide structured event per run**, through the same `deps.emit` port as
   the request log, at `event: "retention_swept"`. **This is the only evidence
   the job ran at all**, so a run that deleted nothing still emits one: a cron
   that has silently stopped firing and a cron with nothing to do are otherwise
   identical. There is no request, so there is no `player.key`, no `url.path` and
   no header allow-list.

5. **A failing pass does not abort the others and does not throw out of
   `scheduled`.** Each pass is wrapped, reported in `sweep.failed`, and the run
   continues. One broken statement must not take the other three with it, and a
   throw out of the handler is a platform retry of work already done.

6. **The 12-month name release is deliberately not implemented.** See below.

## Why the name release is not here

ADR 0011 asks for two sweeps of `players`. The `games_played = 0` half is
implemented: such a row is one whose request died between `insertPlayer` and
`recordFinishedGame`, its owner cannot hold a name (`handlers/name.ts` refuses
under one game played) and cannot be on the board (`players_board` requires
`best_score > 0`), so nothing is lost — their next submission mints a fresh
identity, exactly as a cleared cookie already does.

**Releasing names idle over 12 months is not implemented, and this is the
decision rather than an omission.** Deleting a real player's name is not
recoverable, and three things are wrong with doing it now:

- **`last_seen_at` is not proven to move.** It is advanced by exactly three
  writes: `insertPlayer`, `recordFinishedGame`, and `touchPlayer` from
  `GET /api/me`. For a player who visits and does not play, only the third
  applies — and `BACKLOG.md` § 4.2 records that `touchPlayer` runs inside
  `waitUntil` and has never been verified against a real D1, because a SQL error
  there is swallowed by the runtime and every test stays green. If it silently
  fails in production, every `last_seen_at` is frozen at `created_at`, and a
  12-month release would release **every name in the database** on its first run.
  `claimName` does not touch the column either.
- **The semantics are undecided.** A release is not a delete: it would `NULL`
  `name` and `name_key`, which silently drops the row out of the partial
  `players_board` index while leaving `best_score`, the games, and a working
  cookie behind. The player returns to find themselves nameless and off the
  board with no notice and `name_changes` already incremented. ADR 0011 says
  nothing about which of those it wants.
- **Nothing can be 12 months idle before 2027-08-01.** The site went live
  2026-08-01. There is nothing to buy by guessing now.

**The precondition for implementing it** is the one `BACKLOG.md` already names:
prove `touchPlayer` writes, with a second request that reads `last_seen_at` back
against a real binding. Then decide the release semantics in a new ADR. Until
both, `players` keeps every named identity forever, which is the failure that can
be undone.

## Consequences

- **`expired` is a reachable status for the first time.** `games_sweep` now has a
  reader. Nothing in the request path changed — a stale submission is still 410
  from `started_at`, not from the status — so this is about the table, not the
  rule.
- **`mint_buckets` stops being a growing per-IP-derived table.** ADR 0015
  justifies holding those rows at all partly on their being short-lived, and
  until now they were not. This is the pass with a privacy dimension rather than
  a disk one, and `server/sweep.ts` says so where the code is.
- **`client_errors` retention is now enforced twice**, on write and on the
  schedule. The write-side purge is kept: it is free, off the response path, and
  it is what keeps the promise true between sweeps.
- **A capped pass is visible and self-healing.** `sweep.capped` names any pass
  that hit `SWEEP_BATCH_LIMIT`; the next run continues. If a pass is capped on
  consecutive days the limit is too low, and it is one constant.
- **The trigger is guarded.** `tests/wrangler-config.node.test.ts` fails the build
  if `[triggers]` disappears, for the same reason it guards `[observability]`:
  removing it breaks nothing visible, and the resulting silence is
  indistinguishable from success.
- **`CLIENT_ERROR_RETENTION_DAYS` moved to `server/limits.ts`** so the write-side
  purge and the sweep cannot drift apart. A duplicated retention window with a
  comment between them is the failure `docs/history/README.md` § Documentation
  traps already records.
- **A sweep run costs one Worker invocation and up to four D1 statements a day.**
  Negligible against the free plan, and it is billed to nobody's request — which
  was the second objection to the probabilistic-on-write design.
- **Cost: the sweep has no unit coverage of its SQL**, like everything else in
  `server/db/d1.ts`. It was executed against a real local D1 through
  `wrangler dev --test-scheduled` and the four passes were verified by reading
  the rows back (history/0012), but `npm run e2e:backend` does not call
  `/__scheduled`, so a future schema change could break a statement and every
  test would stay green. Closing it means a spec that hits `/__scheduled` in the
  backend Playwright config.
