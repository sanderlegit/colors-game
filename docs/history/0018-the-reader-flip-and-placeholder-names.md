# 0018 — the reader flip, and names for people who never typed one

2026-08-03. Two things the log skipped over. This entry closes a gap — the
**reader flip** shipped between history 0016 and 0017 and never got its own
entry — and records the naming refinement that followed it.

## The reader flip (retrospective, ADR 0029)

0016 named the deeper defect behind the shared-phone bug: the display name lived
on the mutable `players` row and the board read it live, so a rename relabelled
every past entry and one cookie's two players collapsed into the latest name. The
fix shipped as ADR 0029 in three deploys — expand (`games.name` columns, stamped
at submit), the reader flip (the board and `rankOf` read `games`, best game per
`(player, name_key)`), and contract (drop the now-unused `players_board` index,
migration `0008`). The load-bearing detail: rank is counted over the *same* game
entries the board is drawn from, so a counted rank and a board position cannot
disagree — the invariant the whole model rests on.

## The two edges the flip left, and why they are the same question

Once the board read the game's name, two things looked wrong in production, and
they turned out to be one question — *what does a name attach to?*

- A player who **finished without naming** was off the board entirely (`name_key
  IS NOT NULL` excludes them). They played, saw a rank, found nothing.
- A player whose **best game was nameless** — played it, played again, then set a
  name — kept that best game unclaimed, because 0029's `setName` named only the
  *most recent* game. Their board entry undersold their real best (a live player
  sat at 117 with a 321 to their name).

## The fix (ADR 0032)

Every finished game is now born with a name: the submitted one, else the
identity's current name, else a **deterministic placeholder handle** derived from
the player id (`server/placeholder.ts`). Deterministic, not random, so all of one
player's unnamed games share a handle and fold to one board entry — and so
`setName` can recompute the key to find them. Setting a name then claims *every*
unclaimed game: those with no name, those under this player's placeholder, and the
most-recent game (which may carry an inherited name). Games under some other real
name are left alone, so a rename still never rewrites the board's history.

## The gotcha worth keeping

**An anonymous game has no owner, so "claim my unnamed games" is inference.** It
is right for one person per device and for take-turns-then-name; it misfires only
when two people both play anonymously on one cookie before either names, and the
first to name claims both. That case is unfixable server-side and self-corrects by
replaying — but it is the reason the claim is scoped to *placeholder-or-null-or-
most-recent* rather than "every game that isn't mine." Recorded in
`history/README.md` § Documentation traps.
