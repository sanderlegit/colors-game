/**
 * The reveal screen (SPEC §3, §6): the round result, read against the picker the
 * player was just using. The picker stays in place and gains a target reticle
 * (ADR 0009); this panel is the compact card beside it — the colours side by
 * side, the raw ΔE, the score, and your-vs-target coordinates so the error is
 * legible as numbers, not colour alone (SPEC §8).
 *
 * The raw ΔE is deliberately visible. Showing the number the score was computed
 * from is what makes the scoring auditable; hiding it invites the accusation
 * that the curve is rigged, and that accusation is unanswerable once the input
 * is secret.
 *
 * It is no longer a full-bleed opaque cover: it must not hide the annotated
 * picker. Reserving its height in the grid does not fit a phone (history/0001),
 * so it is still an overlay — just a card, not a curtain.
 */

import { oklchToCss } from "@/color/format";
import type { Oklch } from "@/color/types";
import { isFinalRound, totalScore } from "@/domain/selectors";
import type { GameState, RoundResult } from "@/domain/state";
import { ROUNDS_PER_GAME } from "@/domain/state";
import { setFillColor } from "@/ui/swatch";

const MAX_GAME_SCORE = ROUNDS_PER_GAME * 100;
const EMPTY = "—";

export type RevealHandlers = {
  readonly onNext: () => void;
};

export type RevealOptions = {
  /**
   * Hex approximation of a colour. Injected for the same reason the preview does
   * it — `src/color/format.ts` has no hex formatter yet (BACKLOG 1.4) — so the
   * hex row renders `—` rather than a number this module would have to invent.
   */
  readonly formatHex?: (color: Oklch) => string;
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

/** Your value and the target's, on one labelled row. */
type CompareRow = { readonly you: HTMLElement; readonly target: HTMLElement };

function addCompareRow(list: HTMLElement, label: string): CompareRow {
  const row = document.createElement("div");
  row.className = "reveal-compare-row";

  const term = document.createElement("dt");
  term.textContent = label;

  const you = document.createElement("dd");
  you.className = "reveal-compare-you";
  you.textContent = EMPTY;

  const target = document.createElement("dd");
  target.className = "reveal-compare-target";
  target.textContent = EMPTY;

  row.append(term, you, target);
  list.append(row);
  return { you, target };
}

/** The result just recorded by `CONFIRM`, or `undefined` before there is one. */
function currentResult(state: GameState): RoundResult | undefined {
  return state.results[state.results.length - 1];
}

/** The OKLCh coordinates, formatted the way the preview readout formats them. */
function coords(color: Oklch): { L: string; c: string; h: string } {
  return { L: color.L.toFixed(3), c: color.c.toFixed(3), h: `${color.h.toFixed(1)}°` };
}

export function createReveal(
  root: HTMLElement,
  handlers: RevealHandlers,
  options: RevealOptions = {},
): Reveal {
  const formatHex = options.formatHex;

  const section = document.createElement("section");
  section.className = "reveal";
  section.setAttribute("aria-label", "Round result");
  section.hidden = true;

  const card = document.createElement("div");
  card.className = "reveal-card";

  const pair = document.createElement("div");
  pair.className = "reveal-pair";
  // Target first, guess second — the same order the compare columns use.
  const targetChip = addChip(pair, "Target");
  const guessChip = addChip(pair, "Your guess");

  const stats = document.createElement("dl");
  stats.className = "reveal-stats";
  const deltaValue = addStat(stats, "ΔE", "reveal-delta");
  const scoreValue = addStat(stats, "Round score", "reveal-score");
  const totalValue = addStat(stats, "Total", "reveal-total");

  // Your value against the target's, so the gap the reticle shows on the picker
  // is also readable as numbers (SPEC §8 — never colour alone).
  const compare = document.createElement("dl");
  compare.className = "reveal-compare";
  const head = document.createElement("div");
  head.className = "reveal-compare-row reveal-compare-head";
  head.setAttribute("aria-hidden", "true");
  for (const label of ["", "You", "Target"]) {
    const cell = document.createElement("span");
    cell.textContent = label;
    head.append(cell);
  }
  compare.append(head);
  const hexRow = addCompareRow(compare, "hex");
  const lightnessRow = addCompareRow(compare, "L");
  const chromaRow = addCompareRow(compare, "C");
  const hueRow = addCompareRow(compare, "h");

  const explain = document.createElement("p");
  explain.className = "reveal-explain";
  explain.textContent =
    "ΔE is the perceived gap between your colour and the target — lower is better. " +
    "The red reticle marks where the target sat; the score falls as the gap grows.";

  const next = document.createElement("button");
  next.type = "button";
  next.className = "reveal-next";
  next.textContent = "Next round";

  card.append(pair, stats, compare, explain, next);
  section.append(card);
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

    const guess = visible ? coords(state.guess) : null;
    const target = visible ? coords(state.target) : null;
    hexRow.you.textContent = visible ? (formatHex?.(state.guess) ?? EMPTY) : EMPTY;
    hexRow.target.textContent = visible ? (formatHex?.(state.target) ?? EMPTY) : EMPTY;
    lightnessRow.you.textContent = guess?.L ?? EMPTY;
    lightnessRow.target.textContent = target?.L ?? EMPTY;
    chromaRow.you.textContent = guess?.c ?? EMPTY;
    chromaRow.target.textContent = target?.c ?? EMPTY;
    hueRow.you.textContent = guess?.h ?? EMPTY;
    hueRow.target.textContent = target?.h ?? EMPTY;
  }

  function destroy(): void {
    next.removeEventListener("click", onClick);
    section.remove();
  }

  return { element: section, update, destroy };
}
