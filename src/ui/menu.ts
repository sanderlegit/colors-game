/**
 * The idle and summary screens (SPEC §3).
 *
 * These are one component rather than two because they are the same panel in two
 * states — a title, a stat block and a single primary action — and splitting them
 * would mean duplicating the layout and the show/hide logic to save nothing.
 */

import { totalScore } from "@/domain/selectors";
import type { GameState } from "@/domain/state";
import { ROUNDS_PER_GAME } from "@/domain/state";
import { oklchCss, setFillColor } from "@/ui/swatch";

const MAX_GAME_SCORE = ROUNDS_PER_GAME * 100;

export type MenuHandlers = {
  readonly onStart: () => void;
  readonly onRestart: () => void;
};

export type MenuOptions = {
  /** Best score across sessions, from platform storage. */
  readonly bestScore?: number;
};

export type Menu = {
  readonly element: HTMLElement;
  update(state: GameState): void;
  setBestScore(score: number): void;
  destroy(): void;
};

export function createMenu(
  root: HTMLElement,
  handlers: MenuHandlers,
  options: MenuOptions = {},
): Menu {
  let bestScore = options.bestScore ?? 0;

  const section = document.createElement("section");
  section.className = "menu";
  section.hidden = true;

  const heading = document.createElement("h1");
  heading.className = "menu-title";

  const blurb = document.createElement("p");
  blurb.className = "menu-blurb";

  const breakdown = document.createElement("ol");
  breakdown.className = "menu-breakdown";
  breakdown.hidden = true;

  const best = document.createElement("p");
  best.className = "menu-best";

  const action = document.createElement("button");
  action.type = "button";
  action.className = "menu-action";

  section.append(heading, blurb, breakdown, best, action);
  root.append(section);

  // One listener for both states; which event it dispatches depends on the phase
  // the reducer is in, and the reducer ignores the wrong one anyway.
  let phase: GameState["phase"] = "idle";
  function onClick(): void {
    if (phase === "summary") handlers.onRestart();
    else handlers.onStart();
  }
  action.addEventListener("click", onClick);

  function renderBreakdown(state: GameState): void {
    breakdown.replaceChildren();
    for (const [index, result] of state.results.entries()) {
      const item = document.createElement("li");
      item.className = "menu-round";

      // Safe to show the targets here — the game is over.
      const chip = document.createElement("span");
      chip.className = "menu-round-chip";
      setFillColor(chip, oklchCss(result.target));

      const guessChip = document.createElement("span");
      guessChip.className = "menu-round-chip";
      setFillColor(guessChip, oklchCss(result.guess));

      const label = document.createElement("span");
      label.textContent = `Round ${index + 1}`;

      const value = document.createElement("span");
      value.className = "menu-round-score";
      value.textContent = `${Math.round(result.score)} (ΔE ${result.deltaE.toFixed(1)})`;

      item.append(chip, guessChip, label, value);
      breakdown.append(item);
    }
  }

  let renderedKey: string | null = null;

  function update(state: GameState): void {
    phase = state.phase;
    const visible = state.phase === "idle" || state.phase === "summary";
    const total = Math.round(totalScore(state));

    const key = `${state.phase}|${visible ? total : 0}|${bestScore}|${state.results.length}`;
    if (key === renderedKey) return;
    renderedKey = key;

    section.hidden = !visible;
    if (!visible) return;

    if (state.phase === "summary") {
      heading.textContent = `${total} of ${MAX_GAME_SCORE}`;
      blurb.textContent =
        total > bestScore ? "A new best. Nicely remembered." : "Here is how each round went.";
      renderBreakdown(state);
      breakdown.hidden = false;
      action.textContent = "Play again";
    } else {
      heading.textContent = "Colors";
      blurb.textContent = `Memorize a color, then find it again. ${ROUNDS_PER_GAME} rounds.`;
      breakdown.hidden = true;
      action.textContent = "Play";
    }

    best.textContent = bestScore > 0 ? `Best: ${bestScore}` : "";
    best.hidden = bestScore <= 0;
  }

  function setBestScore(score: number): void {
    bestScore = score;
    renderedKey = null; // force the next update through
  }

  function destroy(): void {
    action.removeEventListener("click", onClick);
    section.remove();
  }

  return { element: section, update, setBestScore, destroy };
}
