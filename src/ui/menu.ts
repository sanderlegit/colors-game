/**
 * The idle and summary screens (SPEC §3).
 *
 * These are one component rather than two because they are the same panel in two
 * states — a title, a stat block and a single primary action — and splitting them
 * would mean duplicating the layout and the show/hide logic to save nothing.
 */

import { isMenuVisible, totalScore } from "@/domain/selectors";
import type { GameState } from "@/domain/state";
import { ROUNDS_PER_GAME } from "@/domain/state";
import { fillBreakdown } from "@/ui/breakdown";

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
  /**
   * Empty mount point above the primary action, for the name-claim block. The
   * same arrangement as `swatch.pickerSlot`: this component owns the layout, the
   * shell owns what goes in it, and neither has to know about the other's state.
   */
  readonly submitSlot: HTMLElement;
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

  const submitSlot = document.createElement("div");
  submitSlot.className = "menu-submit-slot";

  const action = document.createElement("button");
  action.type = "button";
  action.className = "menu-action";

  section.append(heading, blurb, breakdown, best, submitSlot, action);
  root.append(section);

  // One listener for both states; which event it dispatches depends on the phase
  // the reducer is in, and the reducer ignores the wrong one anyway.
  let phase: GameState["phase"] = "idle";
  function onClick(): void {
    if (phase === "summary") handlers.onRestart();
    else handlers.onStart();
  }
  action.addEventListener("click", onClick);

  let renderedKey: string | null = null;
  let lastPhase: GameState["phase"] | null = null;
  let beatTheRecord = false;

  function update(state: GameState): void {
    phase = state.phase;
    const visible = isMenuVisible(state);
    const total = Math.round(totalScore(state));

    // Decided once, on the way in, and deliberately before the composition root
    // stores the new record. Re-deriving it from `bestScore` on later frames
    // would make the celebration vanish the moment the new best is saved.
    if (state.phase === "summary" && lastPhase !== "summary") {
      beatTheRecord = total > bestScore;
    }
    lastPhase = state.phase;

    const key = `${state.phase}|${visible ? total : 0}|${bestScore}|${state.results.length}`;
    if (key === renderedKey) return;
    renderedKey = key;

    section.hidden = !visible;
    if (!visible) return;

    if (state.phase === "summary") {
      heading.textContent = `${total} of ${MAX_GAME_SCORE}`;
      blurb.textContent = beatTheRecord
        ? "A new best. Nicely remembered."
        : "Here is how each round went.";
      // Safe to show the targets here — the game is over.
      fillBreakdown(breakdown, state.results);
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

  return { element: section, submitSlot, update, setBestScore, destroy };
}
