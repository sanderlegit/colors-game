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

function picking(): GameState {
  return stateWith({ phase: "picking", target: TARGET, guess: GUESS });
}

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
  it("shows the live guess during picking, with the target still hidden", () => {
    const root = mount();
    const reveal = createReveal(root, { onNext: () => {} });
    reveal.update(picking());

    const section = must(root.querySelector<HTMLElement>(".reveal"));
    // The panel is always present now — never `hidden` — but not yet revealed.
    expect(section.hidden).toBe(false);
    expect(section.classList.contains("is-revealed")).toBe(false);

    // The guess is not secret: it renders live. The target must not.
    expect(fillColor(root, ".reveal-chip")).toBe(oklchToCss(GUESS));
    expect(fillColor(root, ".reveal-chip--target")).toBe("");

    const you = [...root.querySelectorAll<HTMLElement>(".reveal-compare-you")].map(
      (n) => n.textContent,
    );
    const target = [...root.querySelectorAll<HTMLElement>(".reveal-compare-target")].map(
      (n) => n.textContent,
    );
    expect(you).toEqual(["—", "0.550", "0.110", "195.0°"]);
    // SPEC §9.4: nothing about the target is in the DOM while the player guesses.
    expect(target).toEqual(["—", "—", "—", "—"]);
  });

  it("reads as waiting during memorize — no guess yet", () => {
    const root = mount();
    const reveal = createReveal(root, { onNext: () => {} });
    reveal.update(stateWith({ phase: "memorize", target: TARGET, guess: GUESS }));

    const section = must(root.querySelector<HTMLElement>(".reveal"));
    expect(section.classList.contains("is-dim")).toBe(true);
    expect(fillColor(root, ".reveal-chip")).toBe("");
    expect(text(root, ".reveal-compare-you")).toBe("—");
  });

  it("reveals the target and marks the panel revealed on confirm", () => {
    const root = mount();
    const reveal = createReveal(root, { onNext: () => {} });
    reveal.update(revealed([{ deltaE: 4.25, score: 81 }]));

    const section = must(root.querySelector<HTMLElement>(".reveal"));
    expect(section.classList.contains("is-revealed")).toBe(true);
    expect(fillColor(root, ".reveal-chip")).toBe(oklchToCss(GUESS));
    expect(fillColor(root, ".reveal-chip--target")).toBe(oklchToCss(TARGET));
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

  it("breaks the ΔE down by axis and lights the dominant one", () => {
    const root = mount();
    const reveal = createReveal(root, { onNext: () => {} });
    // TARGET (0.6, 0.15, 210) vs GUESS (0.55, 0.11, 195): hue is the largest
    // contributor, then lightness, then chroma.
    reveal.update(revealed([{ deltaE: 10.62, score: 62 }]));

    const cells = [...root.querySelectorAll<HTMLElement>(".reveal-breakdown-axis")];
    expect(cells.map((c) => c.dataset.axis)).toEqual(["lightness", "chroma", "hue"]);

    const byAxis = (axis: string): HTMLElement =>
      must(cells.find((c) => c.dataset.axis === axis) ?? null);
    const value = (axis: string): number =>
      Number(must(byAxis(axis).querySelector(".reveal-breakdown-value")).textContent);

    expect(value("hue")).toBeGreaterThan(value("lightness"));
    expect(value("lightness")).toBeGreaterThan(value("chroma"));
    expect(byAxis("hue").classList.contains("is-dominant")).toBe(true);
    expect(byAxis("lightness").classList.contains("is-dominant")).toBe(false);
    expect(byAxis("chroma").classList.contains("is-dominant")).toBe(false);
  });

  it("keeps the breakdown blank until the round is scored", () => {
    const root = mount();
    const reveal = createReveal(root, { onNext: () => {} });
    reveal.update(picking());

    const values = [...root.querySelectorAll(".reveal-breakdown-value")].map((v) => v.textContent);
    expect(values).toEqual(["—", "—", "—"]);
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
