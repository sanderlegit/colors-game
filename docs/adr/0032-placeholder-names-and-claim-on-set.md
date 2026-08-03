# 0032 — placeholder names, and setting a name claims your unclaimed games

Status: accepted — **refines 0029**; the board is now name-grouped / toggleable per [0033](0033-leaderboard-best-per-name-or-all-games.md)

## Context

ADR 0029 moved the display name onto the game and made the board read it there,
so a rename can no longer rewrite the board's history. It left two rough edges,
both surfaced in production:

1. **A finisher who never names themselves is invisible.** The board filters
   `name_key IS NOT NULL`, so a game played without a name is off the board
   entirely — the player finishes, sees a rank, and finds nothing on the board.
2. **A nameless best game is stranded.** 0029's `setName` claimed only the *most
   recent* finished game. A player whose best game was not their most recent —
   they played it, then played again, then set a name — kept that best game
   nameless and off the board, so their board entry understated their real best.
   (Observed live: a player whose profile best-score was 321 sat on the board at
   117.)

The two are the same underlying question — **what does a name attach to?** — seen
from opposite ends: what to show for a game with no name, and which games a name
should reach back and claim.

## Decision

**Every finished game is born with a name, and setting a name claims all of your
unclaimed games.**

- **Placeholder at submit.** The game's name is `submittedName ?? player.name ??
  placeholderName(playerId)` (`server/placeholder.ts`). `placeholderName` is a
  *deterministic* function of the player id — a random-*looking* `AdjectiveAnimal-xx`
  handle — so all of one player's unnamed games share one handle, fold to one
  board entry, and can be found again by recomputing the key. Not random,
  because stability is the point; not unique, because names never are.
- **Claim on set.** `setName` names the player's games where
  `name_key IS NULL OR name_key = <this player's placeholder key> OR id = <the most
  recent finished game>`. That reaches legacy nameless games (fixing edge 2),
  going-forward placeholder games, and the just-finished game that may carry an
  *inherited* name (the shared-device take-turns case from 0029). Games under some
  *other* real name are untouched, so a rename still never rewrites the board's
  past.

`POST /api/name` is unchanged; the identity's `players.name` is still the prefill
default; scoring and replay are untouched. The response's `name` stays `null` for
a player who has not chosen one, even while their game shows a placeholder on the
board — the client reads that as "you're showing as a handle; set a name to claim
it."

The ADR 0031 name-change audit is unaffected: it records `players.name_key`
moving, and a placeholder lives only on the *game*, never on the player row, so a
first claim still audits as `null → chosen-name`, not `placeholder → name`.

## Consequences

- **One accepted edge, and it is unfixable server-side.** If two people both play
  *anonymously* on one device (one cookie, one identity) before *either* sets a
  name, the first to name claims both games — an unnamed game has no owner to
  distinguish. It self-corrects: the second person plays again under their name.
  The common shared-device flow (each plays, then names before handing over) is
  correct, because the earlier game is already claimed by the time the next
  person plays.
- **Placeholders are deterministic, not stored with a flag.** No schema change:
  `setName` recomputes `placeholderName(playerId)`'s key to find the games to
  claim. The cost is that a real name a player deliberately chooses that happens
  to equal their own placeholder handle would be claimed together — harmless, and
  astronomically unlikely.
- **How to detect a mistake later:** if the board fills with `AdjectiveAnimal-xx`
  rows that never convert to real names, players are finishing and not naming —
  a UI prompt problem, not a data one. If a named player's board entry still
  undersells their `players.best_score`, the claim predicate missed a game.
- Board queries are unchanged — a placeholder is just a name — so the rank ==
  board-position invariant (0029) carries over untouched.
