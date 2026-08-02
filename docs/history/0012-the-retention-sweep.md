# 0012 — the retention sweep

2026-08-02. The commit ADR 0022 promised: the data-retention sweep as a real Cron
Trigger. ADR 0023 is the decision; this is what happened doing it.

## The thing being replaced did not exist

ADR 0022 § Context says "the sweep exists today as a **probabilistic pass on
write**", and `BACKLOG.md` repeated it as a live gap. **It was never written.**
`grep` finds no `Math.random` anywhere in `server/**`, and the only purge on any
write path is `Repo.recordClientError`'s day-based delete. It was proposed during
scaffolding, described in an ADR as though it had shipped, and then carried
forward twice as fact.

That is history/0009's failure mode arriving from a new direction: not a
*rejected* idea that had since been adopted, but a *proposed* idea that never
was. ADR 0022 and history/0011 are immutable and stay as written; ADR 0023 § Context
states the correction and `BACKLOG.md`'s row is struck through with the reason.
The general lesson: **an ADR describing the current state of code it is not
changing is an unverified claim**, and it will be trusted exactly as hard as the
decision it sits next to.

## What the code said that the docs did not

Three checks against the schema, two of which changed the design:

- **`client_errors` retention really is "enforced by the write"** —
  `recordClientError` does `DELETE FROM client_errors WHERE day < ?` on every
  insert — **and that is only half of it.** It bounds new rows. It cannot bound
  old ones, because it only runs when a report arrives, and "no browser has
  thrown for a month" is the *healthy* state. `OPERATIONS.md` said the promise was
  kept; it was kept only while the site was misbehaving.
- **`mint_buckets.day` is an integer day number** (`floor(ms / 86 400 000)`) while
  **`client_errors.day` is TEXT `YYYY-MM-DD`**. Two columns called `day`, two
  types, two helpers (`dayNumber` and `dayKey`). The sweep needs both and they
  are not interchangeable.
- **`games_played = 0` cannot coexist with a name.** `handlers/name.ts` refuses a
  claim under one game played, and `players_board` requires `best_score > 0`, so
  the ADR 0011 orphan pass provably deletes nobody who owns anything. That is the
  check that made the pass safe to write; the other half of ADR 0011 got the
  opposite answer.

## The name release: not built, and that is the finding

ADR 0011 asks for names idle over 12 months to be released. It is not built, and
the reason is in the code rather than in a preference. `last_seen_at` is advanced
by three writes, and for a player who visits without playing only one applies:
`touchPlayer`, from `GET /api/me`. `BACKLOG.md` § 4.2 already records that
`touchPlayer` runs inside `waitUntil` and **has never been proven to write against
a real D1** — a SQL error there is swallowed by the runtime and the spec stays
green.

Compose the two and the failure is total rather than partial: if `touchPlayer` is
silently broken, every `last_seen_at` in the table is frozen at `created_at`, and
the first run of a 12-month release releases *every name in the database*. It is
not recoverable and nothing would have caught it — the sweep's own tests would be
green, because the double writes `last_seen_at` correctly.

**Generalisable:** a sweep is only as safe as the freshness of the column it
sweeps on, and a column written exclusively inside `waitUntil` has no proven
freshness at all. Before building anything that deletes on a timestamp, check
what writes that timestamp and whether anything has ever observed it change.

## Environment

- **`wrangler dev` fires no schedule on the clock, ever.** Two ways to invoke the
  handler, both printed on start-up once `[triggers]` exists:
  `--test-scheduled` adds `/__scheduled?cron=…` (answers `Ran scheduled event`),
  and `/cdn-cgi/local/scheduled` works with **no flag at all** (answers `ok`).
  The second passes no cron expression, so `controller.cron` is the empty string
  and the log line reads `"sweep.cron":""` — that is "invoked by hand", not a
  bug. There is no equivalent against a *deployed* Worker: nothing triggers a
  production cron on demand, so the only confirmation is the log line.
- **`UPDATE … LIMIT` is not portable.** SQLite needs
  `SQLITE_ENABLE_UPDATE_DELETE_LIMIT` at compile time and there is no way to ask
  D1 whether it has it. `WHERE id IN (SELECT … LIMIT ?)` is bounded everywhere.
- **A `WITHOUT ROWID` table has no `rowid` to bound a `DELETE` by.**
  `mint_buckets` and `client_errors` are both `WITHOUT ROWID`, so the bound is
  SQLite's row-value form on the primary key:
  `DELETE FROM t WHERE (a, b) IN (SELECT a, b FROM t WHERE … LIMIT ?)`. Verified
  against the real local D1 before it was written into the adapter, not assumed.
- **A `LIMIT` in two statements that must select the same rows needs an
  `ORDER BY`.** The orphan pass deletes games and then players; without a
  deterministic order the two subqueries may pick different sets and orphan the
  games of a player who is still there. `d1.ts` interpolates one shared subquery
  constant into both so they cannot even textually diverge.
- **`Object.fromEntries` is banned in `server/**`** by
  `tests/logging.node.test.ts` — the only reason to reach for it in a backend is
  to turn a `Headers` object into data. Building a `Record` from a table of passes
  is a legitimate use and still fails the build; write the loop. The guard is
  right to be blunt.

## Measured

Seeded a local D1 with rows on both sides of every boundary and ran the trigger:

```
{"event":"retention_swept","sweep.rows":7,"sweep.games_expired":3,
 "sweep.mint_buckets_deleted":2,"sweep.client_errors_deleted":1,
 "sweep.orphan_players_deleted":1,"duration_ms":9}
```

Reading the tables back: the fresh `active` game survived, today's mint bucket
survived with its count intact (a swept counter is a lifted rate limit), the
recent client error survived, the one-day-old orphan survived, and the named
player with four games played and 400 days of idleness survived — which is the
row the unbuilt name release would have taken. A second run reported zero rows
and still emitted a line, which is the property the whole logging design here
turns on: **a stopped cron and an idle cron are indistinguishable except by that
line existing.**
