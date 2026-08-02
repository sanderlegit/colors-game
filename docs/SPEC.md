# Colors — Product & Technical Spec

Status: draft v1 · Owner: engineering · Last updated: 2026-08-01

## 1. One-liner

You get five seconds to memorize a color. Then it dissolves into a color picker
occupying the exact same shape, and you have to find it again. Your answer is
scored on perceptual distance from the truth.

## 2. Why this design works (and the traps)

The whole game lives or dies on three things:

1. **The dissolve.** The swatch must become the picker *in place* — same rect,
   same rounded corners, same position. If the picker appears somewhere else, the
   player gets a spatial anchor and the memory task changes character. This is a
   hard geometric requirement, and it is asserted in e2e tests (§9.4).
   The dissolve is a single cross-fade straight into the picker; it briefly
   passed through a neutral mask, see ADR 0006 and its reversal in ADR 0008.
2. **The scoring feels fair.** Naive RGB Euclidean distance does not match human
   perception — two blues 30 units apart look identical while two greens 30 units
   apart look obviously different. Players *will* notice and will call the game
   broken. We score in a perceptually uniform space (§6).
3. **The picker doesn't leak the answer.** The picker's starting position must
   carry zero information about the target, and must not accidentally hand out
   free wins (§5.3).

## 3. Round lifecycle

```
IDLE ──start──▶ MEMORIZE ──timer elapsed──▶ PICKING ──confirm──▶ REVEAL
                (5.000s)                     (untimed)             │
                                                                   │ next
                    ┌──────────────────────────────────────────────┘
                    ▼
              MEMORIZE (round n+1)   ... after final round ──▶ SUMMARY ──restart──▶ MEMORIZE
```

| State      | What the player sees                                                                 | Exits on            |
|------------|--------------------------------------------------------------------------------------|---------------------|
| `idle`     | Title, "Play" button, best score                                                       | `START`             |
| `memorize` | Swatch filled with the target color + a 5s countdown ring. Preview panel is empty/dim | timer reaches 0     |
| `picking`  | Swatch area cross-faded into the picker; preview panel shows the live guess; Confirm   | `CONFIRM`           |
| `reveal`   | Picker held in place with a red target reticle beside the guess; ΔE00, score, total, per-axis ΔE breakdown, your-vs-target coords (ADR 0009) | `NEXT`              |
| `summary`  | Per-round breakdown, total score, best-ever, replay + share-seed                        | `RESTART`           |

- **Rounds per game: 5.** Long enough to smooth out luck, short enough for one sitting.
- The memorize phase is **not** pausable and not skippable. (A "study longer"
  accessibility setting exists — see §8 — but it is a game-wide setting chosen
  before play, not a mid-round escape hatch.)
- The picking phase is **untimed** by design. Adding a second clock turns a memory
  game into a reflex game and punishes the fine motor control the picker demands,
  especially on touch.

## 4. Layout

Two regions, always both visible, never requiring a scroll:

```
 ┌──────────────────────────┐  ┌───────────┐
 │                          │  │  PREVIEW  │   ← your current guess, large flat fill
 │      SWATCH / PICKER     │  │           │
 │   (same rect, always)    │  ├───────────┤
 │                          │  │  readout  │   ← hex + coords, monospace
 └──────────────────────────┘  └───────────┘
        ▲ lightness bar directly beneath, same width (ADR 0007)
```

- **≥ 640px wide:** preview sits to the right of the swatch, as specified, with the
  round/total status spanning the top and the phase action bar spanning the bottom.
- **< 640px (portrait phones):** the screen reads top→bottom as **status → readout →
  swatch/picker → action bar** (ADR 0027). The round counter and running total pin
  the top; the readout (preview) sits *above* the picker with its guess/target
  colour chips flush against it, so the painted colour is compared to the swatch by
  eye; the numbers (ΔE, score, the per-axis breakdown, the You/Target coordinates)
  stack above those chips. Both the swatch and the readout remain on screen
  simultaneously — a layout constraint, not a suggestion. Verified in e2e at iPhone
  14 viewport.
- **The phase action lives in one reserved slot at the bottom, in the thumb zone**
  (ADR 0027): the memorize countdown, then Confirm, then Next round — exactly one at
  a time. Its box is reserved at a fixed height so the picker above it never moves as
  the control changes (the memorize↔picking swatch rect is asserted identical).
- The swatch is a fixed aspect ratio (1:1) sized by `min(70vw, 50vh)` so it never
  pushes the readout or the action bar below the fold, including with the iOS URL
  bar visible. Safe-area insets respected.
