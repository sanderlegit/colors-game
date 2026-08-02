# 0016 — a leaderboard reset that armed the orphan sweep

2026-08-03. A log review of the deployed system, prompted by a report that
changing a name did strange things to the leaderboard. Two defects came out of
it; this entry records the one that was hotfixed here. The larger one — names
living on the mutable identity row — is a model change staged separately.

## The report, and why the logs could not answer it

Two people shared one phone, so one identity cookie. They played, renamed the
single account back and forth, and the board kept relabelling: only the last
name entered ever showed. The logs said nothing was wrong, and they were right —
every request was `200`. The bug is a data-model one (the board reads
`players.name` live, `d1.ts` `topPlayers`), not an error, so nothing red exists
to find. Worse, `player.key` is salted **per isolate** (OPERATIONS § 1), a rename
bundled with a submission logs as a plain `score_submitted`, and no event carries
a before/after name — the incident is unreconstructable from telemetry. The
observability gap is real and is written up in the plan, not fixed here.

## The landmine the review actually caught first

The score-retune reset (`migrations/0005`, ADR 0028) runs
`UPDATE players SET games_played = 0` for **every** player, and its comment
promises it keeps "identities and names". The daily orphan sweep
(`server/sweep.ts`, ADR 0011/0023) deletes `players WHERE games_played = 0` older
than 7 days — and its own justification is that such a row "holds no name and no
board position, so nothing is lost."

That premise was only ever true because a name cannot be claimed before a
finished game (`handlers/name.ts` gates on `gamesPlayed >= 1`). The reset broke
it: after it ran, every pre-reset **named** identity sits at zero games. The next
sweep past each account's 7-day mark would delete it — name and all — the exact
opposite of what the reset promised. Nobody wrote the interaction down: ADR 0028
never mentions the sweep, and ADR 0023 predates the reset and never revisits its
invariant. The site launched 2026-08-01, so the first named accounts crossed the
7-day line on ~2026-08-08 — a latent time-bomb, not yet fired when found.

## The fix

Restore the invariant the pass claims to have, by gating on it explicitly:

```
WHERE games_played = 0 AND name_key IS NULL AND created_at < ?1
```

in `ORPHAN_PLAYERS` (`d1.ts`) and the memory double (`memory.ts`). Code only, no
migration, so it ships ahead of the model change. A memory-double test locks it:
a named, zero-games, 400-day-old player survives a sweep. `name_key IS NULL` is
exactly the negation of the board's "has a name" predicate
(`name_key IS NOT NULL` in `topPlayers`/`countPlayersAbove`), so an orphan is now
provably a row with no name and no board position under either data model.

## The gotcha to carry forward

A bulk write to a column that a retention pass keys on can silently widen what
that pass deletes. A reset that zeroes `games_played` "weaponises" any sweep gated
on `games_played = 0`. Recorded in `history/README.md` § Documentation traps.
