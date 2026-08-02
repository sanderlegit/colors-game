# 0013 — Leaderboard attempts and seed challenges

2026-08-02. Made a board row expand into that game's score screen, and turned a
seed into a shareable, playable challenge (ADR 0024). `npm run verify`, both e2e
projects, and `e2e:backend` all green.

## The design pivot the hygiene test forced

The obvious build — return the game's `seed` and let the client replay it, the
way the live game already derives targets from its own seed — is exactly what
`server/hygiene.test.ts` exists to stop. `seed` is on its `FORBIDDEN` list for
every response but `POST /games`, because a seed anywhere else lets a caller
precompute a game's targets. Two consequences fell out of that one line:

- **The attempt endpoint returns the replayed *colours*, not the seed.**
  `replayRounds` runs the same `generateTarget`/`scoreGuess` the score came from
  and echoes `{target, guess, deltaE, score}` per round. The server does the
  replay; the client just renders it through the same breakdown component the
  summary uses. This is more in keeping with ADR 0016 anyway — the server is
  authoritative *by replaying* — and it kept the seed home.
- **The seed filter keys on an opaque `gameId`, never the raw seed.**
  `?forGame=<gameId>` resolves the seed server-side; the share link is
  `/?board=<gameId>`. The integer seed never appears in a URL or a body, so the
  invariant holds without the client ever knowing a number.

## The anti-farming rule is a column, not a check

A "play these colours" mode collides head-on with ADR 0015: a ranked client that
could choose its seed would farm the easiest one. The resolution is `games.kind`
(`open` | `challenge`) and one clause in `submit.ts`: a challenge game is
`ranked: flags === 0 && kind === 'open'`, so it can never raise the global
`best_score`. It ranks only on its seed's board (`topPlayersBySeed`). A challenge
references an existing *game* and the seed is read off that row — the caller
points at a seed rather than naming one.

## Three things that bit

- **A `limit: 0` regression in the memory double.** Rewriting `topPlayers` to add
  `gameId` moved the limit check after the push, so `topPlayers(0)` returned one
  row. `memory.test.ts`'s "honours the limit" caught it immediately — the double's
  boundary tests earn their keep. Guard before the push, not after.
- **Making the name cell a button changed its accessible name.** The expander now
  wraps the name in a `<button>` with visually-hidden labels (" (you)",
  " — show round breakdown"), so `getByRole("rowheader", { name: "Player 1",
  exact: true })` no longer matched. Switched that e2e assertion to
  `getByText("Player 1", { exact: true })`, which targets the name span.
- **The slide has no JS timers.** The detail row animates
  `grid-template-rows: 0fr → 1fr`; a single `void detail.offsetHeight` read on the
  click forces layout so the class change transitions from the collapsed baseline
  rather than snapping. The closed panel is `visibility: hidden` so its controls
  stay out of the tab order, and the row uses the `hidden` attribute for a
  deterministic snap-close — happy-dom fires no `transitionend`, so nothing may
  depend on one.
