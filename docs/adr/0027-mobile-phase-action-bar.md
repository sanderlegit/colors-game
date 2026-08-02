# 0027 — The phone screen is status · readout · picker · action bar

Date: 2026-08-02 · Status: accepted

## Context

The phone layout stacked **readout → HUD → picker** top-to-bottom. Three things
were wrong with it, all found by playing on a phone:

- The round counter and running total were buried in the middle HUD row, where the
  eye does not go for status. They are the two glanceable facts of the game.
- **Next round** sat at the *top* of the screen, inside the reveal panel — the one
  control you reach for every round, furthest from the thumb.
- A full grid gap separated the guess/target colour chips from the picker, so the
  colour you painted could not be compared against the swatches at a glance. The
  chips and the picker are the comparison; putting space between them undoes it.

The HUD conflated two unlike things: game-wide **status** (round, total) and the
per-phase **control** (memorize countdown, Confirm). Splitting them is what lets
each go where it belongs.

## Decision

The phone screen reads top→bottom as **status · readout · swatch/picker · action
bar**:

- **Status** (`status.ts`, `.game-status`) pins the top: `Round N of 5` and
  `Total S / 500`, one constant line. It carries no control and reads no clock.
- **Readout** (`reveal.ts`, `.game-side`) sits directly above the picker. Its
  numbers — ΔE, score, the per-axis breakdown, the You/Target coordinates — stack
  on top, and the guess/target colour **chips render last**, flush against the
  picker, so the painted colour is compared to the swatch by eye. The row gap
  between the readout and the picker collapses to zero on phones.
- **Picker** (`swatch.ts` + `picker.ts`, `.game-stage`) keeps the `1fr` middle,
  the largest square the space allows.
- **Action bar** (`action.ts`, `.game-action`) is one reserved slot at the bottom,
  in the thumb zone, showing exactly one control per phase: the memorize countdown,
  then Confirm (with its disabled hint), then Next round / See summary. `action.ts`
  is `hud.ts`'s countdown + Confirm, with `reveal.ts`'s Next button folded in;
  `hud.ts` is deleted.

Desktop (≥640px) keeps the two-column swatch/readout arrangement, with status
spanning the top and the action bar spanning the bottom.

## Consequences

- **The geometry guarantee is stronger, not weaker.** The memorize↔picking swatch
  rect is asserted identical in e2e. Everything above the picker is now
  height-stable by construction — status is one line, the readout is height-reserved
  (ADR 0010) — and the action bar sits *below* the picker with a fixed-height box,
  so the control swapping through it (ring → Confirm → Next) never moves the picker.
  Previously a phase-dependent HUD reflow *above* the stage was the exact thing that
  could shift the memorized rect.
- **ADR 0010 is preserved, not superseded.** The reveal still fills a reserved slot
  by flipping `visibility`, not `display`; reordering the panel's children and
  moving the Next button out does not touch that mechanism. The "nothing shifts on
  reveal" e2e assertion still holds.
- The countdown moved from beside the status to the bottom bar. During memorize the
  player is looking at the swatch, not the thumb zone, and the numeric `role=timer`
  seconds are still announced — the move costs nothing legible.
- Class names changed: `.hud-*` split into `.status-*` and `.action-*`; the shared
  button rule is `.action-confirm, .action-next`. e2e locators and the `hud.test.ts`
  suite moved to `status.test.ts` / `action.test.ts` accordingly.

## How we would detect a regression

The failure mode of a bottom action bar is height drift between its three states
pushing the picker. The `swatch rect identical in memorize and picking` and
`reveal fills its reserved place without shifting` e2e tests, both at iPhone 14
size, are the tripwires. If the picker ever visibly jumps between memorize and
picking, the action row stopped being a fixed track — start there.
