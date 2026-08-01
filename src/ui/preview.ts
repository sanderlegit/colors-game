/**
 * The live guess panel (SPEC §4) and the numeric readout (SPEC §8).
 *
 * The readout is an accessibility requirement, not a debug affordance: it is
 * always on screen so the picker is operable and verifiable without relying on
 * the rendered color. That is why it is not behind a toggle and why it is not
 * removed in production.
 *
 * During `memorize` the panel is dimmed and empty (SPEC §3) — there is no guess
 * yet, and showing the picker's neutral start color would imply one exists.
 */

import { oklchToCss } from "@/color/format";
import type { Oklch } from "@/color/types";
import type { GameState } from "@/domain/state";
import { setFillColor } from "@/ui/swatch";

/** Shown wherever a value is unavailable, so the readout never collapses in height. */
const EMPTY = "—";

export type PreviewOptions = {
  /**
   * Hex approximation of the guess. Injected because `src/color/format.ts`
   * (BACKLOG 1.4) does not exist yet; without it the hex row renders `—` rather
   * than a number this module would have to invent.
   */
  readonly formatHex?: (color: Oklch) => string;
};

export type Preview = {
  readonly element: HTMLElement;
  update(state: GameState): void;
  destroy(): void;
};

function addRow(list: HTMLElement, label: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "preview-row";

  const term = document.createElement("dt");
  term.textContent = label;

  const value = document.createElement("dd");
  value.className = "preview-value";
  value.textContent = EMPTY;

  row.append(term, value);
  list.append(row);
  return value;
}

/** Phases in which a guess exists and is worth showing. */
function hasGuess(state: GameState): boolean {
  return state.phase === "picking" || state.phase === "reveal";
}

export function createPreview(root: HTMLElement, options: PreviewOptions = {}): Preview {
  const section = document.createElement("section");
  section.className = "preview";
  section.setAttribute("aria-label", "Current guess");

  const fill = document.createElement("div");
  fill.className = "preview-fill";

  const readout = document.createElement("dl");
  readout.className = "preview-readout";

  const hexValue = addRow(readout, "hex");
  const lightnessValue = addRow(readout, "L");
  const chromaValue = addRow(readout, "C");
  const hueValue = addRow(readout, "h");

  section.append(fill, readout);
  root.append(section);

  let renderedKey: string | null = null;

  function update(state: GameState): void {
    const active = hasGuess(state);
    const guess = state.guess;

    // The CSS string is the dirty key: it is finer-grained than every row of the
    // readout, and empty exactly when there is no guess to show. Bailing on it
    // before formatting keeps the per-frame cost at one string compare.
    const background = active ? oklchToCss(guess) : "";
    if (background === renderedKey) return;
    renderedKey = background;

    const hex = active ? (options.formatHex?.(guess) ?? EMPTY) : EMPTY;
    section.classList.toggle("is-dim", !active);
    setFillColor(fill, background);
    hexValue.textContent = hex;
    lightnessValue.textContent = active ? guess.L.toFixed(3) : EMPTY;
    chromaValue.textContent = active ? guess.c.toFixed(3) : EMPTY;
    hueValue.textContent = active ? `${guess.h.toFixed(1)}°` : EMPTY;
  }

  function destroy(): void {
    section.remove();
  }

  return { element: section, update, destroy };
}
