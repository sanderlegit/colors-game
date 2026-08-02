# 0006 — The client meets the board

2026-08-02 · BACKLOG 4.4: tabs, leaderboard, name claim, and the wiring in `main.ts`

What was built: `src/ui/tabs.ts`, `leaderboard.ts`, `identity.ts` and `shell.ts`,
one new selector (`isMenuVisible`), a `submitSlot` on the menu, and the async
orchestrators in `main.ts`. No ADR was written — 0011, 0012 and 0013 had already
decided everything structural, and the work is what they describe.

Three things were not obvious from the ADRs and are worth writing down.

## `nextSeed` is synchronous, so a ranked game must exist before the click

ADR 0012 says to feed the server's seed through `createGameView`'s existing
`nextSeed` dep. What that hides is a timing constraint: the menu's click handler
dispatches `START` with `deps.nextSeed()` in the same turn, so a `POST /api/games`
fired *when the player presses Play* resolves a round too late to be that round's
seed.

So the ranked game is minted **ahead** of the click — once at boot, and again
after each submission — and `nextSeed()` consumes it. `ranked?.seed ?? createSeed()`
is not a defensive fallback for a rare failure; it is the ordinary path whenever
the mint has not landed yet, and it is what makes an offline game a normal game.

The cost is recorded in `BACKLOG.md`: the row's `started_at` is when the mint
happened, not when Play was pressed, so a summary screen left open past the
server's 30-minute TTL submits against a stale row and gets a 410. Minimum
playtime (ADR 0015) is unaffected — prefetching only makes the elapsed time
larger, which is the safe direction.

## Moving focus to the revealed panel fights roving tabindex

The brief asked for "a user-initiated switch moves focus to the revealed panel".
Done literally, that breaks the tablist: with automatic activation, ArrowRight
selects the next tab *and focus is on that tab*. Yank focus to the panel and the
next arrow press has nothing to act on — the keyboard user cannot get back to the
bar without Shift+Tab.

`onSelect` therefore reports where the gesture came from, and `shell.ts` moves
focus only for `"pointer"`. A pointer activation leaves focus nowhere useful, so
the panel takes it; a keyboard activation already has focus in exactly the place
the APG wants it. Escape from the board focuses the *Play tab*, not the board, for
the same reason: it keeps the player in the bar they were navigating.

## The claim form is driven by identity, not by the submission

The obvious wiring is "show the form when the submission is `done`". Then a
rejected claim moves the state to `failed`, the form disappears, and the player
is told their name was refused with no way to try another one.

Driving the form off `PlayerIdentity` instead — show it when the identity is
`anonymous` — fixes that for free: a rejected claim leaves the identity anonymous,
so the form comes back with the server's message above it. It also keeps the
form honest in the other direction, because `anonymous` is only reachable after
a submission has minted the cookie (ADR 0011). This is the pattern to keep if
`SubmitState` ever grows another case.

## Smaller notes

- **The `[hidden]` trap bit again, exactly where the traps list says it would.**
  `.game { display: grid }` outranks the UA's `[hidden]` rule, so switching to
  the Leaderboard tab left the whole board rendered underneath the overlay until
  `.game[hidden] { display: none }` was added. Same for `.tabs` and
  `.leaderboard`. The stylesheet already did this dance for `.menu`.
- **A `role="status"` region that is `display: none` while empty may not announce
  when it fills.** Both live regions here stay in flow and go empty instead,
  which costs one grid gap. `.identity-hint` is not a live region and does
  collapse.
- **`main.ts` is still untestable.** ADR 0012 puts every `await` there, and
  nothing can import it without running `main()`, so the flows above are covered
  only by the components they drive. Logged as a gap.
