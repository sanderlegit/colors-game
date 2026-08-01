import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { oklchToCss } from "@/color/format";
import { oklch } from "@/color/types";
import type { GameState } from "@/domain/state";
import { initialState } from "@/domain/state";
import { createSwatch, DISSOLVE_MS, FILL_COLOR_PROPERTY } from "@/ui/swatch";

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

function fillColor(element: HTMLElement): string {
  return element.style.getPropertyValue(FILL_COLOR_PROPERTY);
}

const TARGET = oklch(0.62, 0.14, 250);

describe("createSwatch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("puts both layers in one container so geometry cannot drift", () => {
    const root = mount();
    const swatch = createSwatch(root);

    const stack = must(root.querySelector<HTMLElement>(".swatch-stack"));
    const fill = must(stack.querySelector<HTMLElement>(".swatch-fill"));

    expect(fill.parentElement).toBe(stack);
    expect(swatch.pickerSlot.parentElement).toBe(stack);
    expect(swatch.pickerSlot.classList.contains("swatch-picker-slot")).toBe(true);
    // Nothing is mounted yet — the picker agent owns the contents of the slot.
    expect(swatch.pickerSlot.childElementCount).toBe(0);
  });

  it("renders the target color while memorizing", () => {
    const root = mount();
    const swatch = createSwatch(root);
    swatch.update(stateWith({ phase: "memorize", target: TARGET }));

    const fill = must(root.querySelector<HTMLElement>(".swatch-fill"));
    expect(fillColor(fill)).toBe(oklchToCss(TARGET));
    expect(fill.style.opacity).toBe("1");
  });

  it("keeps the picker slot inert until the dissolve finishes", () => {
    const root = mount();
    const swatch = createSwatch(root);
    swatch.update(stateWith({ phase: "memorize", target: TARGET }));

    expect(swatch.pickerSlot.style.pointerEvents).toBe("none");

    swatch.update(stateWith({ phase: "picking", target: TARGET }));
    // Mid-dissolve: the player is still looking at a half-faded target.
    expect(swatch.pickerSlot.style.pointerEvents).toBe("none");

    vi.advanceTimersByTime(DISSOLVE_MS - 1);
    expect(swatch.pickerSlot.style.pointerEvents).toBe("none");

    vi.advanceTimersByTime(1);
    expect(swatch.pickerSlot.style.pointerEvents).toBe("auto");
  });

  it("drops the target color from the DOM once picking is live", () => {
    const root = mount();
    const swatch = createSwatch(root);
    const fill = must(root.querySelector<HTMLElement>(".swatch-fill"));

    swatch.update(stateWith({ phase: "memorize", target: TARGET }));
    swatch.update(stateWith({ phase: "picking", target: TARGET }));
    vi.advanceTimersByTime(DISSOLVE_MS);

    expect(fillColor(fill)).toBe("");
    expect(root.innerHTML).not.toContain("oklch");
  });

  it("collapses the fades to an instant swap under reduced motion", () => {
    const root = mount();
    const swatch = createSwatch(root, { reducedMotion: true });

    swatch.update(stateWith({ phase: "memorize", target: TARGET }));
    swatch.update(stateWith({ phase: "picking", target: TARGET }));

    // No timer advance at all.
    expect(swatch.pickerSlot.style.pointerEvents).toBe("auto");
    expect(swatch.element.style.getPropertyValue("--dissolve-duration")).toBe("0ms");
  });

  it("also honours the in-game reduced-motion setting", () => {
    const root = mount();
    const swatch = createSwatch(root);
    const settings = { memorizeMs: 5000, reducedMotion: true };

    swatch.update(stateWith({ phase: "memorize", target: TARGET, settings }));
    swatch.update(stateWith({ phase: "picking", target: TARGET, settings }));

    expect(swatch.pickerSlot.style.pointerEvents).toBe("auto");
  });

  it("is idempotent — repeating a state does not restart the dissolve", () => {
    const root = mount();
    const swatch = createSwatch(root);
    const picking = stateWith({ phase: "picking", target: TARGET });

    swatch.update(stateWith({ phase: "memorize", target: TARGET }));
    swatch.update(picking);
    vi.advanceTimersByTime(DISSOLVE_MS);
    expect(swatch.pickerSlot.style.pointerEvents).toBe("auto");

    swatch.update(picking);
    swatch.update(picking);

    expect(swatch.pickerSlot.style.pointerEvents).toBe("auto");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bails without touching the DOM when nothing it cares about changed", () => {
    const root = mount();
    const swatch = createSwatch(root);
    const fill = must(root.querySelector<HTMLElement>(".swatch-fill"));

    const memorizing = stateWith({ phase: "memorize", target: TARGET });
    swatch.update(memorizing);
    const before = fill.getAttribute("style");

    // `now` advances every frame; the swatch does not care about it.
    swatch.update(stateWith({ phase: "memorize", target: TARGET, now: 1234 }));

    expect(fill.getAttribute("style")).toBe(before);
  });

  it("keeps the picker visible but read-only on reveal (ADR 0009)", () => {
    const root = mount();
    const swatch = createSwatch(root);
    const fill = must(root.querySelector<HTMLElement>(".swatch-fill"));

    swatch.update(stateWith({ phase: "picking", target: TARGET }));
    vi.advanceTimersByTime(DISSOLVE_MS);
    swatch.update(stateWith({ phase: "reveal", target: TARGET }));

    // The score screen annotates the picker in place, so it stays up — but the
    // player can no longer move it, and the target is not shown as a flat fill.
    expect(swatch.pickerSlot.style.opacity).toBe("1");
    expect(swatch.pickerSlot.style.pointerEvents).toBe("none");
    expect(fillColor(fill)).toBe("");
    expect(root.innerHTML).not.toContain("oklch");
  });

  it("fades back to the next target when the next round begins", () => {
    const root = mount();
    const swatch = createSwatch(root);
    const fill = must(root.querySelector<HTMLElement>(".swatch-fill"));
    const NEXT_TARGET = oklch(0.4, 0.1, 30);

    swatch.update(stateWith({ phase: "picking", target: TARGET }));
    vi.advanceTimersByTime(DISSOLVE_MS);
    swatch.update(stateWith({ phase: "reveal", target: TARGET }));
    swatch.update(stateWith({ phase: "memorize", target: NEXT_TARGET }));

    expect(fillColor(fill)).toBe(oklchToCss(NEXT_TARGET));
    expect(fill.style.opacity).toBe("1");
    expect(swatch.pickerSlot.style.opacity).toBe("0");
  });

  it("removes its nodes and pending timers on destroy", () => {
    const root = mount();
    const swatch = createSwatch(root);
    swatch.update(stateWith({ phase: "memorize", target: TARGET }));
    swatch.update(stateWith({ phase: "picking", target: TARGET }));

    swatch.destroy();

    expect(vi.getTimerCount()).toBe(0);
    expect(root.querySelector(".swatch-stack")).toBeNull();
  });
});
