import { describe, expect, it, vi } from "vitest";
import { oklchToCss } from "@/color/format";
import { oklch } from "@/color/types";
import type { GameState, RoundResult, Score } from "@/domain/state";
import { initialState } from "@/domain/state";
import { createReveal } from "@/ui/reveal";
import { FILL_COLOR_PROPERTY } from "@/ui/swatch";

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

function text(root: HTMLElement, selector: string): string {
  return must(root.querySelector(selector)).textContent ?? "";
}

function fillColor(root: HTMLElement, selector: string): string {
  return must(root.querySelector<HTMLElement>(selector)).style.getPropertyValue(
    FILL_COLOR_PROPERTY,
  );
}

const TARGET = oklch(0.6, 0.15, 210);
const GUESS = oklch(0.55, 0.11, 195);

/** Takes bare scores and attaches the colors, so cases read as score data. */
function revealed(scores: readonly Score[], roundIndex = 0): GameState {
  const results: readonly RoundResult[] = scores.map((s) => ({
    ...s,
    target: TARGET,
    guess: GUESS,
  }));
  return stateWith({ phase: "reveal", roundIndex, target: TARGET, guess: GUESS, results });
}

describe("createReveal", () => {
  it("stays out of the way outside the reveal phase", () => {
    const root = mount();
    const reveal = createReveal(root, { onNext: () => {} });
    reveal.update(stateWith({ phase: "picking", target: TARGET, guess: GUESS }));

    expect(must(root.querySelector<HTMLElement>(".reveal")).hidden).toBe(true);
    // The target must not leak while the player is still guessing.
    expect(fillColor(root, ".reveal-chip")).toBe("");
  });

  it("shows target and guess side by side", () => {
    const root = mount();
    const reveal = createReveal(root, { onNext: () => {} });
    reveal.update(revealed([{ deltaE: 4.25, score: 81 }]));

    const chips = [...root.querySelectorAll<HTMLElement>(".reveal-chip")];
    expect(chips.length).toBe(2);
    expect(chips[0]?.style.getPropertyValue(FILL_COLOR_PROPERTY)).toBe(oklchToCss(TARGET));
    expect(chips[1]?.style.getPropertyValue(FILL_COLOR_PROPERTY)).toBe(oklchToCss(GUESS));
    expect(must(root.querySelector<HTMLElement>(".reveal")).hidden).toBe(false);
  });

  it("shows your coordinates against the target's", () => {
    const root = mount();
    const reveal = createReveal(root, { onNext: () => {} });
    reveal.update(revealed([{ deltaE: 4.25, score: 81 }]));

    const you = [...root.querySelectorAll<HTMLElement>(".reveal-compare-you")].map(
      (n) => n.textContent,
    );
    const target = [...root.querySelectorAll<HTMLElement>(".reveal-compare-target")].map(
      (n) => n.textContent,
    );

    // Rows are hex, L, C, h. Hex is "—" here because no formatter was injected.
    expect(you).toEqual(["—", "0.550", "0.110", "195.0°"]);
    expect(target).toEqual(["—", "0.600", "0.150", "210.0°"]);
  });

  it("shows a hex approximation when a formatter is injected", () => {
    const root = mount();
    const reveal = createReveal(root, { onNext: () => {} }, { formatHex: () => "#abcdef" });
    reveal.update(revealed([{ deltaE: 4.25, score: 81 }]));

    const hex = must(root.querySelector<HTMLElement>(".reveal-compare-you"));
    expect(hex.textContent).toBe("#abcdef");
  });

  it("explains what ΔE means", () => {
    const root = mount();
    const reveal = createReveal(root, { onNext: () => {} });
    reveal.update(revealed([{ deltaE: 4.25, score: 81 }]));

    expect(text(root, ".reveal-explain")).toContain("ΔE");
  });

  it("shows the raw ΔE alongside the score", () => {
    const root = mount();
    const reveal = createReveal(root, { onNext: () => {} });
    reveal.update(revealed([{ deltaE: 4.25678, score: 81.4 }]));

    // SPEC §6: the number the score was derived from is deliberately visible.
    expect(text(root, ".reveal-delta")).toBe("4.257");
    expect(text(root, ".reveal-score")).toBe("81");
  });

  it("shows the running total across rounds", () => {
    const root = mount();
    const reveal = createReveal(root, { onNext: () => {} });
    reveal.update(
      revealed(
        [
          { deltaE: 2, score: 90 },
          { deltaE: 8, score: 55 },
        ],
        1,
      ),
    );

    expect(text(root, ".reveal-total")).toBe("145 of 500");
  });

  it("labels the exit by where it leads", () => {
    const root = mount();
    const reveal = createReveal(root, { onNext: () => {} });

    reveal.update(revealed([{ deltaE: 2, score: 90 }], 0));
    expect(text(root, ".reveal-next")).toBe("Next round");

    reveal.update(revealed([{ deltaE: 2, score: 90 }], 4));
    expect(text(root, ".reveal-next")).toBe("See summary");
  });

  it("emits onNext when the button is pressed", () => {
    const root = mount();
    const onNext = vi.fn();
    const reveal = createReveal(root, { onNext });
    reveal.update(revealed([{ deltaE: 2, score: 90 }]));

    must(root.querySelector<HTMLButtonElement>(".reveal-next")).dispatchEvent(new Event("click"));

    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("survives a reveal with no result recorded yet", () => {
    const root = mount();
    const reveal = createReveal(root, { onNext: () => {} });
    reveal.update(revealed([]));

    expect(text(root, ".reveal-delta")).toBe("—");
    expect(text(root, ".reveal-score")).toBe("—");
  });

  it("bails when nothing it cares about changed", () => {
    const root = mount();
    const reveal = createReveal(root, { onNext: () => {} });
    const state = revealed([{ deltaE: 4.25, score: 81 }]);

    reveal.update(state);
    const delta = must(root.querySelector<HTMLElement>(".reveal-delta"));
    delta.textContent = "sentinel";

    reveal.update(revealed([{ deltaE: 4.25, score: 81 }]));
    expect(delta.textContent).toBe("sentinel");
  });

  it("is idempotent", () => {
    const root = mount();
    const reveal = createReveal(root, { onNext: () => {} });
    const state = revealed([{ deltaE: 4.25, score: 81 }]);

    reveal.update(state);
    reveal.update(state);

    expect(root.querySelectorAll(".reveal-chip").length).toBe(2);
    expect(text(root, ".reveal-delta")).toBe("4.250");
  });

  it("stops listening on destroy", () => {
    const root = mount();
    const onNext = vi.fn();
    const reveal = createReveal(root, { onNext });
    const button = must(root.querySelector<HTMLButtonElement>(".reveal-next"));

    reveal.destroy();
    button.dispatchEvent(new Event("click"));

    expect(onNext).not.toHaveBeenCalled();
    expect(root.querySelector(".reveal")).toBeNull();
  });
});
