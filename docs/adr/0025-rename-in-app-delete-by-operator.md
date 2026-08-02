# 0025 — Rename in the app; deletion is an operator action

Date: 2026-08-02 · Status: accepted

## Context

The summary screen let a named player do exactly one thing to their identity:
**"Forget me"**, a real `DELETE` with cascade (ADR 0011). There was no way to
change a name. So the only route to "I want to be called something else" was to
forget — which deletes the row, the games and the board position — and then play
another game and set a new name.

That surfaced as a real complaint: a player hit "Forget me" to change their name
and lost their scores off the board. Two things were wrong at once:

- **There was no rename**, even though the server already supported it: setting a
  name is `POST /api/name` → `Repo.setName`, which overwrites and bumps
  `name_changes` (that column exists for exactly this). The client just never
  showed the form to a named player — `form.hidden = identity.status !== "anonymous"`.
- **"Forget me" was overloaded.** It answered both "change my name" and "erase my
  data" with one destructive button, so the common, harmless intent went through
  the rare, irreversible action.

ADR 0011 justified the hard delete as the compliance story ("*compliance is one
line of notice plus a working forget me*"). That is the piece this ADR revisits.

## Decision

**Split the two intents. The app does the common one; an operator does the rare
one.**

1. **"Change name" in the app.** A named player gets a "Change name" button that
   reopens the form pre-filled with their current name; submitting goes through
   the same `POST /api/name` as the first set. A rename keeps the identity, the
   cookie, the scores and the board row — only the displayed name changes. This is
   the whole answer to "I want a different name," and it needs no server change.

2. **No self-serve delete.** `DELETE /api/me` and its handler are removed, along
   with the client's `forget()` and the two-click confirm. The app never destroys
   a player. This is the deliberate reversal of ADR 0011's "Forget me is a real
   DELETE": the button existed to be the erasure path, and erasure is no longer a
   self-serve action.

3. **Deletion is `just delete-player`.** The rare need — a name that has to come
   off the board — is an operator action: an fzf picker over the `players` table
   that deletes the chosen player and their games from D1
   (`scripts/players-table.mjs` formats the list; the recipe runs the two-statement
   delete). It defaults to the local database and makes you re-type the id before
   touching production. `Repo.deletePlayer` stays as the canonical shape this
   mirrors, still tested, though no handler calls it.

## Consequences

- **A rename is cheap and keeps everything.** Because `setName` overwrites, a
  player can rename as often as they like with no loss. Nothing rate-limits it
  yet; `name_changed_at` is there if board-spam via rapid renames ever shows up
  (same standing note as `handlers/name.ts`). Worth watching, not worth building
  blind.
- **`/api/me` is read-only apart from the `waitUntil` touch.** The only writes to
  a player are now the name set and the score submission. There is no
  cookie-clearing response left in the API, so `http/cookie.ts`'s `clearCookie` is
  used only by tests — kept, because a future sign-out or admin path is the
  obvious place it returns.
- **Erasure is no longer self-serve, and that is a real change to ADR 0011's
  posture.** A player cannot delete their own data from the UI; a deletion request
  goes to whoever runs the stack. For a hobby game whose only stored personal
  datum is a self-chosen display name plus a cookie hash, an out-of-band delete is
  a defensible way to honour a request — but it *is* a person in the loop where
  there was a button. **How we would know this was wrong:** if delete requests
  arrive often enough to be a chore, the fix is to bring back a self-serve delete
  as its own clearly-labelled action (not folded into rename), reusing
  `deletePlayer` behind a new `DELETE /api/me`.
- **The operator path has no unit coverage of its SQL**, like everything reached
  only through `wrangler`. The formatter (`players-table.mjs`) and the two-statement
  delete were exercised by hand against a real local D1 (list → delete → re-list);
  the `deletePlayer` primitive they mirror is unit-tested through `memoryRepo`.
- **`fzf` is a tool the operator installs, not a dependency of the app.** The
  zero-runtime-dependency rule (CLAUDE.md) is about the shipped bundle; a recipe
  that shells out to `fzf` adds nothing to it, the same way `just tailnet` shells
  out to `tailscale`.

## Rejected

- **A non-destructive "Sign out" in the app** (clear the cookie, keep the board
  row). It reads well, but it leaves a row no cookie can ever reclaim or delete,
  and once rename exists the reason to reach for it — "I want a different name" —
  is gone. Deletion still has to exist *somewhere*, and an operator script is a
  better home for a rare, irreversible action than a button next to the game.
- **Keep "Forget me" as a real delete, just relabel it.** Preserves self-serve
  erasure, but keeps a destructive button one tap from the summary for an action
  almost nobody wants, which is how the original complaint happened.
- **An authenticated admin API for deletion.** More surface (auth, a protected
  route) than a data problem this size needs. `wrangler d1 execute` already *is*
  the authenticated admin channel; the recipe just makes it pickable.
