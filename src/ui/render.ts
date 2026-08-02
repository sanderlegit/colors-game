/**
 * Assembles the components into the markup contract documented in styles.css and
 * routes their callbacks into game events.
 *
 * Data flows one way: DOM event → `Event` → reducer → new state → `update`. No
 * component reads another component, and none of them holds game state of its
 * own. That is what keeps a frameworkless render loop tractable.
 *
 * The picker arrives as a factory rather than an import. It is the one component
 * that needs a canvas and a real layout box, so injecting it keeps this module
 * mountable in happy-dom and lets the picker be swapped without touching
 * composition.
 */

import type { Oklch } from "@/color/types";
import type { Event, GameState } from "@/domain/state";
import { createAction } from "@/ui/action";
import { createMenu } from "@/ui/menu";
import { createReveal } from "@/ui/reveal";
import { createStatus } from "@/ui/status";
import { createSwatch } from "@/ui/swatch";

export type PickerHandlers = {
  readonly onPick: (value: Oklch) => void;
};

export type Picker = {
  update(state: GameState): void;
  destroy(): void;
};

export type PickerFactory = (slot: HTMLElement, handlers: PickerHandlers) => Picker;

export type GameViewDeps = {
  readonly dispatch: (event: Event) => void;
  readonly createPicker: PickerFactory;
  readonly nextSeed: () => number;
  readonly reducedMotion?: boolean;
  readonly formatHex?: (color: Oklch) => string;
  readonly bestScore?: number;
};

export type GameView = {
  readonly element: HTMLElement;
  /** The menu's mount point for the name-claim block, passed straight through. */
  readonly submitSlot: HTMLElement;
  update(state: GameState): void;
  setBestScore(score: number): void;
  destroy(): void;
};

function region(parent: HTMLElement, className: string): HTMLElement {
  const element = document.createElement("div");
  element.className = className;
  parent.append(element);
  return element;
}

export function createGameView(root: HTMLElement, deps: GameViewDeps): GameView {
  const reducedMotion = deps.reducedMotion ?? false;

  const game = document.createElement("div");
  game.className = "game";

  // Region order top→bottom (ADR 0027): status · readout · picker · action bar.
  // The menu overlays everything (`display: contents`), so its DOM position is
  // free.
  const statusRegion = region(game, "game-status");
  const sideRegion = region(game, "game-side");
  const stageRegion = region(game, "game-stage");
  const actionRegion = region(game, "game-action");
  const menuRegion = region(game, "game-menu");

  root.append(game);

  const status = createStatus(statusRegion);
  const swatch = createSwatch(stageRegion, { reducedMotion });
  const picker = deps.createPicker(swatch.pickerSlot, {
    onPick: (value) => deps.dispatch({ type: "PICK", value }),
  });

  // The side panel is the live guess during picking and the round result after
  // confirm — one persistent place, nothing shifting (ADR 0010).
  // `exactOptionalPropertyTypes` is on, so an absent formatter must be omitted
  // rather than passed as undefined.
  const reveal = createReveal(
    sideRegion,
    deps.formatHex === undefined ? {} : { formatHex: deps.formatHex },
  );

  // The phase action bar: countdown while memorizing, Confirm while picking, Next
  // round on reveal — one reserved slot at the bottom, in the thumb zone (ADR 0027).
  const action = createAction(
    actionRegion,
    {
      onConfirm: () => deps.dispatch({ type: "CONFIRM" }),
      onNext: () => deps.dispatch({ type: "NEXT" }),
    },
    { reducedMotion },
  );

  // SPEC §8: Enter confirms. The picker owns the arrow keys, but confirming from
  // it would mean handing it a second responsibility, so the binding lives here.
  // Scoped to the slot, so it cannot double-fire with a focused button.
  function onSlotKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Enter") return;
    event.preventDefault();
    deps.dispatch({ type: "CONFIRM" });
  }
  swatch.pickerSlot.addEventListener("keydown", onSlotKeyDown);

  // `at` is the last timestamp the reducer saw, so a game started between frames
  // still begins its memorize window from a clock the reducer agrees with.
  let now = 0;
  const menu = createMenu(
    menuRegion,
    {
      onStart: () => deps.dispatch({ type: "START", seed: deps.nextSeed(), at: now }),
      onRestart: () => deps.dispatch({ type: "RESTART", seed: deps.nextSeed(), at: now }),
    },
    deps.bestScore === undefined ? {} : { bestScore: deps.bestScore },
  );

  const parts = [status, swatch, picker, reveal, action, menu];

  function update(state: GameState): void {
    now = state.now;
    for (const part of parts) part.update(state);
  }

  function destroy(): void {
    swatch.pickerSlot.removeEventListener("keydown", onSlotKeyDown);
    for (const part of parts) part.destroy();
    game.remove();
  }

  return {
    element: game,
    submitSlot: menu.submitSlot,
    update,
    setBestScore: menu.setBestScore,
    destroy,
  };
}
