# 0003 — The result moves into a persistent side panel

Date: 2026-08-02

## What happened

Same session as 0002, immediately after it. The floating result card from
ADR 0009 (built in 0002) still *arrived* on reveal — it faded in over the board
on a phone, appeared from nowhere on desktop. The ask was for the result to have
a fixed home with the target and score simply hidden until submit, so nothing
moves. ADR 0010 does that: the preview and the reveal are merged into one
persistent side panel; result elements are laid out in every phase and only their
`visibility` flips on confirm. `src/ui/preview.ts` and its test were deleted — the
guess readout it owned is now the panel's "You" column.

## What the previous entry got wrong

0002 recorded that reserving the result's height "does not fit a phone" and that
an overlay was therefore necessary. That was true only while the preview and the
result were *two* panels. Merging them removes the double-count: the panel is
already on screen for the live guess, and reveal adds only the target column, the
stats and the button, which fit the space the panel already holds. The overlay
was not necessary; it was an artefact of the split.

## What was fiddly

- **`min-height` shadowing.** The base `.reveal-chip { min-height: 3rem }` quietly
  won over the phone `height`, so the "compact" strip was still 48px and the panel
  overflowed the iPhone 14 viewport by 15px. Clearing `min-height` in the phone
  media query fixed it. Lesson: when a mobile override sets `height`, check the
  base `min-height` isn't outvoting it.
- **Fitting the phone.** Measured the real boxes (a throwaway Playwright script)
  rather than guessing: board 273 + hud 76 + gaps left ~267px for the panel. Short
  swatch strips, a tighter grid gap, and dropping the ΔE prose (`display: none`
  below 640px) brought the panel to 262px — 21px of margin.
- **The no-shift guarantee is now an e2e assertion:** the swatch *and* the side
  panel must occupy identical boxes before and after confirm.

## Not repeated from 0002

The stale-dev-server trap (Playwright reusing a server from another checkout) bit
again this session; it is already documented in README § Environment traps. Ran
the suite against a worktree server on a spare port.
