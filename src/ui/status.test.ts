import { describe, expect, it } from "vitest";
import { oklch } from "@/color/types";
import type { GameState, RoundResult } from "@/domain/state";
import { initialState } from "@/domain/state";
import { createStatus } from "@/ui/status";

const GREY = oklch(0.5, 0, 0);
function scored(...scores: number[]): readonly RoundResult[] {
  return scores.map((score) => ({ deltaE: 0, score, target: GREY, guess: GREY }));
}

function stateWith(patch: Partial<GameState>): GameState {
  return { ...initialState(), ...patch };
}

function must<T extends Element>(element: T | null): T {
  if (element === null) throw new Error("expected element to exist");
  return element;
}

function mount(): HTMLElement {
  const root = document.createElement("div");
  document.body.append(root);
  return root;
}

describe("createStatus", () => {
  it("shows a 1-based round counter", () => {
    const root = mount();
    const status = createStatus(root);
    const label = must(root.querySelector<HTMLElement>(".status-round"));

    status.update(stateWith({ phase: "picking", roundIndex: 1 }));
    expect(label.textContent).toBe("Round 2 of 5");

    status.update(stateWith({ phase: "idle" }));
    expect(label.hidden).toBe(true);
  });

  it("shows the running total beside the round counter", () => {
    const root = mount();
    const status = createStatus(root);
    const total = must(root.querySelector<HTMLElement>(".status-total"));

    status.update(stateWith({ phase: "reveal", roundIndex: 1, results: scored(90, 55) }));
    expect(total.textContent).toBe("Total 145 / 500");

    status.update(stateWith({ phase: "idle" }));
    expect(total.hidden).toBe(true);
  });

  it("is hidden between games (idle and summary)", () => {
    const root = mount();
    const status = createStatus(root);
    const round = must(root.querySelector<HTMLElement>(".status-round"));
    const total = must(root.querySelector<HTMLElement>(".status-total"));

    status.update(stateWith({ phase: "summary", results: scored(90) }));
    expect(round.hidden).toBe(true);
    expect(total.hidden).toBe(true);
  });

  it("bails when nothing it cares about changed", () => {
    const root = mount();
    const status = createStatus(root);
    const round = must(root.querySelector<HTMLElement>(".status-round"));

    status.update(stateWith({ phase: "picking", roundIndex: 0 }));
    expect(round.textContent).toBe("Round 1 of 5");
    round.textContent = "sentinel";

    // Same round and total, a different (irrelevant) field — nothing is rewritten.
    status.update(stateWith({ phase: "picking", roundIndex: 0, hasMoved: true }));
    expect(round.textContent).toBe("sentinel");
  });

  it("is idempotent", () => {
    const root = mount();
    const status = createStatus(root);
    const state = stateWith({ phase: "picking", roundIndex: 2 });

    status.update(state);
    status.update(state);

    expect(root.querySelectorAll(".status").length).toBe(1);
    expect(must(root.querySelector(".status-round")).textContent).toBe("Round 3 of 5");
  });

  it("removes its section on destroy", () => {
    const root = mount();
    const status = createStatus(root);

    status.destroy();

    expect(root.querySelector(".status")).toBeNull();
  });
});
