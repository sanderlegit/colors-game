import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { oklch } from "@/color/types";
import type { GameState } from "@/domain/state";
import { initialState } from "@/domain/state";
import { createSwatch, FILL_COLOR_PROPERTY, oklchCss } from "@/ui/swatch";

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

describe("oklchCss", () => {
  it("renders a native CSS oklch() function", () => {
    expect(oklchCss(oklch(0.5, 0.1, 120))).toBe("oklch(0.5000 0.1000 120.00)");
  });

  it("wraps hue into 0..360 and clamps out-of-range coordinates", () => {
    expect(oklchCss(oklch(1.4, -0.2, -30))).toBe("oklch(1.0000 0.0000 330.00)");
  });
});

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
    expect(fillColor(fill)).toBe(oklchCss(TARGET));
    expect(fill.style.opacity).toBe("1");
  });

  it("keeps the picker slot inert until the dissolve finishes", () => {
    const root = mount();
    const swatch = createSwatch(root);
    swatch.update(stateWith({ phase: "memorize", target: TARGET }));

    expect(swatch.pickerSlot.style.pointerEvents).toBe("none");

    swatch.update(stateWith({ phase: "picking", target: TARGET }));
    expect(swatch.pickerSlot.style.opacity).toBe("1");
    // Mid-dissolve: the player is still looking at a half-faded target.
    expect(swatch.pickerSlot.style.pointerEvents).toBe("none");

    vi.advanceTimersByTime(449);
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
    vi.advanceTimersByTime(450);

    expect(fillColor(fill)).toBe("");
    expect(root.innerHTML).not.toContain("oklch");
  });

  it("collapses the dissolve to an instant swap under reduced motion", () => {
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
    vi.advanceTimersByTime(450);
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

  it("fades back to the target on reveal and takes interactivity away first", () => {
    const root = mount();
    const swatch = createSwatch(root);
    const fill = must(root.querySelector<HTMLElement>(".swatch-fill"));

    swatch.update(stateWith({ phase: "picking", target: TARGET }));
    vi.advanceTimersByTime(450);
    swatch.update(stateWith({ phase: "reveal", target: TARGET }));

    expect(swatch.pickerSlot.style.pointerEvents).toBe("none");
    expect(swatch.pickerSlot.style.opacity).toBe("0");
    expect(fillColor(fill)).toBe(oklchCss(TARGET));
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
