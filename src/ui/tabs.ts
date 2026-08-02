/**
 * The Play / Leaderboard tab bar (ADR 0012, ADR 0013).
 *
 * An ARIA tablist with **automatic activation**: selection follows focus. That is
 * the pattern the APG recommends when the panels are cheap, and both of these
 * are — one is already mounted, the other is a table that is rebuilt from a value
 * the shell already holds. Manual activation would cost a second keypress to see
 * anything.
 *
 * `aria-selected` is the only styling hook, so the visual state and the announced
 * state cannot disagree: there is no `is-active` class to forget to remove. The
 * selected tab carries weight and a bottom rule, never colour alone (SPEC §8).
 *
 * Roving tabindex: the whole bar is one Tab stop and the arrows move within it.
 * The bar is not the shell — it owns no notion of which panel exists, and it
 * never fires `onSelect` for a selection the shell pushed in with `setActive`.
 */

export type TabId = "play" | "leaderboard";

/**
 * How the player selected the tab. The shell moves focus for one and not the
 * other — see `shell.ts`, where the reason lives.
 */
export type TabSource = "pointer" | "keyboard";

export type TabsHandlers = {
  readonly onSelect: (tab: TabId, source: TabSource) => void;
};

export type Tabs = {
  readonly element: HTMLElement;
  /** Select without notifying — for a change the shell made itself. */
  setActive(tab: TabId): void;
  setVisible(visible: boolean): void;
  focusActive(): void;
  destroy(): void;
};

export const TAB_ORDER: readonly TabId[] = ["play", "leaderboard"];

/** The ids the shell has to stamp on the panels for `aria-controls` to resolve. */
export const PANEL_ID: Record<TabId, string> = {
  play: "panel-play",
  leaderboard: "panel-leaderboard",
};

export const TAB_ID: Record<TabId, string> = {
  play: "tab-play",
  leaderboard: "tab-leaderboard",
};

const LABEL: Record<TabId, string> = {
  play: "Play",
  leaderboard: "Leaderboard",
};

function makeTab(id: TabId): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tab";
  button.id = TAB_ID[id];
  button.setAttribute("role", "tab");
  button.setAttribute("aria-controls", PANEL_ID[id]);
  button.textContent = LABEL[id];
  return button;
}

export function createTabs(root: HTMLElement, handlers: TabsHandlers): Tabs {
  const list = document.createElement("div");
  list.className = "tabs";
  list.setAttribute("role", "tablist");
  list.setAttribute("aria-label", "Play or leaderboard");
  list.hidden = true;

  const buttons: Record<TabId, HTMLButtonElement> = {
    play: makeTab("play"),
    leaderboard: makeTab("leaderboard"),
  };
  for (const id of TAB_ORDER) list.append(buttons[id]);
  root.append(list);

  let active: TabId = "play";

  function render(): void {
    for (const id of TAB_ORDER) {
      const selected = id === active;
      buttons[id].setAttribute("aria-selected", selected ? "true" : "false");
      buttons[id].tabIndex = selected ? 0 : -1;
    }
  }
  render();

  function select(tab: TabId, source: TabSource): void {
    if (tab === active) return;
    active = tab;
    render();
    handlers.onSelect(tab, source);
  }

  function onClick(event: Event): void {
    const clicked = TAB_ORDER.find((id) => buttons[id] === event.target);
    if (clicked === undefined) return;
    select(clicked, "pointer");
  }

  function onKeyDown(event: KeyboardEvent): void {
    const index = TAB_ORDER.indexOf(active);
    const last = TAB_ORDER.length - 1;
    let next: TabId | undefined;
    switch (event.key) {
      case "ArrowRight":
        next = TAB_ORDER[index === last ? 0 : index + 1];
        break;
      case "ArrowLeft":
        next = TAB_ORDER[index <= 0 ? last : index - 1];
        break;
      case "Home":
        next = TAB_ORDER[0];
        break;
      case "End":
        next = TAB_ORDER[last];
        break;
      default:
        return;
    }
    if (next === undefined) return;
    // Home and End on an already-selected tab still belong to the tablist; the
    // page must not scroll and the arrows must not move the caret.
    event.preventDefault();
    select(next, "keyboard");
    buttons[next].focus();
  }

  list.addEventListener("click", onClick);
  list.addEventListener("keydown", onKeyDown);

  function setActive(tab: TabId): void {
    if (tab === active) return;
    active = tab;
    render();
  }

  function setVisible(visible: boolean): void {
    if (list.hidden === !visible) return;
    list.hidden = !visible;
  }

  function focusActive(): void {
    buttons[active].focus();
  }

  function destroy(): void {
    list.removeEventListener("click", onClick);
    list.removeEventListener("keydown", onKeyDown);
    list.remove();
  }

  return { element: list, setActive, setVisible, focusActive, destroy };
}
