import { describe, expect, it, vi } from "vitest";
import type { GameState } from "@/domain/state";
import { initialState } from "@/domain/state";
import { createHud } from "@/ui/hud";

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

/** A memorize state `elapsed` ms into a 5s window. */
function memorizing(elapsed: number, reducedMotion = false): GameState {
  return stateWith({
    phase: "memorize",
    phaseStartedAt: 1000,
    now: 1000 + elapsed,
    settings: { memorizeMs: 5000, reducedMotion },
  });
}

function confirmButton(root: HTMLElement): HTMLButtonElement {
  return must(root.querySelector<HTMLButtonElement>(".hud-confirm"));
}

function dashOffset(root: HTMLElement): number {
  const attr = must(root.querySelector(".hud-ring-progress")).getAttribute("stroke-dashoffset");
  return Number(attr);
}

describe("createHud", () => {
  it("counts down from the domain clock, not one of its own", () => {
    const root = mount();
    const hud = createHud(root, { onConfirm: () => {} });
    const seconds = must(root.querySelector(".hud-seconds"));

    hud.update(memorizing(0));
    expect(seconds.textContent).toBe("5");

    hud.update(memorizing(2200));
    expect(seconds.textContent).toBe("3");

    hud.update(memorizing(4999));
    expect(seconds.textContent).toBe("1");
  });

  it("sweeps the ring in step with elapsed time", () => {
    const root = mount();
    const hud = createHud(root, { onConfirm: () => {} });

    hud.update(memorizing(0));
    const atStart = dashOffset(root);

    hud.update(memorizing(2500));
    const halfway = dashOffset(root);

    hud.update(memorizing(5000));
    const atEnd = dashOffset(root);

    expect(atStart).toBe(0);
    expect(halfway).toBeGreaterThan(atStart);
    expect(atEnd).toBeGreaterThan(halfway);
    expect(halfway).toBeCloseTo(atEnd / 2, 2);
  });

  it("keeps the numeric countdown but freezes the ring under reduced motion", () => {
    const root = mount();
    const hud = createHud(root, { onConfirm: () => {} }, { reducedMotion: true });
    const seconds = must(root.querySelector(".hud-seconds"));

    hud.update(memorizing(0));
    hud.update(memorizing(2500));

    expect(seconds.textContent).toBe("3");
    expect(dashOffset(root)).toBe(0);
    expect(must(root.querySelector(".hud-ring")).getAttribute("class")).toContain("is-static");
  });

  it("hides the countdown outside the memorize phase", () => {
    const root = mount();
    const hud = createHud(root, { onConfirm: () => {} });
    const countdown = must(root.querySelector<HTMLElement>(".hud-countdown"));

    hud.update(memorizing(1000));
    expect(countdown.hidden).toBe(false);

    hud.update(stateWith({ phase: "picking" }));
    expect(countdown.hidden).toBe(true);
    expect(must(root.querySelector(".hud-seconds")).textContent).toBe("");
  });

  it("shows a 1-based round counter", () => {
    const root = mount();
    const hud = createHud(root, { onConfirm: () => {} });
    const label = must(root.querySelector<HTMLElement>(".hud-round"));

    hud.update(stateWith({ phase: "picking", roundIndex: 1 }));
    expect(label.textContent).toBe("Round 2 of 5");

    hud.update(stateWith({ phase: "idle" }));
    expect(label.hidden).toBe(true);
  });

  it("keeps Confirm disabled until the picker has moved", () => {
    const root = mount();
    const hud = createHud(root, { onConfirm: () => {} });
    const button = confirmButton(root);

    hud.update(stateWith({ phase: "picking", hasMoved: false }));
    expect(button.disabled).toBe(true);

    hud.update(stateWith({ phase: "picking", hasMoved: true }));
    expect(button.disabled).toBe(false);
  });

  it("conveys the disabled state with more than color", () => {
    const root = mount();
    const hud = createHud(root, { onConfirm: () => {} });
    const button = confirmButton(root);
    const hint = must(root.querySelector<HTMLElement>(".hud-confirm-hint"));

    hud.update(stateWith({ phase: "picking", hasMoved: false }));
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).not.toBe("");
    expect(button.getAttribute("aria-describedby")).toBe(hint.id);

    hud.update(stateWith({ phase: "picking", hasMoved: true }));
    expect(button.getAttribute("aria-disabled")).toBe("false");
    expect(hint.hidden).toBe(true);
  });

  it("emits onConfirm only when Confirm is live", () => {
    const root = mount();
    const onConfirm = vi.fn();
    const hud = createHud(root, { onConfirm });
    const button = confirmButton(root);

    hud.update(stateWith({ phase: "picking", hasMoved: false }));
    button.dispatchEvent(new Event("click"));
    expect(onConfirm).not.toHaveBeenCalled();

    hud.update(stateWith({ phase: "picking", hasMoved: true }));
    button.dispatchEvent(new Event("click"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("bails when nothing it cares about changed", () => {
    const root = mount();
    const hud = createHud(root, { onConfirm: () => {} });
    const seconds = must(root.querySelector<HTMLElement>(".hud-seconds"));

    hud.update(memorizing(1200));
    expect(seconds.textContent).toBe("4");
    seconds.textContent = "sentinel";

    // Same displayed second, a different `now` — nothing visible changed.
    hud.update(memorizing(1240));
    expect(seconds.textContent).toBe("sentinel");

    // A new displayed second does change, and is written.
    hud.update(memorizing(2000));
    expect(seconds.textContent).toBe("3");
  });

  it("is idempotent", () => {
    const root = mount();
    const hud = createHud(root, { onConfirm: () => {} });
    const picking = stateWith({ phase: "picking", hasMoved: true });

    hud.update(picking);
    hud.update(picking);

    expect(root.querySelectorAll(".hud-confirm").length).toBe(1);
    expect(confirmButton(root).disabled).toBe(false);
  });

  it("stops listening on destroy", () => {
    const root = mount();
    const onConfirm = vi.fn();
    const hud = createHud(root, { onConfirm });
    const button = confirmButton(root);
    hud.update(stateWith({ phase: "picking", hasMoved: true }));

    hud.destroy();
    button.dispatchEvent(new Event("click"));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(root.querySelector(".hud")).toBeNull();
  });
});
