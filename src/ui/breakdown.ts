/**
 * The per-round breakdown: a target chip, a guess chip, "Round N", and the
 * round's score with its ΔE.
 *
 * Extracted so the summary screen (`menu.ts`) and the leaderboard attempt panel
 * (`leaderboard.ts`) render rounds the same way — one place owns the
 * "Round N … (ΔE …)" wording and the two-chip layout, rather than two that drift
 * (ADR 0025). It renders from anything shaped like a scored round with its two
 * colours: `RoundResult` from the domain and `AttemptRound` from the API both
 * satisfy `BreakdownRound` structurally.
 *
 * Colour goes through `--fill-color` (`setFillColor`), never a rendered
 * `background` string — happy-dom silently drops `oklch()` from `background`, so
 * a test asserting on the fill would compare against `""`.
 */

import { oklchToCss } from "@/color/format";
import type { Oklch } from "@/color/types";
import { setFillColor } from "@/ui/swatch";

export type BreakdownRound = {
  readonly deltaE: number;
  readonly score: number;
  readonly target: Oklch;
  readonly guess: Oklch;
};

function chip(color: Oklch, label: string): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = "breakdown-chip";
  // A visually-hidden label so a screen reader can tell the two chips apart —
  // "target" and "your guess" are the whole point of showing both.
  element.setAttribute("aria-label", label);
  setFillColor(element, oklchToCss(color));
  return element;
}

function roundItem(round: BreakdownRound, index: number): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "breakdown-round";

  const label = document.createElement("span");
  label.className = "breakdown-round-label";
  label.textContent = `Round ${index + 1}`;

  const value = document.createElement("span");
  value.className = "breakdown-round-score";
  value.textContent = `${Math.round(round.score)} (ΔE ${round.deltaE.toFixed(1)})`;

  item.append(chip(round.target, "target"), chip(round.guess, "your guess"), label, value);
  return item;
}

/** Replace `list`'s children with one item per round, in order. */
export function fillBreakdown(list: HTMLElement, rounds: readonly BreakdownRound[]): void {
  list.replaceChildren(...rounds.map(roundItem));
}
