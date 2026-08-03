# 0034 — The leaderboard highlight (`isYou`) matches by name, not by account

Date: 2026-08-03 · Status: accepted — **extends 0033**

## Context

The board marks the caller's own rows with `isYou`, which the client renders as a
highlight. It was set by comparing each row's `player_id` to the caller's — the
id on the `players` row named by their cookie.

But a `players` row is minted **per cookie** (ADR 0011): the same person on a
second device, or after clearing cookies, is a *new* account under the *same
name*. So a player who has been "sander" on three devices is three accounts, and
an id-based `isYou` lights up only the rows from the one cookie making the
request — "some of my rows are purple, but not all." Observed in production:
"sander" was three accounts (player ids 3, 5, 7).

This is the same premise ADR 0033 already acted on: player id is ephemeral, the
name is the closest thing to a stable person, and the board and rank were moved
to group and rank **by name**. `isYou` was the last place still keyed on the id.

## Decision

`isYou` matches **by name**: a row is the caller's when its folded name key
equals the caller's. `nameKey(row.name)` reproduces the row's stored `name_key`
(the same fold that wrote it), so the compare is exact and needs no schema
change. A caller who has **not named themselves** has no name to match on, so for
them `isYou` falls back to the per-cookie id match — their own placeholder row.

Same rule for the global board, the all-games view, and the per-seed board. It is
display-only: nothing about scoring, ranking, or stored data changes.

## Consequences

- **Two different people who both choose the same name each see the other's
  same-name rows highlighted.** The server cannot tell them apart — non-unique
  names (ADR 0024) plus per-cookie ids leave no stable per-person signal. This is
  the identical trade ADR 0033 accepted for best-per-name grouping, and it is
  accepted here for the same reason: "same name = same player" is the honest
  model for a casual board, and the failure mode is a cosmetic highlight, not a
  score or a rank.
- **How to detect a mistake later:** if a highlight is ever load-bearing for
  something that matters (a moderation action, a private view), it must not lean
  on `isYou` — revisit this then. Today it only tints a row.
- The `player_id` still leaves `topPlayers` for the server-side id fallback and
  is still never sent to the client (`leaderboard.test.ts` pins the response
  keys).
