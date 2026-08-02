/**
 * The board (ADR 0012, expanded by ADR 0026).
 *
 * Still driven entirely by `setView` — nothing it shows comes from `GameState`,
 * so it is not in the frame loop. Two things are new:
 *
 * - **Rows expand into an attempt.** A row is a toggle; opening it reveals a
 *   detail row beneath with that game's replayed breakdown, pushing the rows
 *   below it down. Any number can be open at once. The panel is fetched lazily —
 *   the component stays synchronous (ADR 0012), so it emits `onExpand(gameId)`
 *   and the composition root pushes the result back through `setAttempt`, exactly
 *   as the board itself is pushed through `setView`.
 * - **The board can be filtered to one seed.** A `ready` view may carry a
 *   `filter`, which turns the caption into that seed's board, shows a back
 *   button (top-left) to leave it, and a banner listing the seed's target
 *   colours beside a button to play the set. The colours live only in a replayed
 *   attempt (ADR 0026 — a seed never leaves the server), so they arrive out of
 *   band through `setFilterColors`, the same push shape as `setAttempt`.
 *
 * All click behaviour is one delegated listener on the section, so a row can be
 * rebuilt with `replaceChildren` without a listener surviving on a dead node.
 * The interactive control that carries the open state to assistive tech is a
 * real `<button>` in the name cell (`aria-expanded` + `aria-controls`); a pointer
 * anywhere on the row toggles too, because the whole row reads as the target.
 *
 * A real `<table>` still, for the same reason: the rows are tabular data and the
 * row/column semantics are what make them navigable with a screen reader.
 */

import { oklchToCss } from "@/color/format";
import type { Oklch } from "@/color/types";
import type { LeaderboardEntry } from "@/platform/api";
import type { AttemptCard, AttemptCardView } from "@/ui/attempt";
import { createAttemptCard } from "@/ui/attempt";
import { setFillColor } from "@/ui/swatch";

/** Which seed the board is filtered to, and whose game anchors it. */
export type LeaderboardFilter = {
  readonly gameId: string;
  /** Whose game anchored the filter. Absent when a deep link supplied only an id. */
  readonly name?: string;
};

export type LeaderboardView =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | {
      readonly status: "ready";
      readonly entries: readonly LeaderboardEntry[];
      readonly filter?: LeaderboardFilter;
    };

/** The push half of an expanded row, mirroring `LeaderboardView`'s shape. */
export type AttemptView = AttemptCardView;

export type LeaderboardHandlers = {
  readonly onRetry: () => void;
  /** A row was opened: go fetch its attempt and push it back with `setAttempt`. */
  readonly onExpand: (gameId: string) => void;
  /** Copy a shareable link to this game's seed challenge. */
  readonly onShare: (gameId: string) => void;
  /** Filter the board to this game's seed. */
  readonly onFilter: (gameId: string, name: string) => void;
  /** Leave a filtered board for the global one. */
  readonly onClearFilter: () => void;
  /** Play a ranked challenge on the filtered seed. */
  readonly onPlaySeed: (gameId: string) => void;
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
  /** Push an expanded row's attempt, once its fetch settles. */
  setAttempt(gameId: string, view: AttemptView): void;
  /** Push the filtered seed's target colours into the banner, once fetched. */
  setFilterColors(gameId: string, colors: readonly Oklch[]): void;
  destroy(): void;
};

const DEFAULT_MAX_ROWS = 100;

const LOADING = "Loading the board…";
const EMPTY = "Nobody has finished a game yet. Play one and the board is yours.";
const EMPTY_SEED = "Nobody has played this seed yet. Be the first.";
const CAPTION_GLOBAL = "Best game score per player";
const CAPTION_SEED = "Best score per player on this seed";

type RowRefs = {
  readonly gameId: string;
  readonly name: string;
  readonly detail: HTMLTableRowElement;
  readonly toggle: HTMLButtonElement;
  readonly card: AttemptCard;
  open: boolean;
  lastView: AttemptView | null;
};

