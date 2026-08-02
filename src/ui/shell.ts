/**
 * The shell: which screen is on top (ADR 0012).
 *
 * It owns exactly one variable — `activeTab` — and it sits *above*
 * `createGameView`, which keeps its own job unchanged and knows nothing about
 * tabs. Everything asynchronous arrives through pushed setters
 * (`setLeaderboard`, `setIdentity`, `setSubmission`) alongside the existing
 * `setBestScore`, so `src/ui/**` stays synchronous and every one of these is
 * testable by calling it with a literal.
 *
 * `.game` **is** the Play tabpanel. Wrapping it would need `display: contents`,
 * which has a history of being dropped from the accessibility tree, and it would
 * perturb the grid the e2e geometry assertions are written against.
 *
 * Per ADR 0013 the tab bar exists only between games. Entering a non-menu phase
 * forces Play back unconditionally and **without moving focus**, because no
 * gesture happened — yanking focus on a timer expiry is the kind of thing that
 * loses a keyboard user their place mid-round.
 */

import { isMenuVisible } from "@/domain/selectors";
import type { GameState } from "@/domain/state";
import type { IdentityHandlers, PlayerIdentity, SubmitState } from "@/ui/identity";
import { createIdentity } from "@/ui/identity";
import type { AttemptView, LeaderboardHandlers, LeaderboardView } from "@/ui/leaderboard";
import { createLeaderboard } from "@/ui/leaderboard";
import type { GameViewDeps } from "@/ui/render";
import { createGameView } from "@/ui/render";
import type { TabId, TabSource } from "@/ui/tabs";
import { createTabs, PANEL_ID, TAB_ID } from "@/ui/tabs";

export type ShellDeps = {
  readonly game: GameViewDeps;
  readonly leaderboard: LeaderboardHandlers;
  readonly identity: IdentityHandlers;
  /** A tab the *player* opened, so the composition root can go and fetch for it. */
  readonly onTabSelect: (tab: TabId) => void;
};

export type Shell = {
  update(state: GameState): void;
  setBestScore(score: number): void;
  setLeaderboard(view: LeaderboardView): void;
  setAttempt(gameId: string, view: AttemptView): void;
  /**
   * Switch tabs without moving focus, for a change the composition root made —
   * a `?board=` deep link opening the board. It does not fire `onTabSelect`: the
   * caller is already doing the fetch that a player-driven switch would trigger.
   */
  selectTab(tab: TabId): void;
  setIdentity(identity: PlayerIdentity): void;
  setSubmission(submission: SubmitState): void;
  destroy(): void;
};

function asPanel(element: HTMLElement, tab: TabId): void {
  element.id = PANEL_ID[tab];
  element.setAttribute("role", "tabpanel");
  element.setAttribute("aria-labelledby", TAB_ID[tab]);
  // Not a Tab stop of its own; a target for programmatic focus and for the Tab
  // key leaving the tablist.
  element.tabIndex = -1;
}

export function createShell(root: HTMLElement, deps: ShellDeps): Shell {
  const tabs = createTabs(root, { onSelect: onTabSelected });
  const view = createGameView(root, deps.game);
  const board = createLeaderboard(root, deps.leaderboard);
  const identity = createIdentity(view.submitSlot, deps.identity);

  asPanel(view.element, "play");
  asPanel(board.element, "leaderboard");

  let activeTab: TabId = "play";

  function applyTab(tab: TabId): void {
    activeTab = tab;
    tabs.setActive(tab);
    view.element.hidden = tab !== "play";
    board.element.hidden = tab !== "leaderboard";
  }

  function onTabSelected(tab: TabId, source: TabSource): void {
    applyTab(tab);
    // The arrow keys are automatic activation: focus is *in* the tablist and has
    // to stay there, or the next arrow press has nothing to move. A pointer
    // activation leaves focus nowhere useful, so the revealed panel takes it.
    if (source === "pointer") panelOf(tab).focus();
    deps.onTabSelect(tab);
  }

  function panelOf(tab: TabId): HTMLElement {
    return tab === "play" ? view.element : board.element;
  }

  /**
   * Escape leaves the board. It is on the document because the panel is full of
   * non-focusable text: after a tap on a row, the keydown's target is the body,
   * and a listener on the panel would never see it.
   */
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || activeTab !== "leaderboard") return;
    applyTab("play");
    tabs.focusActive();
  }
  document.addEventListener("keydown", onKeyDown);

  function update(state: GameState): void {
    const between = isMenuVisible(state);
    if (!between && activeTab !== "play") applyTab("play");
    tabs.setVisible(between);
    view.update(state);
    identity.update(state);
  }

  function destroy(): void {
    document.removeEventListener("keydown", onKeyDown);
    identity.destroy();
    board.destroy();
    view.destroy();
    tabs.destroy();
  }

  return {
    update,
    setBestScore: view.setBestScore,
    setLeaderboard: board.setView,
    setAttempt: board.setAttempt,
    selectTab: applyTab,
    setIdentity: identity.setIdentity,
    setSubmission: identity.setSubmission,
    destroy,
  };
}
