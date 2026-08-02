import { beforeEach, describe, expect, it, vi } from "vitest";
import { oklch } from "@/color/types";
import type { GameState, RoundResult } from "@/domain/state";
import { initialState } from "@/domain/state";
import { createMenu } from "@/ui/menu";
import { FILL_COLOR_PROPERTY } from "@/ui/swatch";

function mount(): HTMLElement {
  const root = document.createElement("div");
  document.body.append(root);
  return root;
}

function must<T extends Element>(element: T | null): T {
  if (element === null) throw new Error("expected element to exist");
  return element;
}

function text(root: HTMLElement, selector: string): string {
  return must(root.querySelector(selector)).textContent ?? "";
}

const TARGET = oklch(0.6, 0.15, 210);
const GUESS = oklch(0.55, 0.11, 195);

function result(score: number, deltaE = 4.2): RoundResult {
  return { deltaE, score, target: TARGET, guess: GUESS };
}

function stateWith(patch: Partial<GameState>): GameState {
  return { ...initialState(), ...patch };
}

function summary(results: readonly RoundResult[]): GameState {
  return stateWith({ phase: "summary", results, roundIndex: results.length - 1 });
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("createMenu", () => {
  it("shows the title and Play when idle", () => {
    const root = mount();
    const menu = createMenu(root, { onStart: () => {}, onRestart: () => {} });
    menu.update(stateWith({ phase: "idle" }));

    expect(must(root.querySelector<HTMLElement>(".menu")).hidden).toBe(false);
    expect(text(root, ".menu-title")).toBe("Colors");
    expect(text(root, ".menu-action")).toBe("Play");
    expect(must(root.querySelector<HTMLElement>(".menu-breakdown")).hidden).toBe(true);
  });

  it("stays hidden while a round is being played", () => {
    const root = mount();
    const menu = createMenu(root, { onStart: () => {}, onRestart: () => {} });

    for (const phase of ["memorize", "picking", "reveal"] as const) {
      menu.update(stateWith({ phase }));
      expect(must(root.querySelector<HTMLElement>(".menu")).hidden).toBe(true);
    }
  });

  it("dispatches start from idle and restart from summary through one button", () => {
    const root = mount();
    const onStart = vi.fn();
    const onRestart = vi.fn();
    const menu = createMenu(root, { onStart, onRestart });
    const action = must(root.querySelector<HTMLButtonElement>(".menu-action"));

    menu.update(stateWith({ phase: "idle" }));
    action.click();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onRestart).not.toHaveBeenCalled();

    menu.update(summary([result(80)]));
    action.click();
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("breaks the summary down round by round, each with its own colors", () => {
    const root = mount();
    const menu = createMenu(root, { onStart: () => {}, onRestart: () => {} });

    // Distinct targets per round — the reason RoundResult carries its colors.
    const results: RoundResult[] = [
      { deltaE: 2, score: 96, target: oklch(0.7, 0.2, 30), guess: GUESS },
      { deltaE: 9, score: 61, target: oklch(0.4, 0.1, 300), guess: GUESS },
    ];
    menu.update(summary(results));

    const rounds = root.querySelectorAll<HTMLElement>(".breakdown-round");
    expect(rounds).toHaveLength(2);
    expect(text(root, ".menu-title")).toBe("157 of 500");

    const chips = root.querySelectorAll<HTMLElement>(".breakdown-chip");
    // Two chips per round: target then guess.
    expect(chips).toHaveLength(4);
    const first = must(chips[0] ?? null).style.getPropertyValue(FILL_COLOR_PROPERTY);
    const second = must(chips[2] ?? null).style.getPropertyValue(FILL_COLOR_PROPERTY);
    expect(first).not.toBe("");
    expect(first).not.toBe(second);
  });

  it("celebrates only when the total actually beats the stored best", () => {
    const root = mount();
    const menu = createMenu(root, { onStart: () => {}, onRestart: () => {} }, { bestScore: 200 });

    menu.update(summary([result(90), result(80)]));
    expect(text(root, ".menu-blurb")).toBe("Here is how each round went.");

    // A fresh game has to pass through a non-summary phase first.
    menu.update(stateWith({ phase: "picking" }));
    menu.update(summary([result(100), result(100), result(100)]));
    expect(text(root, ".menu-blurb")).toBe("A new best. Nicely remembered.");
  });

  it("keeps celebrating after the new best is stored", () => {
    const root = mount();
    const menu = createMenu(root, { onStart: () => {}, onRestart: () => {} }, { bestScore: 200 });
    const finished = summary([result(100), result(100), result(100)]);

    menu.update(finished);
    expect(text(root, ".menu-blurb")).toBe("A new best. Nicely remembered.");

    // The composition root saves the record and tells the menu, on the same
    // summary screen. The celebration must survive that.
    menu.setBestScore(300);
    menu.update(finished);

    expect(text(root, ".menu-blurb")).toBe("A new best. Nicely remembered.");
    expect(text(root, ".menu-best")).toBe("Best: 300");
  });

  it("hides the best line until there is a best", () => {
    const root = mount();
    const menu = createMenu(root, { onStart: () => {}, onRestart: () => {} });
    menu.update(stateWith({ phase: "idle" }));
    expect(must(root.querySelector<HTMLElement>(".menu-best")).hidden).toBe(true);

    menu.setBestScore(340);
    menu.update(stateWith({ phase: "idle" }));
    expect(must(root.querySelector<HTMLElement>(".menu-best")).hidden).toBe(false);
    expect(text(root, ".menu-best")).toBe("Best: 340");
  });

  it("re-renders after setBestScore even though nothing else changed", () => {
    const root = mount();
    const menu = createMenu(root, { onStart: () => {}, onRestart: () => {} });
    const idle = stateWith({ phase: "idle" });

    menu.update(idle);
    menu.setBestScore(120);
    // Same state object — only the dirty-key reset can make this repaint.
    menu.update(idle);
    expect(text(root, ".menu-best")).toBe("Best: 120");
  });

  it("offers a mount point for the name-claim block, above the primary action", () => {
    const root = mount();
    const menu = createMenu(root, { onStart: () => {}, onRestart: () => {} });
    const slot = must(root.querySelector<HTMLElement>(".menu-submit-slot"));

    expect(menu.submitSlot).toBe(slot);
    expect(must(root.querySelector(".menu")).contains(slot)).toBe(true);
    // The replay button stays the last thing on the screen.
    expect(slot.nextElementSibling?.className).toBe("menu-action");
  });

  it("removes itself and its listener on destroy", () => {
    const root = mount();
    const onStart = vi.fn();
    const menu = createMenu(root, { onStart, onRestart: () => {} });
    const action = must(root.querySelector<HTMLButtonElement>(".menu-action"));

    menu.destroy();
    action.click();

    expect(root.querySelector(".menu")).toBeNull();
    expect(onStart).not.toHaveBeenCalled();
  });
});
