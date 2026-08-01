/**
 * The reveal screen (SPEC §3, §6): target and guess side by side, the raw ΔE,
 * the round score and the running total.
 *
 * The raw ΔE is deliberately visible. Showing the number the score was computed
 * from is what makes the scoring auditable; hiding it invites the accusation
 * that the curve is rigged, and that accusation is unanswerable once the input
 * is secret.
 */

import { oklchToCss } from "@/color/format";
import { isFinalRound, totalScore } from "@/domain/selectors";
import type { GameState, RoundResult } from "@/domain/state";
import { ROUNDS_PER_GAME } from "@/domain/state";
import { setFillColor } from "@/ui/swatch";

const MAX_GAME_SCORE = ROUNDS_PER_GAME * 100;
const EMPTY = "—";

export type RevealHandlers = {
  readonly onNext: () => void;
};

export type Reveal = {
  readonly element: HTMLElement;
  update(state: GameState): void;
  destroy(): void;
};

function addChip(row: HTMLElement, label: string): HTMLElement {
  const figure = document.createElement("figure");
  figure.className = "reveal-item";

  const chip = document.createElement("div");
  chip.className = "reveal-chip";

  const caption = document.createElement("figcaption");
  caption.textContent = label;

  figure.append(chip, caption);
  row.append(figure);
  return chip;
}

function addStat(list: HTMLElement, label: string, className: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "reveal-stat";

  const term = document.createElement("dt");
  term.textContent = label;

  const value = document.createElement("dd");
  value.className = className;
  value.textContent = EMPTY;

  row.append(term, value);
  list.append(row);
  return value;
}

/** The result just recorded by `CONFIRM`, or `undefined` before there is one. */
function currentResult(state: GameState): RoundResult | undefined {
  return state.results[state.results.length - 1];
}

export function createReveal(root: HTMLElement, handlers: RevealHandlers): Reveal {
  const section = document.createElement("section");
  section.className = "reveal";
  section.setAttribute("aria-label", "Round result");
  section.hidden = true;

  const pair = document.createElement("div");
  pair.className = "reveal-pair";
  const targetChip = addChip(pair, "Target");
  const guessChip = addChip(pair, "Your guess");

  const stats = document.createElement("dl");
  stats.className = "reveal-stats";
  const deltaValue = addStat(stats, "ΔE", "reveal-delta");
  const scoreValue = addStat(stats, "Round score", "reveal-score");
  const totalValue = addStat(stats, "Total", "reveal-total");

  const next = document.createElement("button");
  next.type = "button";
  next.className = "reveal-next";
  next.textContent = "Next round";

  section.append(pair, stats, next);
  root.append(section);

  function onClick(): void {
    handlers.onNext();
  }
  next.addEventListener("click", onClick);

  let renderedKey: string | null = null;

  function update(state: GameState): void {
    const visible = state.phase === "reveal";
    const result = visible ? currentResult(state) : undefined;

    const targetCss = visible ? oklchToCss(state.target) : "";
    const guessCss = visible ? oklchToCss(state.guess) : "";
    const delta = result === undefined ? EMPTY : result.deltaE.toFixed(3);
    const score = result === undefined ? EMPTY : String(Math.round(result.score));
    const total = visible ? `${Math.round(totalScore(state))} of ${MAX_GAME_SCORE}` : EMPTY;
    const nextLabel = isFinalRound(state) ? "See summary" : "Next round";

    const key = `${visible ? "1" : "0"}|${targetCss}|${guessCss}|${delta}|${score}|${total}|${nextLabel}`;
    if (key === renderedKey) return;
    renderedKey = key;

    section.hidden = !visible;
    setFillColor(targetChip, targetCss);
    setFillColor(guessChip, guessCss);
    deltaValue.textContent = delta;
    scoreValue.textContent = score;
    totalValue.textContent = total;
    next.textContent = nextLabel;
  }

  function destroy(): void {
    next.removeEventListener("click", onClick);
    section.remove();
  }

  return { element: section, update, destroy };
}