- **A Play / Leaderboard tab bar exists only between games** — the same two
  phases as the menu, `idle` and `summary` — and is `hidden` during `memorize`,
  `picking` and `reveal` (ADR 0013). A bar pinned at the edge of the screen next
  to a drag surface gets mis-tapped, and a mis-tap mid-round abandons a round the
  player has already spent five seconds memorizing. Entering a round forces the
  Play tab back without moving focus; Escape leaves the board.

## 5. Mechanics

### 5.1 Target generation

Sampled in OKLCh, not in the sRGB cube — uniform RGB sampling clusters visually
toward dark, saturated corners and over-represents colors people describe with the
same word. Concrete ranges and gamut-clipping strategy are set by
`docs/research/color-science.md`; the contract is:

- Targets are always in-gamut sRGB after chroma reduction (reduce C at constant
  L and h until in gamut — never clamp RGB channels, which shifts hue).
- Difficulty tiers exist as a data table, not as code branches.
- Generation is a pure function of `(seed, roundIndex)`.

### 5.2 Seeded randomness

Every game is fully determined by a single integer seed. This is non-negotiable
and cheap to build in from day one, because it buys:

- deterministic tests (no flaky "random color" assertions),
- reproducible bug reports ("seed 41762, round 3"),
- a daily challenge and head-to-head "same colors" mode for free later.

`Math.random()` is banned in `src/domain/**` and `src/color/**` (§ CLAUDE.md).

### 5.3 Picker start position

The picker cursor starts at **zero chroma** (a neutral gray) with a seeded-random
hue and mid lightness.

Rationale: a fixed start (e.g. pure red) systematically advantages targets near
that hue. A fully random start hands out occasional free wins. Starting at C=0
means the visible starting color is neutral gray regardless of the hidden hue —
it leaks nothing, looks identical every round, and gives every target the same
distance-to-travel in the dimension that matters most.

### 5.4 Confirm

Single explicit confirm action. No auto-submit on release — on touch, lifting a
finger is not an intent signal, and accidental submission is the single most
enraging failure mode in a game like this. Confirm is disabled until the player
has moved the picker at least once (prevents scoring a neutral gray by accident).

## 6. Scoring

- Perceptual distance is **CIEDE2000** on D65 CIELAB, `kL = kC = kH = 1`
  (ADR 0004). Note the D65 requirement: CSS `lab()` is D50 and must not be used
  as a reference.
- Distance maps to a 0–100 round score by
  `100 · exp(−((max(0, ΔE00 − 1) / 16) ^ 1.3))`, which gives:
  - a full 100 below the perceptibility threshold,
  - ΔE 2 → 97, 5 → 85, 12 → 54, 20 → 29, 45 → 2,
  - chance level around ΔE 11, with a random guess beating 50 only 5.4% of the time.
- Any averaged score shown in the UI is a **median**, not a mean — the
  random-guess distribution is heavily right-skewed and a mean misleads.
- The reveal screen shows the raw ΔE alongside the score. Showing the underlying
  number builds trust in the scoring; hiding it invites accusations of rigging.
- The reveal also marks where the target sat **on the picker the player just
  used** — a red reticle on the plane and bar beside the frozen guess, with the
  your-vs-target coordinates spelled out (ADR 0009). This is a learning aid, not
  a scoring change, and it appears only once the round is over: nothing about the
  target reaches the DOM during `picking` (§9.4 holds).
- The reveal **breaks the ΔE down by axis** — lightness / chroma / hue — and
  lights the one that cost the most, and draws the lightness gap as a segment on
  the bar. Because the plane carries hue and chroma but not lightness, a guess can
  sit on the target reticle and still lose the round on lightness alone; the
  breakdown names why. It is recomputed from the two colours for display only
  (`ciede2000Components`), never fed back into the score.
- Game score = sum of round scores (max 500).

Scoring invariants, enforced as property tests (§9.2):
`score(c,c) === 100` · `0 ≤ score ≤ 100` · monotonic in distance · symmetric in
its arguments.

## 7. Persistence

`localStorage` only, behind a port. Stores: best game score, games played, last
used settings. No accounts, no analytics. The game is fully playable offline.

**Amended by ADR 0016.** There is now a backend for the leaderboard, and it is
additive: an unranked game still needs no network and stores nothing server-side.
Ranked play adds a cookie identity, a server-issued seed, and a server-computed
score — see `ARCHITECTURE.md` § The backend. `localStorage` remains the only
store for settings and for the offline best score.

