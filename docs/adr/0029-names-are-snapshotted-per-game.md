# 0029 — The display name is snapshotted onto each game; the board reads the game, not the identity

Date: 2026-08-03 · Status: accepted — **revises 0024, 0025, 0026; extends 0016**; the board grouping is revised by [0033](0033-leaderboard-best-per-name-or-all-games.md)

## Context

The board's name came from the identity row. `topPlayers` joined `players.name`
onto `players.best_game_id`, and `rankOf` counted against `players.name` too, so a
row's name was always whatever the player is called *right now* — not what they
were called when they earned the score.

Two things fall out of that, and both are wrong:

- **A rename rewrites history.** `POST /api/name` (`setName`) overwrites
  `players.name`, and because the board read that column live, changing your name
  silently relabelled every score you had ever posted. ADR 0025 stated this as a
  feature — "a rename keeps the identity, the cookie, the scores and the board row
  — only the displayed name changes." But the name a score was *played under* is
  part of what the board records; mutating it after the fact is not "only the
  displayed name."
- **A shared device collapses two people into one row.** One cookie is one
  identity (ADR 0011), and a shared laptop is the common case for a casual game.
  Two people who each set their own name and each posted a good game should be two
  rows. Instead the second `setName` overwrote the first, and the board — reading
  the single live `players.name` — drew both games under the later name, keeping
  only the higher score. A real board entry disappeared at a rename.

The fix is to stop treating the name as a property of the mutable identity and
start treating it as a property of the game it labelled. The **expand** half is
already merged (migration `0006_game_name_snapshot`, PR #10): `games.name` /
`games.name_key` were added and are stamped at submit from the player's name at
that moment, and existing rows were backfilled. This ADR is the **reader flip** —
the board and the rank stop reading `players.name` and start reading the game's
snapshot.

## Decision

**A name is chosen per game and applied to the game you just played. A board
entry is the best game, labelled by that game's own name; your history is
immutable except for the most-recent game.**

1. **The board is drawn from `games`, not `players`.** An entry is the best
   `finished`, unflagged, `open` game with `total_score > 0` per
   `(player_id, name_key)`, labelled by that game's own `games.name`
   (`BOARD_ENTRIES` in `server/db/d1.ts`, mirrored by `boardEntries` in
   `server/db/memory.ts`). The outer order is
   `(total_score DESC, name ASC, player_id ASC)`. `topPlayers`,
   `topPlayersBySeed` and `countPlayersAbove` all read `games` now. The per-seed
   board keeps both `open` and `challenge` games (ADR 0026); the global board
   keeps only `open`, so a chosen seed still cannot reach it (ADR 0015) — the
   filter is now `kind = 'open'` in the entries query rather than
   `players.best_score` never being raised.

2. **A rank is counted against the name of the player's best game.** `rankOf`
   (`server/identity.ts`) ranks against `bestGameName` — the `name` on the game
   that is the player's board entry — not `players.name`. So the rank a submission
   returns still equals the row's position on the board (see the total-order
   argument below). Callers in `server/handlers/me.ts` and `submit.ts` are updated.

3. **A game is born with a name at submit.** `recordFinishedGame` snapshots
   `submitted.name ?? players.name` onto the row when the game is finalised (the
   expand half, migration `0006`). So the game a returning player just played
   inherits their last-used name without retyping, and a first-time player's game
   carries the name they set with the submission. The name is `NULL` only when
   neither exists yet.

4. **Setting a name stamps the game you just played, plus the prefill — never the
   older games.** `POST /api/name` → `setName` (and the name-with-submission path)
   does two writes: it updates `players.name` / `name_key` — the pre-fill default
   for the next "Change name" form (ADR 0025) and the name the *next* game will
   inherit — and it stamps that name onto the player's **most-recent finished
   game** (`ORDER BY finished_at DESC, id DESC`, matched between `d1.ts` and the
   memory double). Older games are left exactly as they were played. A rename
   therefore relabels *at most the one most-recent game*, plus the games you play
   afterwards; the older entries the board already shows do not move.

5. **Nothing else moves.** `POST /api/name` is kept — there is no `PUT /api/me/name`
   and no 410. The client is unchanged, and every response shape is unchanged. The
   drill's board query (`scripts/backup-shape.mjs`) and its fixture were updated to
   match the new entry shape.

