import { beforeEach, describe, expect, it, vi } from "vitest";
import { oklch } from "@/color/types";
import type { Event, GameState } from "@/domain/state";
import { initialState } from "@/domain/state";
import type { GameViewDeps, PickerHandlers } from "@/ui/render";
import { createGameView } from "@/ui/render";

function must<T extends Element>(element: T | null): T {
  if (element === null) throw new Error("expected element to exist");
  return element;
}

function stateWith(patch: Partial<GameState>): GameState {
  return { ...initialState(), ...patch };
}

/**
 * A picker that records what it was given. The real one needs a canvas and a
 * layout box, neither of which happy-dom has — injecting it is what keeps this
 * module testable at all.
 */
function fakePicker() {
  const updates: GameState[] = [];
  let captured: PickerHandlers | null = null;
  let slot: HTMLElement | null = null;
  let destroyed = false;

  const factory = (mountPoint: HTMLElement, handlers: PickerHandlers) => {
    slot = mountPoint;
    captured = handlers;
    return {
      update: (state: GameState) => void updates.push(state),
      destroy: () => {
        destroyed = true;
      },
    };
  };

  return {
    factory,
    updates,
    get handlers(): PickerHandlers {
      if (captured === null) throw new Error("picker was never created");
      return captured;
    },
    get slot(): HTMLElement {
      if (slot === null) throw new Error("picker was never created");
      return slot;
    },
    get destroyed(): boolean {
      return destroyed;
    },
  };
}

function setup(overrides: Partial<GameViewDeps> = {}) {
  const root = document.createElement("div");
  document.body.append(root);

  const dispatch = vi.fn<(event: Event) => void>();
  const picker = fakePicker();
  const nextSeed = vi.fn(() => 4242);

  const view = createGameView(root, {
    dispatch,
    createPicker: picker.factory,
    nextSeed,
    ...overrides,
  });

  return { root, view, dispatch, picker, nextSeed };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("createGameView", () => {
  it("builds the regions styles.css documents", () => {
    const { root } = setup();
    for (const region of [".game", ".game-hud", ".game-stage", ".game-side", ".game-menu"]) {
      expect(root.querySelector(region), region).not.toBeNull();
    }
  });

  it("mounts the picker into the swatch slot, not into a region of its own", () => {
    const { root, picker } = setup();
    expect(picker.slot.className).toBe("swatch-picker-slot");
    // Geometry is by construction: the slot must stay inside the shared stack.
    expect(must(root.querySelector(".swatch-stack")).contains(picker.slot)).toBe(true);
  });

  it("routes picker output into a PICK event", () => {
    const { dispatch, picker } = setup();
    const value = oklch(0.62, 0.13, 145);
    picker.handlers.onPick(value);
    expect(dispatch).toHaveBeenCalledWith({ type: "PICK", value });
  });

  it("routes confirm and next into their events", () => {
    const { root, view, dispatch } = setup();
    // Confirm is disabled until the player has moved the picker (SPEC §5.4), so
    // the button has to be enabled before a click means anything.
    view.update(stateWith({ phase: "picking", hasMoved: true }));

    must(root.querySelector<HTMLButtonElement>(".hud-confirm")).click();
    must(root.querySelector<HTMLButtonElement>(".reveal-next")).click();

    expect(dispatch).toHaveBeenCalledWith({ type: "CONFIRM" });
    expect(dispatch).toHaveBeenCalledWith({ type: "NEXT" });
  });

  it("starts a game with a fresh seed and the clock the reducer last saw", () => {
    const { root, view, dispatch, nextSeed } = setup();
    view.update(stateWith({ phase: "idle", now: 9100 }));

    must(root.querySelector<HTMLButtonElement>(".menu-action")).click();

    expect(nextSeed).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: "START", seed: 4242, at: 9100 });
  });

  it("restarts from the summary with a new seed", () => {
    const { root, view, dispatch } = setup();
    view.update(stateWith({ phase: "summary", now: 12000 }));

    must(root.querySelector<HTMLButtonElement>(".menu-action")).click();

    expect(dispatch).toHaveBeenCalledWith({ type: "RESTART", seed: 4242, at: 12000 });
  });

  it("confirms on Enter from the picker (SPEC §8)", () => {
    const { dispatch, picker } = setup();
    picker.slot.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(dispatch).toHaveBeenCalledWith({ type: "CONFIRM" });
  });

  it("leaves other keys to the picker", () => {
    const { dispatch, picker } = setup();
    picker.slot.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("fans every update out to the picker", () => {
    const { view, picker } = setup();
    const state = stateWith({ phase: "picking" });
    view.update(state);
    expect(picker.updates).toEqual([state]);
  });

  it("tears every component down, including the injected picker", () => {
    const { root, view, picker } = setup();
    view.destroy();

    expect(root.querySelector(".game")).toBeNull();
    expect(picker.destroyed).toBe(true);
  });

  it("passes an absent hex formatter as omitted rather than undefined", () => {
    // exactOptionalPropertyTypes makes this a compile-time concern; the runtime
    // check is that the side panel still renders its placeholder.
    const { root, view } = setup();
    view.update(stateWith({ phase: "picking" }));
    expect(root.querySelector(".reveal")).not.toBeNull();
  });
});
