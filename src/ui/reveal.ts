/**
 * The side panel (SPEC §4, §8, ADR 0010): one fixed place for everything about
 * the current pick, so nothing on screen moves between guessing and scoring.
 *
 * During `picking` it is the live guess readout — the "You" column and the guess
 * swatch update every frame, exactly what the preview used to do. On `CONFIRM`
 * the target swatch, the ΔE / score / total and the "Target" column become
 * visible in slots that were **already reserved**, so the reveal shifts nothing
 * (ADR 0010, superseding the floating card of ADR 0009). The picker keeps its red
 * target reticle in place (ADR 0009); this panel is the numbers beside it.
 *
 * Result elements are toggled with `visibility`, not `display`, precisely so the
 * layout is byte-identical before and after the reveal. Their *content* is still
 * cleared until reveal, so nothing about the target sits in the DOM while the
 * player is guessing (SPEC §9.4) — `visibility: hidden` alone would leave the
 * text there to be read.
 *
 * The raw ΔE is deliberately shown beside the score: hiding the number the score
 * was computed from is what makes a scoring system look rigged.
 */

import { oklchToCss } from "@/color/format";
import type { Oklch } from "@/color/types";
import { isFinalRound } from "@/domain/selectors";
import type { GameState, RoundResult } from "@/domain/state";
import { setFillColor } from "@/ui/swatch";

const EMPTY = "—";

export type RevealHandlers = {
  readonly onNext: () => void;
};

export type RevealOptions = {
  /**
   * Hex approximation of a colour. Injected because `src/color/format.ts` has no
   * hex formatter yet (BACKLOG 1.4); without it the hex rows render `—` rather
   * than a number this module would have to invent.
   */
  readonly formatHex?: (color: Oklch) => string;
};

export type Reveal = {
  readonly element: HTMLElement;
  update(state: GameState): void;
  destroy(): void;
};

function addChip(
  row: HTMLElement,
  label: string,
  chipClass: string,
  figureClass: string,
): HTMLElement {
  const figure = document.createElement("figure");
  figure.className = figureClass;

  const chip = document.createElement("div");
  chip.className = chipClass;

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

/** The OKLCh coordinates, formatted the way the readout shows them. */
function coords(color: Oklch): { L: string; c: string; h: string } {
  return { L: color.L.toFixed(3), c: color.c.toFixed(3), h: `${color.h.toFixed(1)}°` };
}

/** Phases in which the player's guess exists and is worth showing live. */
function hasGuess(state: GameState): boolean {
  return state.phase === "picking" || state.phase === "reveal";
}

export function createReveal(
  root: HTMLElement,
  handlers: RevealHandlers,
  options: RevealOptions = {},
): Reveal {
  const formatHex = options.formatHex;

  const section = document.createElement("section");
  section.className = "reveal";
  section.setAttribute("aria-label", "Your guess and the round result");

  const pair = document.createElement("div");
  pair.className = "reveal-pair";
  // Your guess is always shown; the target sits in a reserved slot beside it and
  // only appears once the round is over.
  const guessChip = addChip(pair, "Your guess", "reveal-chip", "reveal-item");
  const targetChip = addChip(
    pair,
    "Target",
    "reveal-chip reveal-chip--target",
    "reveal-item reveal-item--target",
  );

  const stats = document.createElement("dl");
  stats.className = "reveal-stats";
  const deltaValue = addStat(stats, "ΔE", "reveal-delta");
  const scoreValue = addStat(stats, "Round score", "reveal-score");

  const compare = document.createElement("dl");
  compare.className = "reveal-compare";
  const head = document.createElement("div");
  head.className = "reveal-compare-row reveal-compare-head";
  head.setAttribute("aria-hidden", "true");
  const headSpacer = document.createElement("span");
  const headYou = document.createElement("span");
  headYou.textContent = "You";
  const headTarget = document.createElement("span");
  headTarget.className = "reveal-compare-head-target";
  headTarget.textContent = "Target";
  head.append(headSpacer, headYou, headTarget);
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

  section.append(pair, stats, compare, explain, next);
  root.append(section);

  function onClick(): void {
    handlers.onNext();
  }
  next.addEventListener("click", onClick);

  let renderedKey: string | null = null;

  function update(state: GameState): void {
    const live = hasGuess(state);
    const revealed = state.phase === "reveal";
    const result = revealed ? currentResult(state) : undefined;

    // The guess is not secret, so it renders live during picking. The target and
    // everything derived from it stay blank until the round is over.
    const guessCss = live ? oklchToCss(state.guess) : "";
    const targetCss = revealed ? oklchToCss(state.target) : "";
    const delta = result === undefined ? EMPTY : result.deltaE.toFixed(3);
    const score = result === undefined ? EMPTY : String(Math.round(result.score));
    const nextLabel = isFinalRound(state) ? "See summary" : "Next round";

    const key = `${state.phase}|${guessCss}|${targetCss}|${delta}|${score}|${nextLabel}`;
    if (key === renderedKey) return;
    renderedKey = key;

    // The result slots are laid out in every phase; `is-revealed` only flips their
    // visibility, so their appearance moves nothing (ADR 0010).
    section.classList.toggle("is-revealed", revealed);
    // No guess yet during memorize — the panel reads as waiting, not broken.
    section.classList.toggle("is-dim", !live);

    const guess = live ? coords(state.guess) : null;
    setFillColor(guessChip, guessCss);
    hexRow.you.textContent = live ? (formatHex?.(state.guess) ?? EMPTY) : EMPTY;
    lightnessRow.you.textContent = guess?.L ?? EMPTY;
    chromaRow.you.textContent = guess?.c ?? EMPTY;
    hueRow.you.textContent = guess?.h ?? EMPTY;

    const target = revealed ? coords(state.target) : null;
    setFillColor(targetChip, targetCss);
    hexRow.target.textContent = revealed ? (formatHex?.(state.target) ?? EMPTY) : EMPTY;
    lightnessRow.target.textContent = target?.L ?? EMPTY;
    chromaRow.target.textContent = target?.c ?? EMPTY;
    hueRow.target.textContent = target?.h ?? EMPTY;
    deltaValue.textContent = delta;
    scoreValue.textContent = score;
    next.textContent = nextLabel;
  }

  function destroy(): void {
    next.removeEventListener("click", onClick);
    section.remove();
  }

  return { element: section, update, destroy };
}
