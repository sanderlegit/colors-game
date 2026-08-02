/**
 * The side panel (SPEC §4, §8, ADR 0010): one fixed place for everything about
 * the current pick, so nothing on screen moves between guessing and scoring.
 *
 * During `picking` it is the live guess readout — the "You" column and the guess
 * swatch update every frame, exactly what the preview used to do. On `CONFIRM`
 * the target swatch, the ΔE / score and the "Target" column become visible in
 * slots that were **already reserved**, so the reveal shifts nothing (ADR 0010,
 * superseding the floating card of ADR 0009). The picker keeps its red target
 * reticle in place (ADR 0009); this panel is the numbers beside it.
 *
 * The panel reads numbers-first, colour-chips-last: on phones it sits directly
 * above the picker, so the guess/target swatches land flush against it for an
 * at-a-glance comparison, with the readout stacked above (ADR 0026). Advancing to
 * the next round is the phase action and lives in the bottom bar
 * (`src/ui/action.ts`), not here.
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

import { oklchToLab } from "@/color/convert";
import { ciede2000Components } from "@/color/deltaE";
import { oklchToCss } from "@/color/format";
import type { Oklch } from "@/color/types";
import type { GameState, RoundResult } from "@/domain/state";
import { setFillColor } from "@/ui/swatch";

const EMPTY = "—";

/** The axes of the ΔE breakdown, in the order the row shows them. */
const BREAKDOWN_AXES = ["lightness", "chroma", "hue"] as const;
type BreakdownAxis = (typeof BREAKDOWN_AXES)[number];
const AXIS_LABEL: Record<BreakdownAxis, string> = { lightness: "L", chroma: "C", hue: "h" };

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

/** One axis of the ΔE breakdown: its container (for the dominant flag) and value. */
type BreakdownCell = { readonly axis: HTMLElement; readonly value: HTMLElement };

function addBreakdownCell(row: HTMLElement, axis: BreakdownAxis): BreakdownCell {
  const cell = document.createElement("div");
  cell.className = "reveal-breakdown-axis";
  cell.dataset.axis = axis;

  const label = document.createElement("span");
  label.className = "reveal-breakdown-label";
  label.textContent = AXIS_LABEL[axis];

  const value = document.createElement("span");
  value.className = "reveal-breakdown-value";
  value.textContent = EMPTY;

  cell.append(label, value);
  row.append(cell);
  return { axis: cell, value };
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

export function createReveal(root: HTMLElement, options: RevealOptions = {}): Reveal {
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

  // Where the ΔE came from, per axis. The plane shows hue and chroma but not
  // lightness (it lives on the bar), so a guess can sit right on the target
  // reticle and still score poorly on lightness alone; naming the dominant axis
  // is what turns a surprising score into a legible one.
  const breakdown = document.createElement("div");
  breakdown.className = "reveal-breakdown";
  breakdown.setAttribute("aria-label", "Where the ΔE came from, by axis");
  const breakdownCells: Record<BreakdownAxis, BreakdownCell> = {
    lightness: addBreakdownCell(breakdown, "lightness"),
    chroma: addBreakdownCell(breakdown, "chroma"),
    hue: addBreakdownCell(breakdown, "hue"),
  };

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
    "The breakdown shows which axis cost you most: lightness lives on the bar, not " +
    "the plane, so a reticle that looks spot-on can still lose the round on L alone.";

  // Numbers first, colour chips last: on phones the panel sits directly above the
  // picker, so the guess/target swatches land flush against it for an at-a-glance
  // comparison, with the readout stacked above them (ADR 0026). Advancing is the
  // phase action and lives in the bottom bar (`src/ui/action.ts`), not here.
  section.append(stats, breakdown, compare, explain, pair);
  root.append(section);

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

    const key = `${state.phase}|${guessCss}|${targetCss}|${delta}|${score}`;
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

    // The breakdown is derived from the two colours (already in `key`), not from
    // the scored number, so it never touches the scoring path.
    if (revealed) {
      const parts = ciede2000Components(oklchToLab(state.target), oklchToLab(state.guess));
      let dominant: BreakdownAxis = "lightness";
      for (const axis of BREAKDOWN_AXES) {
        breakdownCells[axis].value.textContent = parts[axis].toFixed(1);
        if (parts[axis] > parts[dominant]) dominant = axis;
      }
      const hasError = parts[dominant] > 0;
      for (const axis of BREAKDOWN_AXES) {
        breakdownCells[axis].axis.classList.toggle("is-dominant", hasError && axis === dominant);
      }
    } else {
      for (const axis of BREAKDOWN_AXES) {
        breakdownCells[axis].value.textContent = EMPTY;
        breakdownCells[axis].axis.classList.remove("is-dominant");
      }
    }
  }

  function destroy(): void {
    section.remove();
  }

  return { element: section, update, destroy };
}
