# 0010 — The result lives in a persistent side panel; nothing shifts on reveal

Date: 2026-08-02 · Status: accepted · Supersedes ADR 0009

## Context

ADR 0009 kept the picker in place on the score screen and floated the result as a
card — side-docked on desktop, a bottom sheet on phones. Played, the card still
*arrives*: it fades/pops in over the board on a phone and appears from nowhere on
desktop. The information had no home until the round ended, so the eye had to
re-find everything each reveal.

The picker keeps its red reticle in place (ADR 0009 got that right — retained
here). What was wrong was treating the numbers as an overlay. The side region is
already on screen the whole time showing the live guess; the result belongs in
that same place, in slots that exist before the values do.

The old worry — "reserving the result's height does not fit a phone beside the
swatch" (history/0001) — turns out to be affordable once the *preview* and the
*result* are the **same** panel rather than two stacked ones: the guess readout
the player already sees during picking is the left ("You") column of the result.
Nothing new is added on reveal except the target column, the stats, and the
button, which fit in the space the panel already occupies.

## Decision

Merge the preview and the reveal into one persistent panel in the side region
(`src/ui/reveal.ts`; `src/ui/preview.ts` is deleted).

- During `picking` it is the live guess: the "You" column and the guess swatch
  update every frame.
- On `CONFIRM` the target swatch, the ΔE / round score / total, the "Target"
  column and the Next button become visible in slots that were **laid out all
  along**. They are toggled with `visibility`, not `display`, so the reveal moves
  nothing. Their text is still cleared until reveal, so the target never sits in
  the DOM early (SPEC §9.4).
- The floating card, its overlay/`position: fixed`, and the `.game-result` region
  are gone. The board is never covered.
- Phones top-anchor the game and the panel is compacted (short swatch strips,
  tighter spacing, the ΔE prose dropped) so the board and the full panel fit with
  no scroll (SPEC §4), verified at the iPhone 14 viewport.

## Consequences

- **The reveal is now a no-op for layout.** e2e asserts the swatch *and* the side
  panel occupy identical boxes before and after confirm — the concrete meaning of
  "nothing shifts."
- **One fewer component and a smaller bundle.** `preview.ts` and its test are
  gone; the JS shrank rather than grew.
- **The `.reveal` element is always present** (never `hidden`) and is the live
  guess readout, so it also carries the SPEC §8 always-on numeric readout that
  the preview used to own.
- **Retained from ADR 0009:** the picker stays in place through reveal with the
  red target reticle, guess cursor and connector; the no-leak guard; the target
  red token.
- **Dropped from ADR 0009:** the floating card, the bottom sheet, and the
  phone-occlusion limitation it carried — the board is fully visible now, so that
  gap is closed rather than mitigated.
- **Phone cost:** the ΔE explanation prose is hidden below 640px; the numbers and
  the reticle carry the same information. If a phone ever needs it back, make the
  panel scroll internally instead of reserving less.
