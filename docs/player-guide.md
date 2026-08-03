# How scoring works

## The short version

After you lock in a guess, we show you two numbers: **ΔE** and a **score out of 100**.

**ΔE is how far off you were.** Not how far off in maths — how far off *to a human
eye*. It's one number that answers "if these two colors sat side by side, how
different would they look?"

Lower is better. 0 means you nailed it.

## What a ΔE actually means

| ΔE | What you'd see | Your score |
|----|----------------|-----------:|
| under 1 | Nobody could tell them apart | **100** |
| 2 | You'd have to stare to spot it | **98** |
| 5 | Clearly two different colors, but close cousins | **87** |
| 12 | Same family, obviously wrong shade | **59** |
| 20 | Wrong | **34** |
| 45 | Not remotely the same color | **4** |

For scale: pure black against pure white is exactly 100.

## Why not just "how different are the numbers"

Because eyes aren't fair, and a scoring system that ignores that feels broken.

Two examples of the same "size" of mistake:

- Guess a **grey** that's slightly too warm, and it leaps out. We're extremely
  fussy about colors near grey — a faint cast is instantly visible.
- Make the *exact same* shift on a **vivid red**, and you'd never notice. Once a
  color is saturated, your eye stops tracking small changes in how saturated it is.

If the game measured those as equal errors, half your scores would feel unfair.
So ΔE deliberately weighs the same mistake differently depending on where you made
it — it's stricter near greys and pastels, more forgiving on vivid colors, and it
has a special correction for blues, where human vision is particularly odd.

It also cares about *which kind* of mistake you made. Getting the hue wrong is
usually more noticeable than getting the brightness slightly wrong, and the number
reflects that.

After each round the score screen splits your ΔE into three — **L** (lightness),
**C** (chroma/saturation) and **h** (hue) — and highlights the one that cost you
most. It is worth a look: the picker plane only shows hue and saturation, so
brightness is easy to neglect, and a guess that looks right on the plane can still
lose the round on lightness alone. The highlighted axis tells you where to aim
next time.

## Turning ΔE into a score

Three things the scoring curve is built to do:

1. **A miss nobody could see is a perfect score.** Anything under ΔE 1 gives you
   the full 100. Being docked 3 points for an invisible error would just feel
   petty.
2. **Near misses stay rewarding.** The curve is deliberately flat at the top, so
   getting close still feels good.
3. **Lucky guesses don't pay.** If you picked completely at random, you'd beat 50
   points only about 7% of the time. A good score means you actually remembered
   something.

## Why we show you the ΔE

We could show only the score. But a scoring system that hides the number it was
calculated from is impossible to argue with — and impossible to trust. The ΔE is
there so you can check our working.

If you want to verify it yourself: ΔE is the industry-standard **CIEDE2000**
measure, the same one used for quality control in printing, paint matching and
textiles. It isn't something we invented to make the game feel good.

## Seeing where you went wrong

When the round ends, the picker stays put and a **red marker** appears on it,
showing exactly where the target colour was — right next to your own guess, still
where you left it. The dashed line between them is your miss: if it points
sideways you were off on hue, up or down means saturation, and the red marker on
the lightness bar shows if you were too dark or too light. The panel beside the
picker also lists your colour against the target's in numbers, so you can see the
gap however you prefer to read it.

## Your name on the leaderboard

There is no account, no password and no email. When you finish a game we offer
you a username, and if you set one we remember it with a cookie in this browser.

**A username belongs to a finished game.** You can't set one before you've played —
that's what stops somebody sitting there reserving names.

**You can pick any name, even one somebody already has.** Ask for `ada` when
`ada` already exists and you are simply `ada` too — no suffix, no "try another".
If two of you share a name on the board, the older account sits above.

**You can change your name any time.** Hit "Change name" on the summary and type
a new one. The new name goes on the game you just played and on the games you
play next — it does not rewrite your older games, which stay on the board under
the name you played them with. So if you've played under two names, you'll see
both on the board. It's the same you either way; only the label on each game
changes.

**Lose the cookie and you lose the name.** Clear your browser data, open a private
window, or come back on your phone instead of your laptop, and you'll be a new
player with a fresh start. There's no way to recover it — no code to write down,
because there's nothing to prove it was you. That's the trade for never asking you
for an email address.

**Want your scores gone for good?** There's no delete button in the game — the
only thing stored about you is the name you chose and your scores, and if you
want them removed, ask whoever runs the site and they'll take you off the board.

## Why some games can't be submitted

The colours are not sent to you — your browser works them out from a number the
server picks, and the server keeps that number. When you submit, you send the
colours you *guessed*, and the server works out the score itself from the same
number. So a score on the board is one the server calculated, not one your browser
claimed. That is what "checked rather than taken on trust" means here.

Two consequences you may notice:

- **If the server can't be reached when a game starts**, it never picked a number
  for you, so there is nothing to check the game against. It still plays exactly
  as normal and your personal best still counts — it just can't go on the board,
  and the summary screen says so. We'd rather tell you that than show you a Submit
  button that was never going to work.
- **If your connection drops part-way through a ranked game**, the submission
  fails and that game can't be sent later. The score is still yours and your
  personal best still counts; the board entry is lost.

## A worked example

Say you scored **ΔE 19.4 → 36 points**.

That means: clearly the wrong color, but the same broad idea — right neighbourhood,
wrong house. You probably had the hue roughly right and missed on brightness or
saturation, or you were a step off on the hue wheel.

Five rounds, 100 points each, 500 total.
