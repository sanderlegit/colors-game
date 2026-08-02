import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameState, Phase } from "@/domain/state";
import { initialState } from "@/domain/state";
import { FIXTURE_LEADERBOARD } from "@/platform/api.fixture";
import type { PickerHandlers } from "@/ui/render";
import { createShell } from "@/ui/shell";
import type { TabId } from "@/ui/tabs";
import { PANEL_ID, TAB_ID } from "@/ui/tabs";

function must<T extends Element>(element: T | null): T {
  if (element === null) throw new Error("expected element to exist");
  return element;
}

function stateWith(patch: Partial<GameState>): GameState {
  return { ...initialState(), ...patch };
}

/** happy-dom has no canvas, so the picker is a stub here as it is in render.test.ts. */
const stubPicker = (_slot: HTMLElement, _handlers: PickerHandlers) => ({
  update: () => {},
  destroy: () => {},
});

function setup() {
  const root = document.createElement("div");
  document.body.append(root);

  const onTabSelect = vi.fn<(tab: TabId) => void>();
  const onRetry = vi.fn();
  const onClaim = vi.fn<(name: string) => void>();
  const onForget = vi.fn();

  const shell = createShell(root, {
    game: { dispatch: () => {}, createPicker: stubPicker, nextSeed: () => 1 },
    leaderboard: {
      onRetry,
      onExpand: vi.fn(),
      onShare: vi.fn(),
      onFilter: vi.fn(),
      onClearFilter: vi.fn(),
      onPlaySeed: vi.fn(),
    },
    identity: { onClaim, onForget },
    onTabSelect,
  });

  return {
    root,
    shell,
    onTabSelect,
    onRetry,
    tabs: must(root.querySelector<HTMLElement>(".tabs")),
    play: must(root.querySelector<HTMLButtonElement>(`#${TAB_ID.play}`)),
    boardTab: must(root.querySelector<HTMLButtonElement>(`#${TAB_ID.leaderboard}`)),
    game: must(root.querySelector<HTMLElement>(".game")),
    board: must(root.querySelector<HTMLElement>(".leaderboard")),
  };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("createShell", () => {
  it("makes .game itself the Play panel, with no wrapper around it", () => {
    const { root, game, board } = setup();

    expect(game.parentElement).toBe(root);
    expect(game.id).toBe(PANEL_ID.play);
    expect(game.getAttribute("role")).toBe("tabpanel");
    expect(game.getAttribute("aria-labelledby")).toBe(TAB_ID.play);
    expect(board.id).toBe(PANEL_ID.leaderboard);
    expect(board.getAttribute("aria-labelledby")).toBe(TAB_ID.leaderboard);
  });

  it("shows the tab bar only between games (ADR 0013)", () => {
    const { shell, tabs } = setup();
    const expected: Record<Phase, boolean> = {
      idle: true,
      memorize: false,
      picking: false,
      reveal: false,
      summary: true,
    };
    for (const phase of Object.keys(expected) as Phase[]) {
      shell.update(stateWith({ phase }));
      expect(tabs.hidden, phase).toBe(!expected[phase]);
    }
  });

  it("swaps the panels when the player picks a tab", () => {
    const { shell, boardTab, play, game, board, onTabSelect } = setup();
    shell.update(stateWith({ phase: "idle" }));

    boardTab.click();
    expect(game.hidden).toBe(true);
    expect(board.hidden).toBe(false);
    expect(onTabSelect).toHaveBeenLastCalledWith("leaderboard");

    play.click();
    expect(game.hidden).toBe(false);
    expect(board.hidden).toBe(true);
    expect(onTabSelect).toHaveBeenLastCalledWith("play");
  });

  it("moves focus into the panel a click revealed", () => {
    const { shell, boardTab, board } = setup();
    shell.update(stateWith({ phase: "idle" }));

    boardTab.click();

    expect(document.activeElement).toBe(board);
  });

  it("leaves focus in the tablist for the arrow keys, which need it there", () => {
    const { shell, tabs, boardTab } = setup();
    shell.update(stateWith({ phase: "idle" }));

    tabs.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
    );

    expect(document.activeElement).toBe(boardTab);
  });

  it("forces Play back when a round starts, without stealing focus", () => {
    const { shell, boardTab, play, game, board } = setup();
    shell.update(stateWith({ phase: "idle" }));
    boardTab.click();

    const before = document.activeElement;
    shell.update(stateWith({ phase: "memorize" }));

    // No gesture happened, so nothing may move focus (ADR 0013).
    expect(document.activeElement).toBe(before);
    expect(game.hidden).toBe(false);
    expect(board.hidden).toBe(true);
    expect(play.getAttribute("aria-selected")).toBe("true");
  });

  it("returns to Play on Escape, wherever focus happens to be", () => {
    const { shell, boardTab, play, game, board } = setup();
    shell.update(stateWith({ phase: "idle" }));
    boardTab.click();

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );

    expect(game.hidden).toBe(false);
    expect(board.hidden).toBe(true);
    expect(document.activeElement).toBe(play);
  });

  it("ignores Escape while Play is already the open tab", () => {
    const { shell, game } = setup();
    shell.update(stateWith({ phase: "picking" }));

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );

    expect(game.hidden).toBe(false);
  });

  it("pushes async data straight into the panels, with no frame in between", () => {
    const { root, shell } = setup();
    shell.update(stateWith({ phase: "summary" }));

    shell.setLeaderboard({ status: "ready", entries: FIXTURE_LEADERBOARD });
    shell.setIdentity({ status: "named", name: "ada" });
    shell.setSubmission({ status: "done", name: "ada", requested: null, rank: 3 });

    expect(root.querySelectorAll(".leaderboard-row")).toHaveLength(3);
    expect(must(root.querySelector(".identity-named")).textContent).toContain("ada");
    expect(must(root.querySelector(".identity-status")).textContent).toContain("3rd");
  });

  it("keeps setBestScore on its existing contract: repaint on the next frame", () => {
    const { root, shell } = setup();
    const summary = stateWith({ phase: "summary" });
    shell.update(summary);

    shell.setBestScore(412);
    shell.update(summary);

    expect(must(root.querySelector(".menu-best")).textContent).toBe("Best: 412");
  });

  it("mounts the identity block inside the menu, not beside it", () => {
    const { root } = setup();
    const menu = must(root.querySelector(".menu"));
    expect(menu.contains(must(root.querySelector(".identity")))).toBe(true);
  });

  it("tears everything down, including the document-level Escape listener", () => {
    const { root, shell } = setup();
    shell.destroy();

    expect(root.querySelector(".game")).toBeNull();
    expect(root.querySelector(".tabs")).toBeNull();
    expect(root.querySelector(".leaderboard")).toBeNull();
    // Would throw on a detached element if the listener were still attached.
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
});