### The name is a second stored input — and ADR 0016 still holds

ADR 0016 says "the guesses are the sole irreducible input": there is no `rounds`
table because every target, ΔE and round score re-derives from
`(seed, roundIndex, difficulty, guesses)`. The name snapshot is a genuine
exception to that sentence — it is a second stored, **non-derived** value on the
game, because a name cannot be recomputed from a seed. But it is inert to
everything ADR 0016 was protecting: **the name never enters `scoreGuess` or
`generateTarget`**, `server/replay.ts` never reads it, and no score depends on it.
The four-engine replay gate is unaffected. `games.name` is a *label* the board
carries, not an input a score is derived from — so ADR 0016's determinism, and
every historical score's reproducibility, are untouched.

### The total order, re-derived over game entries

ADR 0024 made the board a total order with `(best_score DESC, name ASC, id ASC)`
over `players`, so that a row's position and its counted rank agree by
construction. The same argument survives the move to `games`, re-derived as
`(total_score DESC, name ASC, player_id ASC)` over **entries**:

- An entry is keyed by `(player_id, name_key)`, so two distinct entries never
  share both `player_id` and `name` — equal names fold to the same `name_key`,
  which is the same partition, which is the same entry.
- Therefore no two entries tie on all three of `(total_score, name, player_id)`,
  the order is total, and `countPlayersAbove` (a strict "above" over the same
  three keys) hands out a rank that matches the board index — exactly ADR 0024's
  property, now over games. The player's own best game *is* their entry, so
  `rankOf(bestScore, bestGameName, playerId)` lands on their own row.

## Consequences

- **A rename relabels at most the game you just played, never the older entries.**
  Setting a name stamps the most-recent finished game and the prefill, so the new
  name lands on that game and on the games you play next; the older entries the
  board already shows are immutable. This is the deliberate reversal of ADR 0025's
  "a rename keeps … the board row": the board position (the score) is still yours,
  but the *label* on a past entry is frozen at play time and a rename cannot move
  it. A player who wants an old score shown under a different name cannot get that,
  by design — that name is what the game was played under.
- **A shared device shows one entry per name.** Two people on one cookie who each
  play and then name themselves each land that name on the game they just played:
  A plays and sets `Alice` (A's game → `Alice`), B plays on the same phone and
  sets `Bob` (B's game → `Bob`), and the board shows both, one per `name_key`, no
  longer collapsed to whichever name was set last. This is the bug fixed.
- **`players.best_score` and `players_board` are now vestigial for the board.**
  `submit` still maintains `best_score`, but nothing reads it for ranking. This is
  the middle of a staged rollout — **expand** (migration `0006`: add and populate
  `games.name`) → **this reader flip** (board and rank read `games`) → a later
  **contract** that drops the `players_board` index and `best_score`'s board role
  once nothing depends on them. The contract step is tracked in `docs/BACKLOG.md`.
- **Pre-snapshot games backfilled to the player's *current* name, and the true
  per-game name is unrecoverable.** Migration `0006` populated `games.name` on
  existing rows from `players.name` as it stood at migration time — the only name
  those rows had. A player who renamed *before* the expand migration will still
  see their older games under the later name: the name each historical game was
  actually played under was never stored, so it cannot be recovered. The
  one-entry-per-name guarantee is exact only for games played after the snapshot
  shipped.
- **How we would know this regressed: a counted rank that disagrees with the row
  next to it.** This is the same tripwire ADR 0024 named. If `rankOf` ever reads
  `players.name` again, or the board labels an entry with a different name than
  `countPlayersAbove` ranks against, a renamed player's submission returns a rank
  that points at the wrong row. The guard is a unit test asserting rank equals
  board index for a player who renamed *after* their best game — the case that
  distinguishes the snapshot from the live name. If that test is deleted, the
  disagreement comes back silently.

## Rejected

- **Retire `POST /api/name`, add `PUT /api/me/name`.** A cleaner REST shape, but
  the client would have to change and this is meant to be a reader flip with no
  client and no response-shape change. The old route lands a name on the identity
  exactly as before; only what the *board* reads changed.
- **Rewrite old games' names on rename to keep the "board comes with you"
  promise.** This is the behaviour being removed, and it cannot even be done
  correctly for pre-snapshot rows — the per-game name was never stored, so there
  is nothing to rewrite them *to* except the current name, which is the bug.
