import { describe, expect, it, vi } from "vitest";
import { oklch } from "@/color/types";
import type { GameState, RoundResult } from "@/domain/state";
import { initialState } from "@/domain/state";
import { createAction } from "@/ui/action";

const GREY = oklch(0.5, 0, 0);

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

const NOOP = { onConfirm: () => {}, onNext: () => {} };

/** A memorize state `elapsed` ms into a 5s window. */
function memorizing(elapsed: number, reducedMotion = false): GameState {
  return stateWith({
    phase: "memorize",
    phaseStartedAt: 1000,
    now: 1000 + elapsed,
    settings: { memorizeMs: 5000, reducedMotion },
  });
}

/** A reveal state with `roundIndex` results recorded, for the Next-label cases. */
function revealed(roundIndex: number): GameState {
  const results: readonly RoundResult[] = Array.from({ length: roundIndex + 1 }, () => ({
    deltaE: 0,
    score: 50,
    target: GREY,
    guess: GREY,
  }));
  return stateWith({ phase: "reveal", roundIndex, results });
}

function confirmButton(root: HTMLElement): HTMLButtonElement {
  return must(root.querySelector<HTMLButtonElement>(".action-confirm"));
}

function nextButton(root: HTMLElement): HTMLButtonElement {
  return must(root.querySelector<HTMLButtonElement>(".action-next"));
}

function dashOffset(root: HTMLElement): number {
  const attr = must(root.querySelector(".action-ring-progress")).getAttribute("stroke-dashoffset");
  return Number(attr);
}

describe("createAction — countdown (memorize)", () => {
  it("counts down from the domain clock, not one of its own", () => {
    const root = mount();
    const action = createAction(root, NOOP);
    const seconds = must(root.querySelector(".action-seconds"));

    action.update(memorizing(0));
    expect(seconds.textContent).toBe("5");

    action.update(memorizing(2200));
    expect(seconds.textContent).toBe("3");

    action.update(memorizing(4999));
    expect(seconds.textContent).toBe("1");
  });

  it("sweeps the ring in step with elapsed time", () => {
    const root = mount();
    const action = createAction(root, NOOP);

    action.update(memorizing(0));
    const atStart = dashOffset(root);

    action.update(memorizing(2500));
    const halfway = dashOffset(root);

    action.update(memorizing(5000));
    const atEnd = dashOffset(root);

    expect(atStart).toBe(0);
    expect(halfway).toBeGreaterThan(atStart);
    expect(atEnd).toBeGreaterThan(halfway);
    expect(halfway).toBeCloseTo(atEnd / 2, 2);
  });

  it("keeps the numeric countdown but freezes the ring under reduced motion", () => {
    const root = mount();
    const action = createAction(root, NOOP, { reducedMotion: true });
    const seconds = must(root.querySelector(".action-seconds"));

    action.update(memorizing(0));
    action.update(memorizing(2500));

    expect(seconds.textContent).toBe("3");
    expect(dashOffset(root)).toBe(0);
    expect(must(root.querySelector(".action-ring")).getAttribute("class")).toContain("is-static");
  });

  it("hides the countdown outside the memorize phase", () => {
    const root = mount();
    const action = createAction(root, NOOP);
    const countdown = must(root.querySelector<HTMLElement>(".action-countdown"));

    action.update(memorizing(1000));
    expect(countdown.hidden).toBe(false);

    action.update(stateWith({ phase: "picking" }));
    expect(countdown.hidden).toBe(true);
    expect(must(root.querySelector(".action-seconds")).textContent).toBe("");
  });
});