function headerCell(label: string, className: string): HTMLTableCellElement {
  const cell = document.createElement("th");
  cell.scope = "col";
  cell.className = className;
  cell.textContent = label;
  return cell;
}

function hidden(text: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "visually-hidden";
  span.textContent = text;
  return span;
}

/** One target colour of the filtered seed, painted through `--fill-color`. */
function seedSwatch(color: Oklch): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "leaderboard-seed-color";
  setFillColor(item, oklchToCss(color));
  return item;
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

  const status = document.createElement("p");
  status.className = "leaderboard-status";
  status.setAttribute("role", "status");

  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "leaderboard-retry";
  retry.textContent = "Try again";
  retry.hidden = true;

  // Top-left, and shown only for a filtered board: leaves the seed's board for
  // the global one. This is the old "Show everyone" control, now a back button.
  const back = document.createElement("button");
  back.type = "button";
  back.className = "leaderboard-back";
  back.hidden = true;
  const backCaret = document.createElement("span");
  backCaret.className = "leaderboard-back-caret";
  backCaret.setAttribute("aria-hidden", "true");
  const backText = document.createElement("span");
  backText.textContent = "Back";
  back.append(backCaret, backText, hidden(" to the full board"));

  // Shown only for a filtered board. In place of a text label it lists the
  // seed's target colours (pushed in by `setFilterColors`), so the banner shows
  // *which* colours the set is, beside a button to play them.
  const banner = document.createElement("div");
  banner.className = "leaderboard-filter";
  banner.hidden = true;
  const seedColors = document.createElement("ul");
  seedColors.className = "leaderboard-seed-colors";
  seedColors.setAttribute("aria-label", "This seed's colours");
  const playSeed = document.createElement("button");
  playSeed.type = "button";
  playSeed.className = "leaderboard-play-seed";
  playSeed.textContent = "Play set";
  banner.append(seedColors, playSeed);

  const table = document.createElement("table");
  table.className = "leaderboard-table";
  table.hidden = true;
  const caption = document.createElement("caption");
  caption.className = "leaderboard-caption";
  caption.textContent = CAPTION_GLOBAL;
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

  section.append(back, heading, status, retry, banner, table);
  root.append(section);

  const byId = new Map<string, RowRefs>();
  const elToRefs = new WeakMap<Element, RowRefs>();
  let filter: LeaderboardFilter | null = null;

  function expand(refs: RowRefs): void {
    refs.open = true;
    refs.toggle.setAttribute("aria-expanded", "true");
    refs.detail.hidden = false;
    // Force layout off the just-shown row so the class change animates from the
    // collapsed baseline rather than snapping. A layout read on a click is fine;
    // the ban on reading layout is about the frame loop, which this is not.
    void refs.detail.offsetHeight;
    refs.detail.classList.add("is-open");
    if (refs.lastView !== null && refs.lastView.status === "ready") {
      refs.card.setView(refs.lastView);
      return;
    }
    refs.card.setView({ status: "loading" });
    handlers.onExpand(refs.gameId);
  }

  function collapse(refs: RowRefs): void {
    refs.open = false;
    refs.toggle.setAttribute("aria-expanded", "false");
    refs.detail.classList.remove("is-open");
    refs.detail.hidden = true;
  }

  function makeRow(entry: LeaderboardEntry): readonly [HTMLTableRowElement, HTMLTableRowElement] {
    const detailId = `attempt-${entry.gameId}`;

    const row = document.createElement("tr");
    row.className = "leaderboard-row";

    const rank = document.createElement("td");
    rank.className = "leaderboard-rank";
    rank.textContent = String(entry.rank);

    const name = document.createElement("th");
    name.scope = "row";
    name.className = "leaderboard-name";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "leaderboard-expander";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", detailId);
    const caret = document.createElement("span");
    caret.className = "leaderboard-caret";
    caret.setAttribute("aria-hidden", "true");
    const nameText = document.createElement("span");
    nameText.className = "leaderboard-name-text";
    nameText.textContent = entry.name;
    toggle.append(caret, nameText);
    if (entry.isYou) toggle.append(hidden(" (you)"));
    toggle.append(hidden(" — show round breakdown"));
    name.append(toggle);

    const score = document.createElement("td");
    score.className = "leaderboard-score";
    score.textContent = String(entry.score);

    if (entry.isYou) row.setAttribute("aria-current", "true");
    row.append(rank, name, score);

    const detail = document.createElement("tr");
    detail.className = "leaderboard-detail";
    detail.id = detailId;
    detail.hidden = true;
    const cell = document.createElement("td");
    cell.colSpan = 3;
    const wrap = document.createElement("div");
    wrap.className = "attempt-wrap";
    const card = createAttemptCard();
    wrap.append(card.element);
    cell.append(wrap);
    detail.append(cell);

    const refs: RowRefs = {
      gameId: entry.gameId,
      name: entry.name,
      detail,
      toggle,
      card,
      open: false,
      lastView: null,
    };
    byId.set(entry.gameId, refs);
    elToRefs.set(row, refs);
    elToRefs.set(detail, refs);
    return [row, detail];
  }

  function onClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest(".leaderboard-retry") !== null) {
      handlers.onRetry();
      return;
    }
    if (target.closest(".leaderboard-back") !== null) {
      handlers.onClearFilter();
      return;
    }
    if (target.closest(".leaderboard-play-seed") !== null) {
      if (filter !== null) handlers.onPlaySeed(filter.gameId);
      return;
    }

    const detail = target.closest(".leaderboard-detail");
    if (detail !== null) {
      const refs = elToRefs.get(detail);
      if (refs === undefined) return;
      if (target.closest(".attempt-close") !== null) collapse(refs);
      else if (target.closest(".attempt-share") !== null) handlers.onShare(refs.gameId);
      else if (target.closest(".attempt-filter") !== null)
        handlers.onFilter(refs.gameId, refs.name);
      // A click on the panel body itself does nothing — only the row toggles.
      return;
    }

    const row = target.closest(".leaderboard-row");
    if (row === null) return;
    const refs = elToRefs.get(row);
    if (refs === undefined) return;
    if (refs.open) collapse(refs);
    else expand(refs);
  }
  section.addEventListener("click", onClick);

  function setView(view: LeaderboardView): void {
    // A new board is a new set of rows: the open state and every cached attempt
    // belong to the rows being replaced, so they go with them.
    byId.clear();
    filter = view.status === "ready" ? (view.filter ?? null) : null;

    const entries = view.status === "ready" ? view.entries.slice(0, maxRows) : [];
    body.replaceChildren(...entries.flatMap((entry) => makeRow(entry)));
    table.hidden = entries.length === 0;
    retry.hidden = view.status !== "error";
    banner.hidden = filter === null;
    back.hidden = filter === null;
    caption.textContent = filter === null ? CAPTION_GLOBAL : CAPTION_SEED;
    // A new board is new colours: drop the previous filter's swatches so stale
    // ones never outlive their seed. `setFilterColors` fills them back in.
    seedColors.replaceChildren();

    if (view.status === "loading") status.textContent = LOADING;
    else if (view.status === "error") status.textContent = view.message;
    else if (entries.length > 0) status.textContent = "";
    else status.textContent = filter === null ? EMPTY : EMPTY_SEED;
  }

  function setAttempt(gameId: string, view: AttemptView): void {
    const refs = byId.get(gameId);
    if (refs === undefined) return;
    refs.lastView = view;
    if (refs.open) refs.card.setView(view);
  }

  function setFilterColors(gameId: string, colors: readonly Oklch[]): void {
    // The fetch that produced these was fired for a filter that may since have
    // been cleared or changed. Only render if they still match the board on show.
    if (filter === null || filter.gameId !== gameId) return;
    seedColors.replaceChildren(...colors.map(seedSwatch));
  }

  function destroy(): void {
    section.removeEventListener("click", onClick);
    section.remove();
  }

  return { element: section, setView, setAttempt, setFilterColors, destroy };
}
