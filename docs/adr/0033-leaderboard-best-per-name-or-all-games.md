# 0033 — The leaderboard has a Best-per-name / All-games toggle; best-per-name groups by name across players

Date: 2026-08-03 · Status: accepted — **revises 0024, 0029, 0032**

## Context

Since ADR 0029 the board was one row per `(player, name)`: a player's single best
game under each name they had used. Two things about that turned out to be wrong
for what the game wants to show:

1. **A player's other games vanish.** You play a 321 and a 117 under the same
   name and the board shows only the 321 — the 117 is not deleted, but there is
   nowhere to see it. Players read that as data loss.
2. **The same name held by two people is two rows.** With `(player, name)`
   grouping, two different accounts both called `ada` are two `ada` rows. For a
   casual board keyed on a typed-in name, the intuitive thing is one `ada` row —
   the best `ada`, whoever played it.

## Decision

`GET /api/leaderboard?view=best|all` (default `best`), with a radio toggle on the
leaderboard tab.

- **`best` (default)** — one row per `name_key`, **across all players**: the
  single best finished, unflagged, `open`, in-score game played under that name.
  Two accounts that both played as `ada` collapse to one `ada` row. `isYou` is
  true on that row only when the caller owns the best `ada` game, so a weaker
  same-name player does not see themselves highlighted.
- **`all`** — every qualifying game is its own row; a player appears once per
  game, so both the 321 and the 117 show.

Both order `total_score DESC, name ASC, game_id ASC` and share the filters
`finished, unflagged, open, named, score > 0`. The same `view` applies to the
per-seed board (ADR 0026), which additionally keeps `challenge` games.

**Rank always tracks the default `best` board**, whatever view is shown: a name's
rank is its best game's position on the best-per-name board (`bestGameForName` +
`countPlayersAbove`). "Your rank" is therefore your *name's* rank — everyone
sharing a name shares one row and one rank. Submit ranks the name it was played
under; `/api/me` ranks `players.name` (null → null rank).

## Consequences

- **The `all` view can be flooded.** One strong player can fill much of the top
  50 with their own games — exactly what ADR 0024's grouping avoided. That is the
  deliberate price of "show every game"; `best` remains the default so the first
  thing a visitor sees is one row per name.
- **Best-per-name is cross-player name grouping — a change from 0029/0024.** A
  name is no longer tied to an account on the board; the board is about names, and
  a name's row is the best game anyone played under it. Squatting a name still
  costs a full game (ADR 0032's placeholder path is unchanged), and duplicate
  names remain allowed (ADR 0024) — they simply share a row in `best`.
- **`best_score` / `best_game_id` on `players` are still used** for `/api/me`'s
  displayed best and as the identity's own handle; only the board's grouping
  moved. `RankKey` is now `(bestScore, name, gameId)` — the unique `game_id` is
  the total-order tiebreak, replacing the player-id tiebreak 0024/0029 used.
- **How to detect a mistake later:** a counted rank that disagrees with a row's
  position on the `best` board is the invariant break to watch; it is asserted
  directly in `memory.test.ts`, including two players sharing a name.
