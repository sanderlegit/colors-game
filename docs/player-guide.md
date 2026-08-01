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
| 2 | You'd have to stare to spot it | **97** |
| 5 | Clearly two different colors, but close cousins | **85** |
| 12 | Same family, obviously wrong shade | **54** |
| 20 | Wrong | **29** |
| 45 | Not remotely the same color | **2** |

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

## Turning ΔE into a score

Three things the scoring curve is built to do:

1. **A miss nobody could see is a perfect score.** Anything under ΔE 1 gives you
   the full 100. Being docked 3 points for an invisible error would just feel
   petty.
2. **Near misses stay rewarding.** The curve is deliberately flat at the top, so
   getting close still feels good.
3. **Lucky guesses don't pay.** If you picked completely at random, you'd beat 50
   points only about 5% of the time. A good score means you actually remembered
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

## A worked example

Say you scored **ΔE 19.4 → 30 points**.

That means: clearly the wrong color, but the same broad idea — right neighbourhood,
wrong house. You probably had the hue roughly right and missed on brightness or
saturation, or you were a step off on the hue wheel.

Five rounds, 100 points each, 500 total.