**Amended by ADR 0015**, which is where the player-visible rules of ranked play
live. Four of them the UI has to be able to say out loud:

- **A username is set after a game, not before.** An identity with no completed
  game cannot hold one.
- **Names are not unique** (ADR 0024). Two players may both be `ada`; the name
  you type is the name that lands, with no suffix. The server's answer is still
  the name that landed (its own trimmed, own-cased form), and the client renders
  that.
- **A ranked game that comes back faster than it could be played is refused**, as
  is one submitted more than 30 minutes after it was issued.
- **Submitting the same finished game twice is safe** and answers the same result.
  It is not a second game and does not count as one.

**"No analytics" above is now precise rather than absolute**, per ADR 0014, which
is what makes it still true in the sense that mattered: there is **no per-player
and no per-round record of anything**. Two things are collected and neither is
about a person.

- **Counters.** A finished game increments bucketed counts — day, tier, memorize
  window, round index, ΔE bucket, target-hue bucket — and nothing else. There is
  no row to subject-access and nothing to delete, because there is no row about
  anyone. `docs/OPERATIONS.md` § 2 is every question they answer.
- **Browser errors.** An uncaught exception posts its message and stack to
  `/api/client-error`, deduplicated by a hash of the two and kept 30 days. No
  identity, no address, no URL.

No third-party analytics, no tag, no beacon to anybody else, and — per ADR 0017 —
a Content-Security-Policy that would refuse one.

### 7.1 Identity

There is no account and nothing to sign into. A name is a 32-byte token in a
first-party cookie the server sets (ADR 0011):

- **It is minted by submitting a score, never by arriving.** A visitor who never
  finishes a game has no cookie and no row, so the set-username form appears on
  the summary screen and nowhere else.
- **The client cannot read its own identity.** Every identity-touching response
  echoes the canonical name, and the UI renders *that*, never what was typed.
- **Names are not unique** (ADR 0024). The name you set is the name you get; two
  players sharing a name is an ordinary outcome, and the board keeps them apart
  and stably ordered by account age.
- **You can change your name whenever** (ADR 0025). "Change name" reopens the
  form pre-filled; setting a new name overwrites the old one and keeps your
  scores and board position — a rename is not a new identity.
- **Lose the cookie, lose the name.** Cleared storage, a private window or a
  second device is a fresh identity. There is no recovery code, by decision.
- **There is no "forget me" in the app** (ADR 0025). A player cannot delete
  themselves; deletion is a rare operator action (`just delete-player`), so a
  data-removal request goes to whoever runs the stack rather than through a button.
- The client validates only that a name is non-empty after trimming and within
  `MAX_NAME_LENGTH`. Every other rule is the server's and its verdict is rendered
  verbatim — a client that mirrors the server's rules starts refusing names the
  server would have accepted.

### 7.2 The board

Best game score per player, one row each, with your own row marked by
`aria-current`, a visually-hidden "(you)" and a tint — three channels, never
colour alone (§8). It loads when the tab is opened, not at boot, and an empty
board is a successful answer rather than an error.

**A row expands into that attempt** (ADR 0026). Tapping a row slides a panel out
beneath it — the same per-round breakdown the summary screen shows (target and
guess chips, `Round N`, score and ΔE), for a game this browser never played. The
panel is the server *replaying* the stored game, not the seed handed over: nothing
about a seed reaches the client. Any number of rows open at once; tapping a row,
or the panel's ✕, closes it. The panel also offers **Copy link** and **Only this
seed**.

**A seed can be a challenge.** "Only this seed" filters the board to one game's
colours (best score per player on that seed); the share link opens straight onto
that filtered board. From there, **Play this seed** starts a game on the same
colours. A game played this way is a *challenge*: it ranks on that seed's board
but **never raises your global best score**, because its seed was chosen and a
chosen seed you could pick for being easy must not reach the global board
(ADR 0015, ADR 0026). The client never names a seed — it points at an existing
game, and the server reads the seed off that row.

### 7.3 Unranked games

A ranked game needs a server-issued seed, requested ahead of the click because
the game starts synchronously. When that request has not landed or has failed,
**the game is played unranked**: fully playable, personal best still recorded,
and the summary says so instead of showing a submit button that could only fail.
This is the property the whole seed-replay design exists to preserve — the game
never waits on, and never breaks with, the network.

## 8. Accessibility & motion

Be honest: this is a color-discrimination game and it is not fully playable by
someone with total color blindness. What we *will* do:

