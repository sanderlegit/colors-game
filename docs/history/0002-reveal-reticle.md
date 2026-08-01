# 0002 — The score screen learns to teach

Date: 2026-08-02

## What happened

Added a learning aid to the reveal screen (ADR 0009): the picker stays in place
after a guess, marked with a red reticle at the target's position beside the
frozen guess cursor, a dashed connector for the gap, red/white thumbs on the
lightness bar, and a card with the your-vs-target coordinates and a one-line ΔE
explanation. No domain change — `target`, `guess` and the round result are all
already on state at reveal time; the work was entirely in `swatch.ts` (keep the
picker visible through reveal), `picker.ts` (reveal-only markers), `reveal.ts`
(card, not curtain) and `styles.css`.

## What was awkward

- **The reveal had to stop being an opaque curtain.** It was a full-bleed cover
  precisely because reserving its height in the grid does not fit a phone
  (history/0001). Keeping *that* reasoning while making it float meant leaving it
  a `position: fixed` overlay but shrinking it to a card and making the section
  click-through so only the card catches the pointer.
- **The phone could not show a centred board and a bottom sheet at once.** First
  cut had the card covering most of the board. The fix was to top-anchor the
  whole game at phone widths in *every* phase (not just reveal — moving the board
  on reveal would break the geometry contract), which cleared room below. Even so
  the card's top can tuck over the bottom of the plane and the lightness bar on a
  short phone; the numeric readout carries that information, so it is a picture
  lost, not data. Recorded in ADR 0009 § known limitation.
- **The no-leak invariant drove the marker code.** The reticle carries the target
  colour, so it is set only during `reveal` and scrubbed on every other phase.
  The e2e no-leak test was extended to assert the reticle specifically, not just
  the swatch fill and reveal chips.

## Tooling surprise

Playwright's `reuseExistingServer` (on when not CI) reused a **stale `vite dev`
server from the main checkout** on port 5173, so the whole e2e suite ran against
old code and reported the new `.picker-target` element as "not found". The tell
was "element(s) not found" for a node that plainly exists in both source and the
built bundle. Fix: run the suite against a worktree server on a different port.
Added to `README.md` § Environment traps.
