import { describe, expect, it, vi } from "vitest";
import { oklchToCss } from "@/color/format";
import { type Oklch, oklch } from "@/color/types";
import type { GameState } from "@/domain/state";
import { initialState } from "@/domain/state";
import { createPreview } from "@/ui/preview";
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

function values(root: HTMLElement): string[] {
  return [...root.querySelectorAll(".preview-value")].map((node) => node.textContent ?? "");
}

const GUESS = oklch(0.72, 0.09, 32);

describe("createPreview", () => {
  it("keeps the readout on screen even with nothing to show", () => {
    const root = mount();
    const preview = createPreview(root);
    preview.update(stateWith({ phase: "memorize", guess: GUESS }));

    // SPEC §8: the readout is an accessibility affordance, so it is present in
    // every phase — dimmed, not removed.
    expect(must(root.querySelector(".preview-readout"))).toBeTruthy();
    expect(values(root)).toEqual(["—", "—", "—", "—"]);
    expect(must(root.querySelector(".preview")).classList.contains("is-dim")).toBe(true);
  });

  it("shows no color during memorize", () => {
    const root = mount();
    const preview = createPreview(root);
    preview.update(stateWith({ phase: "memorize", guess: GUESS }));

    const fill = must(root.querySelector<HTMLElement>(".preview-fill"));
    expect(fill.style.getPropertyValue(FILL_COLOR_PROPERTY)).toBe("");
  });

  it("renders the live guess and its coordinates while picking", () => {
    const root = mount();
    const preview = createPreview(root);
    preview.update(stateWith({ phase: "picking", guess: GUESS }));

    const fill = must(root.querySelector<HTMLElement>(".preview-fill"));
    expect(fill.style.getPropertyValue(FILL_COLOR_PROPERTY)).toBe(oklchToCss(GUESS));
    expect(values(root)).toEqual(["—", "0.720", "0.090", "32.0°"]);
    expect(must(root.querySelector(".preview")).classList.contains("is-dim")).toBe(false);
  });

  it("renders a hex approximation when one is injected", () => {
    const root = mount();
    const formatHex = (color: Oklch): string => `#${Math.round(color.L * 100)}`;
    const preview = createPreview(root, { formatHex });
    preview.update(stateWith({ phase: "picking", guess: GUESS }));

    expect(values(root)[0]).toBe("#72");
  });

  it("tracks the guess as it moves", () => {
    const root = mount();
    const preview = createPreview(root);

    preview.update(stateWith({ phase: "picking", guess: GUESS }));
    preview.update(stateWith({ phase: "picking", guess: oklch(0.4, 0.2, 300) }));

    expect(values(root)).toEqual(["—", "0.400", "0.200", "300.0°"]);
  });

  it("bails when nothing it cares about changed", () => {
    const root = mount();
    const formatHex = vi.fn((): string => "#abcdef");
    const preview = createPreview(root, { formatHex });

    preview.update(stateWith({ phase: "picking", guess: GUESS }));
    expect(formatHex).toHaveBeenCalledTimes(1);

    // A sentinel the component would overwrite if it wrote at all.
    const value = must(root.querySelector<HTMLElement>(".preview-value"));
    value.textContent = "sentinel";

    // `now` advances every frame; the preview does not care about it.
    preview.update(stateWith({ phase: "picking", guess: GUESS, now: 999 }));

    expect(value.textContent).toBe("sentinel");
  });

  it("is idempotent", () => {
    const root = mount();
    const preview = createPreview(root);
    const picking = stateWith({ phase: "picking", guess: GUESS });

    preview.update(picking);
    const first = values(root);
    preview.update(picking);

    expect(values(root)).toEqual(first);
    expect(root.querySelectorAll(".preview").length).toBe(1);
  });

  it("removes its nodes on destroy", () => {
    const root = mount();
    const preview = createPreview(root);
    preview.destroy();

    expect(root.querySelector(".preview")).toBeNull();
  });
});
