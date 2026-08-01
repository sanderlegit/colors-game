# 0009 — The score screen keeps the picker in place with a target reticle

Date: 2026-08-01 · Status: accepted

## Context

The reveal (score) screen showed the target and the guess as two static chips on
a full-bleed opaque card that faded the picker away. It told the player *how far*
off they were — ΔE, score — but not *where*: the hue, chroma and lightness error
were numbers with no spatial anchor. A player trying to get better next round had
nothing to look at.

The picker the player just used is exactly the surface that would show it. Since
ADR 0007 the plane shows every hue at once, so "here is where the target sat, and
here is where you put it" is a single glance on a surface they already understand.

The tension: the reveal must show the target, but the picker must **never** leak
the target while the player is still guessing (SPEC §2.3, §5.3, §9.4). The round
is over at reveal, so showing it then is fair — the constraint is only that
nothing about the target reaches the DOM one moment earlier.

## Decision

On `reveal`, annotate the live picker in place instead of covering it.

- **The picker stays visible and goes read-only.** `swatch.ts` no longer fades
  back to a flat target fill on reveal; it keeps the picker layer up and takes
  its `pointer-events` away. The board does not move — the swatch rect is
  identical from memorize through reveal.
- **The picker gains reveal-only markers** (`picker.ts`): a red reticle at the
  target's hue/chroma, a red thumb at the target's lightness, and a dashed
  connector from the frozen guess cursor to the reticle. All three are drawn
  *only* during `reveal` and scrubbed — colour included — in every other phase,
  so the no-leak invariant is untouched. The guess cursor and thumb stay where
  the player left them, so both values are on screen at once and the gap is the
  error.
- **The reveal panel becomes a floating card, not a curtain** (`reveal.ts`,
  `styles.css`): side-docked on desktop, a compact bottom sheet on phones, so the
  annotated board shows through. It carries the split target/guess swatch, ΔE /
  score / total, a your-vs-target coordinate readout (hex, L, C, h), and a
  one-line explanation of ΔE.

## Consequences

- **Nothing colorimetric changes.** This is additive to the reveal; ADR 0004
  scoring and ADR 0007 geometry are untouched.
- **The no-leak guard holds and is still tested.** The e2e assertion that the
  target is absent from the DOM during picking passes unchanged, and a new
  assertion covers the reticle specifically.
- **Three modules take on a reveal role they did not have.** `swatch.ts` keeps
  the picker visible through reveal; `picker.ts` renders a read-only annotation;
  `reveal.ts` is a card beside the board rather than a cover over it. The reveal
  is still an *overlay*, not a reserved grid row — reserving its height does not
  fit a phone beside the swatch (history/0001), which is why it floats.
- **Phones top-anchor the whole game.** To give the bottom-sheet card room, the
  game grid is top-aligned at phone widths in *every* phase (it stays centred on
  desktop, where the card floats to the side). Anchoring only on reveal would
  move the board, which the geometry contract forbids.
- **Known limitation, where to look:** on a short phone the card's top edge can
  still tuck over the bottom of the plane and the lightness bar, so the *spatial*
  lightness gap may be hidden. The numeric readout (L you-vs-target) carries the
  same information, so nothing is lost but the picture. If this reads as
  confusing, shorten the card or make the sheet collapsible — do not move the
  board.