- **Numeric readout** of the current pick (hex + coordinates), always visible, so
  the picker is operable and verifiable without relying solely on the rendered color.
- **Full keyboard control**: the picker plane and lightness bar are focusable and
  Enter confirms. Visible focus rings. Arrow keys nudge; **shift makes the step
  coarser, never finer** (`COARSE_MULTIPLIER` = 10). Actual steps are per-axis and
  live in `src/ui/picker.ts` — see `docs/TUNING.md` rather than restating them here,
  because a spec that duplicates constants is a spec that goes stale.
- **`prefers-reduced-motion: reduce`** → the 450ms dissolve becomes an instant
  swap and the countdown ring stops animating (the numeric countdown remains).
  The 5s memorize window is unchanged; it is a game rule, not decoration.
- **Adjustable memorize duration** (3s / 5s / 8s) in settings, chosen before play.
  Scores record which duration was used.
- Touch targets ≥ 44×44 CSS px. `user-scalable=no` is forbidden.
- Never use color alone to convey UI state (buttons, focus, errors).

## 9. Test strategy

### 9.1 Unit — the pure core
Color conversions against published reference values; CIEDE2000 against the
Sharma/Wu/Dalal test set (this catches the classic hue-wraparound and RT-rotation
bugs that naive implementations ship with); state-machine transitions for every
(state × event) pair including the illegal ones.

### 9.2 Property-based (fast-check)
- `sRGB → OKLab → sRGB` round-trips within epsilon for the whole 8-bit cube (sampled).
- ΔE symmetry and identity.
- Score bounds and monotonicity.
- Gamut mapping always returns an in-gamut color.
- The reducer never throws for any (state, event) pair.

### 9.3 Component (happy-dom)
Each UI component mounts, renders from a state object, and emits the right events.
No snapshot tests of markup — they rot and nobody reads the diffs.

### 9.4 E2E (Playwright, Desktop Chrome + iPhone 14)
- **Geometry assertion:** the picker's bounding box equals the swatch's bounding
  box within 1px. This is the spec's headline requirement, so it is a test, not a
  hope.
- Happy path: start → wait out timer → drag picker → confirm → score appears.
- The target color is not present in the DOM during `picking`.
- Both swatch and preview are within the viewport at iPhone 14 size without scrolling.
- Reduced-motion path completes.
- **The tab bar is `hidden` during `picking`** — ADR 0013 names this assertion as
  its tripwire, and it is what protects the previous line's spare vertical space.
- The board: rows, the empty board, a failed board and its retry, your own row
  marked in text and not only in colour, and the whole tablist driven from the
  keyboard.
- **A round plays through to a score with every `/api` call refused.** The API is
  a place to put a score, never a thing the game needs in order to be played.
- Every replay vector reproduced bit-for-bit in a real browser and in workerd
  (ADR 0016).

A second config, `npm run e2e:backend`, runs one start → submit → claim → board
round trip against `wrangler dev` and a local D1. It is the only automated
thing that executes `server/db/d1.ts` or exercises the identity cookie.

### 9.5 Not doing
Pixel-diff visual regression on the picker gradient (GPU/font differences make it
flaky across machines and it would block CI for no real defect signal).

## 10. Out of scope for v1

Accounts, sound, animation polish beyond the dissolve, i18n, PWA install/offline
caching, daily challenge (the seed work makes it a small follow-up, deliberately).

**The server and the leaderboard left this list** with ADR 0016 — the seed work
made them a small follow-up too, exactly as §5.2 predicted. Accounts did not:
identity is an anonymous cookie, and there is still nothing to sign into.

## 11. Definition of done for v1

- [x] `npm run verify` green (typecheck, lint, unit, build)
- [x] `npm run e2e` green on Desktop Chrome and iPhone 14 projects
- [x] `npm run e2e:backend` green against a real Worker and a real (local) D1
- [x] Coverage ≥ 90% on `src/color/**` and `src/domain/**` — actually 100%
- [x] CIEDE2000 implementation passes the published test vectors — all 34 Sharma pairs
- [ ] Playable end-to-end on a real iPhone against the real stack (`just tailnet`, **not** a LAN address — ADR 0020)
- [ ] Every §8 accessibility item verified manually once, keyboard-only

**This section describes the target, not the shipped state.** Parts of §5.1
(difficulty tiers) and §8 (the memorize-duration setting) are implemented in the
domain but not reachable from the UI. `docs/BACKLOG.md` § Known gaps is the
authority on what actually works today; when the two disagree, BACKLOG is right.
