# 0026 — Leaderboard rows expand into a replayed attempt; seeds become challenges

Date: 2026-08-02 · Status: accepted

## Context

The board (ADR 0012) shows one row per player: rank, name, score. A row is a
dead end — you cannot see *how* a score was reached, and there is no way to play
the same colours somebody else did, even though §5.2 of SPEC promised the seed
work made a "same colours" mode nearly free.

Two features were asked for together:

1. **Click a row to see that attempt's score screen** — the per-round
   thumbnails, titles and ΔE the summary screen already shows for the game you
   just played (`src/ui/menu.ts`).
2. **A per-seed board** — filter the leaderboard to one game's colours, with a
   shareable link, so players can compete on the same targets.

Both run into invariants that are load-bearing rather than incidental:

- **The seed may leave the server in exactly one response**, `POST /api/games`
  (`server/hygiene.test.ts`). A seed anywhere else hands a caller the ability to
  derive a game's targets before playing it — the residual hole ARCHITECTURE
  documents. So neither feature may echo a seed.
- **A ranked client must not choose its seed** (`server/replay.ts`, ADR 0015).
  A player who could name the seed would search for an easy one and farm the
  board. So a "play these colours" flow cannot simply let the client pass a seed.
- **`src/ui/**` is synchronous** (ADR 0012). Expanding a row needs a fetch, and
  the fetch cannot live in the component.

## Decision

### An attempt is a replay, echoed with its colours

`GET /api/games/:gameId/attempt` replays a finished, unflagged game through the
same pure core the score was computed with (`replayRounds` in `server/replay.ts`,
which arranges `generateTarget` + `scoreGuess` and does no colour maths of its
own) and returns `{ totalScore, rounds[] }` where each round carries
`{ deltaE, score, target, guess }`.

- **It returns the colours, not the seed.** The server does the replay; the
  client renders it. This keeps the seed rule intact and reuses the exact
  breakdown renderer the summary uses (`src/ui/breakdown.ts`, extracted from
  `menu.ts` so the two cannot drift).
- **It is public and identity-free.** The board is public, so the attempts it
  links to are. It serves only `finished` and `flags = 0` games — exactly what
  the board can reference — and answers 404 for anything else rather than
  distinguishing "no such game" from "not viewable".
- **The board row carries a `gameId`.** Already a public value (`POST /games`
  returns one), and hygiene forbids `seed`/`player_id`/`token`, not `gameId`. It
  is the opaque handle everything else keys on, so the raw seed never has to.

The row itself is the toggle: a `<button>` in the name cell carries
`aria-expanded`/`aria-controls` for assistive tech, and a pointer anywhere on the
row toggles too. Any number of rows open at once; a detail row slides out beneath
and pushes the rest down. The component stays synchronous — it emits
`onExpand(gameId)` and the composition root pushes the replay back through
`setAttempt`, the same shape as `setLeaderboard`.

### A chosen seed is a *challenge*, and challenges rank on their own board only

A game is now `open` or `challenge` (`games.kind`, migration `0003`):

- **`open`** — a self-minted seed, the only kind before this ADR, and the only
  kind that may raise `players.best_score`.
- **`challenge`** — a game on a seed *chosen* from an existing finished game,
  via `POST /api/games { challengeOf: <gameId> }`. The server resolves the seed
  and difficulty from that row; the client still never names the numbers it
  plays. **A challenge never raises the global best score** — its seed was
  chosen, and a chosen seed the player could pick for being easy must not reach
  the global board (this is ADR 0015's rule, upheld). It ranks only on its
  seed's board.

`GET /api/leaderboard?forGame=<gameId>` returns that game's seed's board —
best finished, unflagged game per named player on the seed, both kinds counted,
so the player who originated the seed competes on it too (`topPlayersBySeed`, a
`ROW_NUMBER()` window over `(seed, total_score DESC)`). The seed is resolved from
the row server-side; the query and the response speak only `gameId`.

The player-facing loop: expand a row → **Copy link** (`/?board=<gameId>`) or
**Only this seed** (filter in place). A filtered board shows a top-left **Back**
button (clear the filter) and a banner listing the seed's target colours beside
**Play set** (a `challengeOf` game). A shared `/?board=` link opens straight onto
the seed board.

## Consequences

- **The residual memory-read hole is wider for challenges, and contained.** A
  challenge player may have seen the target colours — the attempt panel shows
  them, and the filter banner now lists them outright beside **Play set**, so a
  challenger sees the set before playing. This surfaces an exposure that was
  already one row-expand away rather than creating a new one: the colours were
  always public on the seed board. ADR 0015's exact-match and improbable-accuracy
  flags still apply, and because a challenge cannot touch `best_score`, the blast
  radius is one seed's board, not the global one. **How to detect a problem:**
  watch the flag rate on `kind = 'challenge'` rows; a spike there is the signal
  this trade went wrong.
- **`best_game_id` is now surfaced, not just stored.** It is the global board's
  `gameId`. It was always public in spirit — it is a spent submit token on a
  finished game, inert against the conditional-`UPDATE` submit guard — but a
  reader who wants to be sure the token cannot be replayed should read
  `server/db/d1.ts`'s `finishGame`, not assume it.
- **Two new SQL statements only a real D1 can vet** (the window query, the
  `best_game_id` column read). `e2e/backend.spec.ts` exercises both; a memory
  double cannot.
- **The share link opens a read-only board, not a game.** Playing the challenge
  is an explicit **Play set** button, so a link cannot start a game the
  recipient did not ask for. The clipboard write is silent on denial (insecure
  context); no feedback is shown yet — `docs/BACKLOG.md` § Known gaps.
- **Difficulty tiers remain unreachable from the UI**, so a challenge inherits
  the origin's `normal` difficulty; when tiers ship, the inheritance is already
  correct because it reads the origin row rather than the request.
