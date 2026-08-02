/**
 * The board (ADR 0012).
 *
 * This is the one component with no `update(state)`: nothing it shows is derived
 * from `GameState`, so it is not in `render.ts`'s `parts` array and never sees
 * the frame loop. It is driven entirely by `setView`, which the composition root
 * calls when a request settles. A panel that repaints on a tab visit rather than
 * sixty times a second is the whole point of putting tab state in the shell.
 *
 * The view is a closed union, so "empty" cannot be confused with "not loaded
 * yet": an empty board is `ready` with no rows, because a successful response
 * saying nobody has played is not an error and must not offer a retry.
 *
 * A real `<table>` rather than a grid of divs — the rows are tabular data, and
 * the row/column semantics are what make it navigable with a screen reader.
 */

import type { LeaderboardEntry } from "@/platform/api";

export type LeaderboardView =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly entries: readonly LeaderboardEntry[] };

export type LeaderboardHandlers = {
  readonly onRetry: () => void;
};

export type LeaderboardOptions = {
  /**
   * Hard cap on rendered rows. The server already limits the board, but the
   * decoder does not bound the array — a response that ignores its own limit
   * would otherwise turn into that many DOM nodes.
   */
  readonly maxRows?: number;
};

export type Leaderboard = {
  readonly element: HTMLElement;
  setView(view: LeaderboardView): void;
  destroy(): void;
};

const DEFAULT_MAX_ROWS = 100;

const LOADING = "Loading the board…";
const EMPTY = "Nobody has finished a game yet. Play one and the board is yours.";

function headerCell(label: string, className: string): HTMLTableCellElement {
  const cell = document.createElement("th");
  cell.scope = "col";
  cell.className = className;
  cell.textContent = label;
  return cell;
}

/**
 * `aria-current` carries "this is you" to assistive tech and doubles as the
 * styling hook; the visually-hidden suffix carries it to anyone reading the row
 * as text. The tint is the third channel, never the only one (SPEC §8).
 */
function makeRow(entry: LeaderboardEntry): HTMLTableRowElement {
  const row = document.createElement("tr");
  row.className = "leaderboard-row";

  const rank = document.createElement("td");
  rank.className = "leaderboard-rank";
  rank.textContent = String(entry.rank);

  const name = document.createElement("th");
  name.scope = "row";
  name.className = "leaderboard-name";
  name.textContent = entry.name;

  const score = document.createElement("td");
  score.className = "leaderboard-score";
  score.textContent = String(entry.score);

  if (entry.isYou) {
    row.setAttribute("aria-current", "true");
    const you = document.createElement("span");
    you.className = "visually-hidden";
    you.textContent = " (you)";
    name.append(you);
  }

  row.append(rank, name, score);
  return row;
}

export function createLeaderboard(
  root: HTMLElement,
  handlers: LeaderboardHandlers,
  options: LeaderboardOptions = {},
): Leaderboard {
  const maxRows = Math.max(0, Math.trunc(options.maxRows ?? DEFAULT_MAX_ROWS));

  const section = document.createElement("section");
  section.className = "leaderboard";
  section.hidden = true;

  const heading = document.createElement("h2");
  heading.className = "leaderboard-title";
  heading.textContent = "Leaderboard";

  const table = document.createElement("table");
  table.className = "leaderboard-table";
  table.hidden = true;

  const caption = document.createElement("caption");
  caption.className = "leaderboard-caption";
  caption.textContent = "Best game score per player";

  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  headRow.append(
    headerCell("Rank", "leaderboard-rank"),
    headerCell("Player", "leaderboard-name"),
    headerCell("Score", "leaderboard-score"),
  );
  head.append(headRow);

  const body = document.createElement("tbody");
  body.className = "leaderboard-body";
  table.append(caption, head, body);

  // Never hidden, so a message that replaces another is announced. A live region
  // that is toggled into existence is one screen readers are entitled to miss.
  const status = document.createElement("p");
  status.className = "leaderboard-status";
  status.setAttribute("role", "status");

  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "leaderboard-retry";
  retry.textContent = "Try again";
  retry.hidden = true;

  section.append(heading, status, retry, table);
  root.append(section);

  function onRetry(): void {
    handlers.onRetry();
  }
  retry.addEventListener("click", onRetry);

  function setView(view: LeaderboardView): void {
    const entries = view.status === "ready" ? view.entries.slice(0, maxRows) : [];

    body.replaceChildren(...entries.map(makeRow));
    table.hidden = entries.length === 0;
    retry.hidden = view.status !== "error";

    if (view.status === "loading") status.textContent = LOADING;
    else if (view.status === "error") status.textContent = view.message;
    else status.textContent = entries.length === 0 ? EMPTY : "";
  }

  function destroy(): void {
    retry.removeEventListener("click", onRetry);
    section.remove();
  }

  return { element: section, setView, destroy };
}
