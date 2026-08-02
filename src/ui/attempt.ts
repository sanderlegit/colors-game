/**
 * The panel a leaderboard row expands into (ADR 0024): a player's game replayed
 * round by round, with a close, a copy-link and an "only this seed" action.
 *
 * A dumb view, like the board it lives in (ADR 0012): it renders from a pushed
 * `AttemptCardView` and owns no listeners and no fetching. Its buttons carry
 * stable classes and the board catches their clicks by delegation, so a row can
 * be rebuilt with `replaceChildren` without leaving a listener behind.
 *
 * The breakdown itself is `fillBreakdown` — the same renderer the summary screen
 * uses, so a game looks the same whether you just played it or found it on the
 * board.
 */

import type { Attempt } from "@/platform/api";
import { fillBreakdown } from "@/ui/breakdown";

export type AttemptCardView =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly attempt: Attempt };

export type AttemptCard = {
  readonly element: HTMLElement;
  setView(view: AttemptCardView): void;
};

const LOADING = "Replaying this game…";

/** SPEC §6: max game score is rounds × 100; the panel names the total out of it. */
const MAX_GAME_SCORE = 500;

export function createAttemptCard(): AttemptCard {
  const card = document.createElement("div");
  card.className = "attempt";

  const status = document.createElement("p");
  status.className = "attempt-status";
  status.setAttribute("role", "status");

  const total = document.createElement("p");
  total.className = "attempt-total";
  total.hidden = true;

  const breakdown = document.createElement("ol");
  breakdown.className = "breakdown attempt-breakdown";

  const actions = document.createElement("div");
  actions.className = "attempt-actions";

  const close = button("attempt-close", "Close");
  close.setAttribute("aria-label", "Close this breakdown");
  const share = button("attempt-share", "Copy link");
  const filter = button("attempt-filter", "Only this seed");
  actions.append(close, share, filter);

  card.append(status, total, breakdown, actions);

  function setView(view: AttemptCardView): void {
    if (view.status === "ready") {
      status.textContent = "";
      status.hidden = true;
      total.textContent = `Total ${view.attempt.totalScore} of ${MAX_GAME_SCORE}`;
      total.hidden = false;
      fillBreakdown(breakdown, view.attempt.rounds);
      breakdown.hidden = false;
      return;
    }
    // Loading or error: no breakdown, just the live-region line. The actions stay
    // visible so a slow replay does not hide the close button behind a spinner.
    status.hidden = false;
    status.textContent = view.status === "loading" ? LOADING : view.message;
    total.hidden = true;
    breakdown.hidden = true;
    breakdown.replaceChildren();
  }

  return { element: card, setView };
}

function button(className: string, label: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  return element;
}
