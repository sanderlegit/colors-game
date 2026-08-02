# 0015 — Anti-abuse policy for ranked play

Date: 2026-08-02 · Status: accepted

## Context

ADR 0016 built the replay and deliberately left four things undecided:
rate-limiting policy, name-change limits, the meanings of the `games.flags`
bitfield, and the sweep of stale `active` games. The seven handlers cannot be
written without the first and third: every one of them is an endpoint an
anonymous caller can reach, and `flags` is a column nothing was allowed to set.

The threat is not a determined attacker with a botnet. It is one person with
`curl` and twenty minutes, who wants the top of a board that has no accounts and
no CAPTCHA. Everything below is calibrated to make that cost more than it is
worth, while costing an honest player nothing they can perceive.

Two facts shape all of it. The server issues the seed, so a client *can* compute
its own targets — ARCHITECTURE.md § Known limitation says so plainly, and closing
that would cost a round trip inside the memorize phase. And the identity is a
cookie that costs nothing to discard, so any per-player limit is also a limit on
how much a fresh cookie buys.

## Decision

**1. Two flag bits, and a flagged game is never told about.**

| Bit | Name | Set when |
|---|---|---|
| 0 | `FLAG_EXACT_MATCH` | two or more rounds match the target to <1e-9 on all three coordinates |
| 1 | `FLAG_IMPROBABLE_ACCURACY` | every round comes in under ΔE00 0.5 |

Both describe an *input a hand cannot produce*, not a score that is merely good.
The picker reports coordinates derived from pointer position over canvas size, so
even a deliberate pixel-perfect click is off by ~1e-3; agreement to fifteen digits
means the target was read out of memory rather than remembered.

A flagged game gets the ordinary 200 and the ordinary body. It counts as played
and stays on the player's history; it may not raise `players.best_score`, which is
the column the board is built from. `Repo.recordFinishedGame` therefore takes a
required `ranked` flag rather than inferring anything.

**2. A submission must be physically possible, measured on our clock against our
row.** `finished_at - started_at >= ROUNDS × (memorize_ms + 600)`, where
`memorize_ms` is read from the `games` row written at issue time. At the 8s window
that is 43 seconds. Failing it is 422; a game older than 30 minutes is 410.

**3. Three limits, none of which an honest player meets.** 20 starts per player
per hour; 60 anonymous starts per mint bucket per day; 30 new identities per mint
bucket per day. Each answers 429 with `Retry-After`. The two daily counters are
separate keys in `mint_buckets` so that a burst of anonymous starts cannot lock
out the new players behind the same NAT.

A mint bucket is `SHA-256(kind ‖ CF-Connecting-IP ‖ salt-of-the-day)`. **The raw
address is never stored and never logged** — it exists inside one request and
becomes 32 bytes. The salt rotates daily, so yesterday's buckets cannot be
re-derived from an address even with the table in hand; an unsalted hash of an
IPv4 address is 2^32 guesses, which is not a privacy measure.

**4. `games.player_id` is attached at mint when a valid cookie is present.** The
scaffold left it NULL until submission, which made `countGamesStartedSince` blind
at exactly the moment it was needed. A caller with no cookie still gets NULL —
requiring an identity to start would put the cookie back on page load, which
ADR 0011 forbids — and is counted against the day's bucket instead.

**5. v1 issues only `difficulty: "normal"`.** `createReducer` calls
`deps.target(seed, roundIndex)` with no third argument, so a game stored as `hard`
would replay against colours the player never saw. A request for another tier is
refused, not downgraded.

## Consequences

- **The salt is per isolate, not per deployment.** It is minted by
  `makeDailySalt()` in the Worker rather than read from a binding, because there
  is no secret binding and adding one is a deploy-time change this task could not
  verify. The privacy property holds absolutely; the *counting* does not — a
  caller spread across isolates gets a multiple of the ceiling. It is a coarse
  brake, not a quota. Binding a secret and returning it from `productionDeps`
  makes it exact without touching a caller.
- **Off Cloudflare there is no `CF-Connecting-IP`, so every caller shares one
  bucket.** That over-counts locally and never under-counts in production, which
  is the safe direction, but it means `wrangler pages dev` will start refusing
  identities after 30. 
- **A flagged player is never told, so they cannot iterate.** The cost is that a
  false positive is silent too: a player whose score never reaches the board has
  no way to ask why. Both thresholds are deliberately far outside human range to
  keep that population empty.
- **The exact-match detector does not catch the patient cheat.** Reading the
  target and then nudging a coordinate by 1e-3 defeats both bits. That is
  accepted: it is the same hole ARCHITECTURE.md § Known limitation already
  documents, and the only real fix is withholding the seed.
- An unnamed player's submission still reports a rank — where they *would* sit —
  because `src/platform/api.ts` has no null rank on a submission. The empty name
  sorts first among equal scores, flattering them by at most one place.
- Name-change limits and the stale-game sweep remain undecided.
  `players.name_changes`, `name_changed_at` and `games_sweep` are still plumbing
  with no rule attached.

## How we would know this was wrong

Three numbers, all of which need the ADR 0014 counters to be visible at all:

- **429s at all.** An honest player never sees one. A non-trivial 429 rate on
  `POST /api/games` means the per-player window is too tight or a NAT is being
  counted as a person; the bucket ceilings are the knob, and they are in
  `server/limits.ts` with nothing else depending on them.
- **Flagged games as a fraction of finished games.** Expect approximately zero. A
  rate above a fraction of a percent means a heuristic is catching players, not
  cheats — the first suspect is `FLAG_IMPROBABLE_ACCURACY` at a memorize window
  of 8s on `easy`, which does not exist yet but would be the tier that makes five
  sub-0.5 rounds conceivable.
- **A board top that stops moving.** If the top ten stop changing while play
  continues, the detectors are being routed around rather than tripped, and the
  next lever is the one ADR 0016 declined: withhold the seed and stream targets.