describe("createAction — Confirm (picking)", () => {
  it("shows Confirm only while picking", () => {
    const root = mount();
    const action = createAction(root, NOOP);
    const button = confirmButton(root);

    action.update(memorizing(1000));
    expect(button.hidden).toBe(true);

    action.update(stateWith({ phase: "picking", hasMoved: true }));
    expect(button.hidden).toBe(false);
  });

  it("keeps Confirm disabled until the picker has moved", () => {
    const root = mount();
    const action = createAction(root, NOOP);
    const button = confirmButton(root);

    action.update(stateWith({ phase: "picking", hasMoved: false }));
    expect(button.disabled).toBe(true);

    action.update(stateWith({ phase: "picking", hasMoved: true }));
    expect(button.disabled).toBe(false);
  });

  it("conveys the disabled state with more than color", () => {
    const root = mount();
    const action = createAction(root, NOOP);
    const button = confirmButton(root);
    const hint = must(root.querySelector<HTMLElement>(".action-confirm-hint"));

    action.update(stateWith({ phase: "picking", hasMoved: false }));
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).not.toBe("");
    expect(button.getAttribute("aria-describedby")).toBe(hint.id);

    action.update(stateWith({ phase: "picking", hasMoved: true }));
    expect(button.getAttribute("aria-disabled")).toBe("false");
    expect(hint.hidden).toBe(true);
  });

  it("emits onConfirm only when Confirm is live", () => {
    const root = mount();
    const onConfirm = vi.fn();
    const action = createAction(root, { onConfirm, onNext: () => {} });
    const button = confirmButton(root);

    action.update(stateWith({ phase: "picking", hasMoved: false }));
    button.dispatchEvent(new Event("click"));
    expect(onConfirm).not.toHaveBeenCalled();

    action.update(stateWith({ phase: "picking", hasMoved: true }));
    button.dispatchEvent(new Event("click"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("createAction — Next round (reveal)", () => {
  it("shows Next only on reveal, labelled by where it leads", () => {
    const root = mount();
    const action = createAction(root, NOOP);
    const button = nextButton(root);

    action.update(stateWith({ phase: "picking", hasMoved: true }));
    expect(button.hidden).toBe(true);

    action.update(revealed(0));
    expect(button.hidden).toBe(false);
    expect(button.textContent).toBe("Next round");

    action.update(revealed(4));
    expect(button.textContent).toBe("See summary");
  });

  it("emits onNext when the button is pressed", () => {
    const root = mount();
    const onNext = vi.fn();
    const action = createAction(root, { onConfirm: () => {}, onNext });

    action.update(revealed(0));
    nextButton(root).dispatchEvent(new Event("click"));

    expect(onNext).toHaveBeenCalledTimes(1);
  });
});

describe("createAction — general", () => {
  it("bails when nothing it cares about changed", () => {
    const root = mount();
    const action = createAction(root, NOOP);
    const seconds = must(root.querySelector<HTMLElement>(".action-seconds"));

    action.update(memorizing(1200));
    expect(seconds.textContent).toBe("4");
    seconds.textContent = "sentinel";

    // Same displayed second, a different `now` — nothing visible changed.
    action.update(memorizing(1240));
    expect(seconds.textContent).toBe("sentinel");

    // A new displayed second does change, and is written.
    action.update(memorizing(2000));
    expect(seconds.textContent).toBe("3");
  });

  it("is idempotent", () => {
    const root = mount();
    const action = createAction(root, NOOP);
    const picking = stateWith({ phase: "picking", hasMoved: true });

    action.update(picking);
    action.update(picking);

    expect(root.querySelectorAll(".action-confirm").length).toBe(1);
    expect(confirmButton(root).disabled).toBe(false);
  });

  it("stops listening on destroy", () => {
    const root = mount();
    const onConfirm = vi.fn();
    const onNext = vi.fn();
    const action = createAction(root, { onConfirm, onNext });
    const confirm = confirmButton(root);
    const next = nextButton(root);
    action.update(stateWith({ phase: "picking", hasMoved: true }));

    action.destroy();
    confirm.dispatchEvent(new Event("click"));
    next.dispatchEvent(new Event("click"));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
    expect(root.querySelector(".action")).toBeNull();
  });
});
