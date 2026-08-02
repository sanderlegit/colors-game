import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TabId, TabSource } from "@/ui/tabs";
import { createTabs, PANEL_ID, TAB_ID } from "@/ui/tabs";

function must<T extends Element>(element: T | null): T {
  if (element === null) throw new Error("expected element to exist");
  return element;
}

function setup() {
  const root = document.createElement("div");
  document.body.append(root);
  const onSelect = vi.fn<(tab: TabId, source: TabSource) => void>();
  const tabs = createTabs(root, { onSelect });

  const play = must(root.querySelector<HTMLButtonElement>(`#${TAB_ID.play}`));
  const board = must(root.querySelector<HTMLButtonElement>(`#${TAB_ID.leaderboard}`));
  return { root, tabs, onSelect, play, board };
}

function press(list: Element, key: string): void {
  list.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("createTabs", () => {
  it("is a tablist of two tabs, each pointing at its panel", () => {
    const { root, play, board } = setup();

    expect(must(root.querySelector(".tabs")).getAttribute("role")).toBe("tablist");
    expect(play.getAttribute("role")).toBe("tab");
    expect(board.getAttribute("role")).toBe("tab");
    expect(play.getAttribute("aria-controls")).toBe(PANEL_ID.play);
    expect(board.getAttribute("aria-controls")).toBe(PANEL_ID.leaderboard);
  });

  it("starts on Play with a roving tabindex", () => {
    const { play, board } = setup();

    expect(play.getAttribute("aria-selected")).toBe("true");
    expect(board.getAttribute("aria-selected")).toBe("false");
    // One Tab stop for the whole bar; the arrows move within it.
    expect(play.tabIndex).toBe(0);
    expect(board.tabIndex).toBe(-1);
  });

  it("selects on click and reports where the gesture came from", () => {
    const { onSelect, play, board } = setup();

    board.click();

    expect(onSelect).toHaveBeenCalledWith("leaderboard", "pointer");
    expect(board.getAttribute("aria-selected")).toBe("true");
    expect(board.tabIndex).toBe(0);
    expect(play.tabIndex).toBe(-1);
  });

  it("does not re-fire for a tab that is already selected", () => {
    const { onSelect, play } = setup();
    play.click();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("moves selection with the arrows and wraps at both ends", () => {
    const { root, onSelect, play, board } = setup();
    const list = must(root.querySelector(".tabs"));

    press(list, "ArrowRight");
    expect(onSelect).toHaveBeenLastCalledWith("leaderboard", "keyboard");
    expect(document.activeElement).toBe(board);

    // Wraps forward...
    press(list, "ArrowRight");
    expect(onSelect).toHaveBeenLastCalledWith("play", "keyboard");
    expect(document.activeElement).toBe(play);

    // ...and backward.
    press(list, "ArrowLeft");
    expect(onSelect).toHaveBeenLastCalledWith("leaderboard", "keyboard");
    expect(board.getAttribute("aria-selected")).toBe("true");
  });

  it("jumps to the ends with Home and End", () => {
    const { root, onSelect, play, board } = setup();
    const list = must(root.querySelector(".tabs"));

    press(list, "End");
    expect(onSelect).toHaveBeenLastCalledWith("leaderboard", "keyboard");
    expect(board.getAttribute("aria-selected")).toBe("true");

    press(list, "Home");
    expect(onSelect).toHaveBeenLastCalledWith("play", "keyboard");
    expect(play.getAttribute("aria-selected")).toBe("true");
  });

  it("leaves keys it does not own to the page", () => {
    const { root, onSelect } = setup();
    const list = must(root.querySelector(".tabs"));

    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    list.dispatchEvent(event);

    expect(onSelect).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("takes a pushed selection without calling back", () => {
    const { tabs, onSelect, board } = setup();

    tabs.setActive("leaderboard");

    expect(board.getAttribute("aria-selected")).toBe("true");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("hides and shows the whole bar (ADR 0013)", () => {
    const { root, tabs } = setup();
    const list = must(root.querySelector<HTMLElement>(".tabs"));

    expect(list.hidden).toBe(true);
    tabs.setVisible(true);
    expect(list.hidden).toBe(false);
    tabs.setVisible(false);
    expect(list.hidden).toBe(true);
  });

  it("focuses whichever tab is selected", () => {
    const { tabs, board } = setup();
    tabs.setActive("leaderboard");
    tabs.focusActive();
    expect(document.activeElement).toBe(board);
  });

  it("removes itself and its listeners on destroy", () => {
    const { root, tabs, onSelect, board } = setup();
    tabs.destroy();
    board.click();

    expect(root.querySelector(".tabs")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
