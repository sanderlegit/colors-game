# 0024 — Display names are not unique; the board is ordered by (score, name, id)

Date: 2026-08-02 · Status: accepted

## Context

Names were unique. `migrations/0001` put a partial unique index on `name_key`
(the NFKC-folded, case-folded form), and `server/names.ts` turned a collision
into a suffix: the second `ada` became `ada-2`, then `ada-3` … `ada-8`, then one
random `ada-x7k2`, then a refusal. The summary screen spelled the substitution
out — "ada was taken, so you are ada-2."

Three things are wrong with that for this game:

- **It reads as the game overruling the player.** On a casual colour-matching
  leaderboard, two people both wanting to be `ada` is the normal shape of the
  thing, not contention to arbitrate. `ada-2` is a worse name than `ada`, handed
  out at the exact moment — the end of a game — when the player has the least
  patience for it.
- **The machinery is large for what it buys.** A bounded suffix ladder, a random
  fallback, code-point-aware length trimming so a suffixed 24-char name still
  fits a board row, and a whole "collision line" component on the client — all to
  avoid a duplicate that harms nothing. Uniqueness bought no real property here:
  there is no login, so a name is not a credential, and the row is already keyed
  by an unguessable cookie hash.
- **It was never a decision.** The unique index arrived with the initial schema
  and the suffixing fell out of it. No ADR argues for it.

But uniqueness was quietly **load-bearing for the leaderboard**, and that is the
part that makes this more than deleting an index. The board and every rank are
ordered `(best_score DESC, name ASC)`. That is a *total* order **only because
names are unique** — with no two ranked rows equal, a row's position on the board
and its rank from `countPlayersAbove` agree by construction, and the leaderboard
can hand out positional ranks (`index + 1`) that match what `/api/me` counts.
Allow duplicates and two `ada`s on the same score tie: `countPlayersAbove` (a
strict `name < ?`) counts neither above the other, so both get the same rank
number, while the board still draws them on two different rows. A rank that
disagrees with the row next to it is a bug report. `Repo.countPlayersAbove`
already carried the note naming the escape hatch.

## Decision

**Drop the uniqueness. Restore the total order with `id` as the final tiebreak.**

1. **`migrations/0003` drops `players_name_key`** and rebuilds `players_board` as
   `(best_score DESC, name, id)` with the same partial `WHERE`. Setting a name is
   now a plain `UPDATE` with no index to violate; `Repo.claimName` (which
   returned `{ ok: false, reason: "taken" }`) becomes `Repo.setName`, returning
   nothing. `server/names.ts` loses the whole suffix ladder and becomes a
   one-line `setPlayerName`.

2. **`id` is the final sort key everywhere the order is used** — the board index,
   `topPlayers`, `countPlayersAbove`, `byBoardOrder` in the double, and `rankOf`,
   which now takes the player's id. `id` is the AUTOINCREMENT primary key, so it
   is unique and the order is total again. It also gives the tiebreak a defensible
   meaning: **the earlier account sorts first**, which is the closest thing to the
   brief's "first to achieve" that the schema can express without a new column
   (see the standing note on `countPlayersAbove` — `best_finished_at` remains the
   change to make if strict achievement order is ever wanted).

3. **`name_key` stays.** It no longer arbitrates, but it is still the board's
   "has a name" predicate (`name_key IS NOT NULL`) and a single folded form to
   hang a future rename-limit or search on. Only the unique *index* goes.

4. **The client stops explaining a substitution that no longer happens.** The
   "collision line" and the `requested` field that fed it are deleted; a set now
   always lands the name the player typed (in the server's trimmed, own-cased
   form). The copy is reworded from "Claim" to "Set username" throughout.

## Consequences

- **Existing `ada-2` rows are untouched.** They are valid names, just no longer
  minted. No data migration.
- **Impersonation is now possible on the board**, and this is accepted. Two rows
  can read `ada`. `nameKey`'s NFKC + case folding still means `Ada` and `ada`
  share nothing a reader would miss, but it was never confusable detection —
  Cyrillic `а` was always a different key — and homoglyph folding remains a table
  we will not ship (it is its own ADR). The mitigation that matters is that a name
  is not a credential: it grants nothing. **Where to look if this turns out to
  matter:** repeated identical names clustered at the top of `game_stats` /
  the board, or reports of a specific handle being mimicked. The repair is a
  rename limit (the `name_changes` / `name_changed_at` columns already exist for
  it), not re-adding uniqueness.
- **The `id` tiebreak is invisible until two players tie on score *and* name.**
  That is rare, so the guard is a direct unit test in `server/db/memory.test.ts`
  ("breaks a same-name, same-score tie by id, agreeing with the board") rather
  than something a playtester would catch. If that test is ever deleted, the
  rank/board disagreement it prevents comes back silently.
- **`d1.ts`'s SQL still has no unit coverage.** The new `countPlayersAbove`
  predicate and the `ORDER BY … id` run for real only under `npm run e2e:backend`
  and against a real D1. The memory double reproduces the tiebreak so handler
  tests are honest, but a typo in the D1 statement would only surface in the
  backend spec — run it for this change.
- **`name_changes` still increments on every set**, including a player
  overwriting their own name with the same value. Nothing rate-limits renames
  yet; that remains the deliberately-deferred product decision `handlers/name.ts`
  already notes.
- **Superseded copy:** SPEC §7 and §7.1's "a taken name comes back suffixed"
  bullets, and `player-guide.md`'s "you get the next one along", are rewritten in
  this commit. ADR 0023 mentions `claimName` in passing (§ Why the name release
  is not here); it is immutable and left as the historical name for what is now
  `setName`.

## Rejected

- **Keep suffixing, just reword the message.** Reduces the sting but keeps every
  line of the ladder, the random fallback and the trimming, to preserve a
  uniqueness that buys nothing here.
- **Tiebreak on `finished_at` instead of `id`.** Closer to "first to achieve",
  but `players` stores no timestamp for the best game — only `best_game_id` — so
  it needs a new `best_finished_at` column and a join, and it still would not
  agree with the board index unless that column joined the index too. `id` is
  already unique, already indexed, and needs nothing new. The door is left open in
  `countPlayersAbove`'s note.
- **Leave the tie unbroken (drop only the index).** This is the trap: it looks
  like the whole task and ships a rank that disagrees with the board for any
  same-name, same-score pair.
