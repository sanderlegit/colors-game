/**
 * The shared rect (SPEC §2.1, ARCHITECTURE § "The dissolve").
 *
 * Two layers live in the *same* CSS grid cell — `.swatch-fill` (the target
 * color) and `.swatch-picker-slot` (an empty mount point the picker takes over).
 * Neither layer has a size of its own; both are `grid-area: 1 / 1` inside a
 * square `.swatch-stack`. Geometry is therefore identical by construction: there
 * are no coordinates to keep in sync, so there is nothing to drift.
 *
 * The cross-fade hands `pointer-events` to the picker slot only once the fade has
 * finished. A tap that lands mid-dissolve is ambiguous — the player is looking at
 * a half-faded target, not at a picker — and registering it would move the guess
 * to a place nobody aimed at.
 *
 * The dissolve runs in three stages and passes through a neutral grey mask
 * (ADR 0006): five seconds of fixation leaves a negative afterimage, and because
 * the picker appears at the *same retinal location* — which is the whole point of
 * the design — that afterimage lands on the region the player is about to judge
 * and biases them away from the target hue. The mask lets it decay.
 */

import { oklchToCss } from "@/color/format";
import type { GameState } from "@/domain/state";

/** SPEC §8 / ARCHITECTURE: each cross-fade is 450ms, or 0 under reduced motion. */
export const DISSOLVE_MS = 450;

/**
 * How long the neutral mask is held between the two cross-fades (ADR 0006).
 *
 * This is a perceptual correction, not decoration, so unlike the fades it is
 * **not** collapsed under `prefers-reduced-motion` — removing it would reintroduce
 * the afterimage bias for exactly the users who opted out of animation.
 *
 * Cost is ~400ms per round. If playtesting says the pause hurts the feel more
 * than the afterimage hurts accuracy, this is the one number to change — but note
 * the afterimage cost is invisible to playtesters, which is why ADR 0006 decides
 * it on measurement rather than on feel.
 */
export const MASK_HOLD_MS = 400;

function clampMin(value: number, min: number): number {
  if (!Number.isFinite(value) || value < min) return min;
  return value;
}

/**
 * Every color surface carries its color in this custom property and the
 * stylesheet paints it with `background: var(--fill-color, …)`.
 *
 * Going through a custom property rather than assigning `style.background`
 * directly keeps the paint decision (flat fill? checkerboard underlay? border?)
 * in CSS, and it survives DOM implementations whose CSS parser predates
 * `oklch()` and silently drops the declaration.
 */
export const FILL_COLOR_PROPERTY = "--fill-color";

/** Set or clear an element's rendered color. Empty string clears it. */
export function setFillColor(element: HTMLElement, css: string): void {
  if (css === "") {
    element.style.removeProperty(FILL_COLOR_PROPERTY);
    return;
  }
  element.style.setProperty(FILL_COLOR_PROPERTY, css);
}

export type SwatchOptions = {
  /**
   * Collapses the dissolve to an instant swap. Pass
   * `matchMedia("(prefers-reduced-motion: reduce)").matches` from the
   * composition root — the component never queries `matchMedia` itself, so it
   * stays testable without stubbing a browser API. The in-game
   * `settings.reducedMotion` flag is honoured too; either one is enough.
   */
  readonly reducedMotion?: boolean;
  /** Override the fade duration. Tests use 0; production uses the default. */
  readonly dissolveMs?: number;
  /** Override the mask hold (ADR 0006). Tests use 0; production uses the default. */
  readonly maskHoldMs?: number;
};

export type Swatch = {
  /** Empty element the picker mounts into. Sized entirely by the shared grid cell. */
  readonly pickerSlot: HTMLElement;
  readonly element: HTMLElement;
  update(state: GameState): void;
  destroy(): void;
};

type Mode = "fill" | "picker";

export function createSwatch(root: HTMLElement, options: SwatchOptions = {}): Swatch {
  const configuredDuration = clampMin(options.dissolveMs ?? DISSOLVE_MS, 0);
  const maskHold = clampMin(options.maskHoldMs ?? MASK_HOLD_MS, 0);

  const stack = document.createElement("div");
  stack.className = "swatch-stack";

  const fill = document.createElement("div");
  fill.className = "swatch-fill";
  fill.style.opacity = "1";

  // ADR 0006. Sits between the two layers in the same grid cell, so it covers the
  // identical rect and the "picker covers the same shape" guarantee is untouched.
  const mask = document.createElement("div");
  mask.className = "swatch-mask";
  mask.style.opacity = "0";

  const pickerSlot = document.createElement("div");
  pickerSlot.className = "swatch-picker-slot";
  pickerSlot.style.opacity = "0";
  pickerSlot.style.pointerEvents = "none";

  stack.append(fill, mask, pickerSlot);
  root.append(stack);

  let renderedMode: Mode | null = null;
  let renderedFill: string | null = null;
  let interactive = false;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;

  function clearFadeTimer(): void {
    if (fadeTimer === undefined) return;
    clearTimeout(fadeTimer);
    fadeTimer = undefined;
  }

  function setInteractive(next: boolean): void {
    if (interactive === next) return;
    interactive = next;
    pickerSlot.style.pointerEvents = next ? "auto" : "none";
  }

  /** Run `step` after `delay`, or immediately when the delay is zero. */
  function schedule(delay: number, step: () => void): void {
    if (delay === 0) {
      fadeTimer = undefined;
      step();
      return;
    }
    fadeTimer = setTimeout(() => {
      fadeTimer = undefined;
      step();
    }, delay);
  }

  /**
   * Stage 3: the mask fades out over the picker, which is already at full
   * opacity behind it. Interaction opens only once that has finished.
   */
  function revealPicker(fadeMs: number): void {
    pickerSlot.style.opacity = "1";
    mask.style.opacity = "0";
    schedule(fadeMs, () => setInteractive(true));
  }

  /** Stage 1 complete: the target is fully hidden behind the mask. */
  function maskCovered(fadeMs: number): void {
    // The target must not be readable from the DOM once picking is live
    // (SPEC §9.4). By now the fill layer is fully transparent anyway.
    setFillColor(fill, "");
    renderedFill = null;
    // Stage 2: hold the neutral mask so the afterimage decays (ADR 0006).
    schedule(maskHold, () => revealPicker(fadeMs));
  }

  function update(state: GameState): void {
    const mode: Mode = state.phase === "picking" ? "picker" : "fill";
    const duration =
      options.reducedMotion === true || state.settings.reducedMotion ? 0 : configuredDuration;

    if (mode === "fill") {
      const css = oklchToCss(state.target);
      if (css !== renderedFill) {
        setFillColor(fill, css);
        renderedFill = css;
      }
    }

    if (mode === renderedMode) return;
    renderedMode = mode;

    clearFadeTimer();
    // Off for the whole transition in both directions.
    setInteractive(false);

    stack.dataset.mode = mode;
    stack.style.setProperty("--dissolve-duration", `${duration}ms`);

    if (mode !== "picker") {
      // Back to a fresh round: reset every layer at once.
      fill.style.opacity = "1";
      mask.style.opacity = "0";
      pickerSlot.style.opacity = "0";
      return;
    }

    // Stage 1: the target fades out behind the neutral mask.
    fill.style.opacity = "0";
    mask.style.opacity = "1";
    pickerSlot.style.opacity = "0";
    schedule(duration, () => maskCovered(duration));
  }

  function destroy(): void {
    clearFadeTimer();
    stack.remove();
  }

  return { pickerSlot, element: stack, update, destroy };
}
