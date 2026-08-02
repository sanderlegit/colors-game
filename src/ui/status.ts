/**
 * The top status line (SPEC §3, §4): round counter and running total, the two
 * pieces of game-wide state that are worth a glance at any moment.
 *
 * It carries no controls and reads no clock — the phase action (memorize timer,
 * Confirm, Next round) lives in `src/ui/action.ts` at the bottom of the screen,
 * so this row is one constant line of text. That constancy is load-bearing: it
 * sits above the picker, and anything above the picker that changes height
 * between phases moves the memorized rect out from under the picker (ADR 0027).
 *
 * The running total lives here beside the round counter rather than in the reveal
 * panel — it is game-wide status, not a per-round result (ADR 0010).
 */

import { roundNumber, totalScore } from "@/domain/selectors";
import type { GameState } from "@/domain/state";
import { ROUNDS_PER_GAME } from "@/domain/state";

const MAX_GAME_SCORE = ROUNDS_PER_GAME * 100;

export type Status = {
  readonly element: HTMLElement;
  update(state: GameState): void;
  destroy(): void;
};

export function createStatus(root: HTMLElement): Status {
  const section = document.createElement("section");
  section.className = "status";

  const roundLabel = document.createElement("p");
  roundLabel.className = "status-round";

  const total = document.createElement("p");
  total.className = "status-total";

  section.append(roundLabel, total);
  root.append(section);

  let renderedKey: string | null = null;

  function update(state: GameState): void {
    const showRound = state.phase !== "idle" && state.phase !== "summary";
    const round = showRound ? `Round ${roundNumber(state)} of ${ROUNDS_PER_GAME}` : "";
    const totalText = showRound ? `Total ${Math.round(totalScore(state))} / ${MAX_GAME_SCORE}` : "";

    const key = `${round}|${totalText}`;
    if (key === renderedKey) return;
    renderedKey = key;

    roundLabel.textContent = round;
    roundLabel.hidden = !showRound;

    total.textContent = totalText;
    total.hidden = !showRound;
  }

  function destroy(): void {
    section.remove();
  }

  return { element: section, update, destroy };
}
