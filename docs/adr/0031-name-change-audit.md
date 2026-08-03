# 0031 — a durable, subject-bearing name-change audit

Status: accepted — **extends 0014 with a deliberately different kind of table**

## Context

A bug where two people shared one device and renamed the single identity back and
forth was invisible in the logs: a rename carried no distinct signal, the wide
event is built from the request and response only, and Workers Logs keep three
days regardless. The one durable fact — `players.name_changes` — is a running
integer with no per-change record and no before/after. Nothing could reconstruct
"this identity toggled between two names repeatedly", which is exactly the shape
of the incident.

ADR 0014 chose day-keyed **counters** (`round_stats`, `game_stats`) with no
subject precisely so there is nothing to subject-access or delete. That is the
right call for difficulty telemetry, and it is also why those tables can say
nothing about identity behaviour: a name has a subject.

## Decision

Add `name_changes_audit(player_id, at, old_name_key, new_name_key)`
(`migrations/0007`). `setName` writes one row whenever the folded key actually
moves — a first claim (`old` null) or a rename — and not on a no-op re-set of the
same name. It stores **folded keys, never display names**: enough to see that two
changes are the same or different names, not enough to read the names back.

This is knowingly a *different kind of table* from ADR 0014's counters: it names a
`player_id`, so it carries a subject-access and delete obligation. Two mechanisms
discharge it, both enforced in code and tested:

- **Deleted with the player.** `Repo.deletePlayer` removes the audit rows in the
  same batch as the games and the row itself — explicitly, not on an
  `ON DELETE CASCADE` that only fires when foreign keys are enforced.
- **Bounded by the sweep.** A fifth retention pass (`server/sweep.ts`, ADR 0023)
  deletes rows older than `NAME_CHANGE_AUDIT_MAX_AGE_MS` (90 days), oldest first,
  capped at `SWEEP_BATCH_LIMIT` — the same shape as every other pass, and
  reported as `sweep.name_changes_deleted`.

## Consequences

- The rename bug is now a query: rows for one `player_id` alternating between two
  `new_name_key`s. Ninety days outlives the 3-day log window it backstops, so a
  report that arrives late can still be investigated.
- One extra D1 write per name change. Renames are rare against the request cap, so
  this is negligible; the write is part of `setName`'s existing batch, so it is
  atomic with the change it records.
- **The subject obligation is real and must not regress.** If a future reader or
  export exposes this table, it exposes per-player history — folded keys, but a
  subject nonetheless. Keep it out of any public response (no handler reads it),
  keep display names out of it, and keep both the delete-cascade and the sweep
  pass. `server/db/memory.test.ts` and `server/sweep.test.ts` pin both.
- Retention on the log line remains 3 days (ADR 0014); this table is the durable
  record the log deliberately is not. Anything that must outlive 90 days would
  need its own decision — this ADR does not grant open-ended history.
