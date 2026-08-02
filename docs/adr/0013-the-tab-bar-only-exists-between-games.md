# 0013 — The tab bar only exists between games

Date: 2026-08-02 · Status: accepted

## Context

With a Play tab and a Leaderboard tab, the question is whether the tab bar is
persistent chrome or appears only when the menu does (`idle` and `summary`).

The first argument reached for was layout: that a ~52px bar (a 44px `--tap-target`
plus padding) does not fit at the iPhone 14 viewport. **That argument was checked
and it is false.** `--swatch-size` is `min(70vw, 50vh)`, which at 390×664 resolves
to 273px via `70vw`, not the 332px an earlier draft assumed. Adding the reserved
HUD box, the `20vh` preview, the grid gaps and the page padding leaves roughly
100px unspent. A persistent bar would fit today.

It is recorded here because it was nearly written down as fact, and a layout
argument that is quietly wrong is worse than no argument — the next person
reverses the decision, finds it fits, and concludes the whole ADR was noise.

The decision stands on different grounds.

## Decision

The tab bar is rendered when `isMenuVisible(state)` — exactly when `.menu` is up —
and is `hidden` during `memorize`, `picking` and `reveal`. Entering a non-menu
phase forces the Play tab back unconditionally, in `update`, without moving focus.

## Consequences

- **The real reason is mis-tap, not pixels.** A bar pinned at the edge of the
  screen, adjacent to a drag surface, on touch, gets hit by accident. Hitting it
  abandons an untimed round the player has already spent five seconds memorising.
  This is the same class of loss the spec already refuses elsewhere by declining
  to auto-submit on pointer release.
- **Nothing on the leaderboard is actionable mid-round.** There is no information
  there that changes how you pick, so the navigation buys the player nothing at
  the moment it costs the most.
- The ~100px of slack stays unspent, which the reveal overlay, safe-area insets
  and taller HUD arrangements all draw on. Spending it on permanent chrome is a
  choice we can still make later; unspending it is harder.
- **Cost of reversing:** on a viewport where `50vh` wins the `min()` — a short,
  wide window — the slack shrinks and a persistent bar starts pushing
  `--swatch-size` down. That changes the rect the player memorised, which is the
  one number in this codebase that must not move between `memorize` and `picking`.
  Any future persistent bar must be re-measured at the short-viewport end, not the
  tall one.
- **Tripwire:** `e2e/` asserts `.tabs` is hidden during `picking`. A change that
  makes the bar persistent fails loudly instead of silently eating vertical space,
  and the existing "swatch and preview on screen without scrolling" assertion is
  what it protects.
- Escape from the Leaderboard tab returns to Play.
