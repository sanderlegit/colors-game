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
 * The dissolve is a single cross-fade straight into the picker (ADR 0008). It
 * passed through a neutral mask for a while — see ADR 0006 for the afterimage
 * argument and ADR 0008 for why the feel cost outweighed it.
 *
 * The picker stays visible through `reveal` (ADR 0009): the score screen marks
 * where the target sat *on the picker the player was just using*, so the swatch
 * does not fade back to a flat target fill. `reveal` keeps the picker layer up
 * but takes its `pointer-events` away — it is a read-only annotated view there.
 */

import { oklchToCss } from "@/color/format";
import type { GameState, Phase } from "@/domain/state";

/** SPEC §8 / ARCHITECTURE: the dissolve is 450ms, or 0 under reduced motion. */
export const DISSOLVE_MS = 450;

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

  const stack = document.createElement("div");
  stack.className = "swatch-stack";

  const fill = document.createElement("div");
  fill.className = "swatch-fill";
  fill.style.opacity = "1";

  const pickerSlot = document.createElement("div");
  pickerSlot.className = "swatch-picker-slot";
  pickerSlot.style.opacity = "0";
  pickerSlot.style.pointerEvents = "none";

  stack.append(fill, pickerSlot);
  root.append(stack);

  let renderedMode: Mode | null = null;
  let renderedFill: string | null = null;
  let renderedPhase: Phase | null = null;
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

  /** Drop the target fill and hand the gesture to the picker. Picking only. */
  function completeDissolve(): void {
    fadeTimer = undefined;
    // The target must not be readable from the DOM once picking is live
    // (SPEC §9.4). By now the fill layer is fully transparent anyway.
    setFillColor(fill, "");
    renderedFill = null;
    setInteractive(true);
  }

  /** The picker is visible while the player picks and while they read the score. */
  function pickerVisible(phase: Phase): boolean {
    return phase === "picking" || phase === "reveal";
  }

  function update(state: GameState): void {
    const phase = state.phase;
    const mode: Mode = pickerVisible(phase) ? "picker" : "fill";
    const duration =
      options.reducedMotion === true || state.settings.reducedMotion ? 0 : configuredDuration;

    if (mode === "fill") {
      const css = oklchToCss(state.target);
      if (css !== renderedFill) {
        setFillColor(fill, css);
        renderedFill = css;
      }
    }

    const phaseChanged = phase !== renderedPhase;
    renderedPhase = phase;

    if (mode !== renderedMode) {
      renderedMode = mode;

      clearFadeTimer();
      // Off for the whole transition in both directions.
      setInteractive(false);

      stack.dataset.mode = mode;
      stack.style.setProperty("--dissolve-duration", `${duration}ms`);

      fill.style.opacity = mode === "picker" ? "0" : "1";
      pickerSlot.style.opacity = mode === "picker" ? "1" : "0";

      if (mode !== "picker") return;
      if (phase === "picking") {
        // Fading in for a live pick: hand over the gesture once it settles.
        if (duration === 0) completeDissolve();
        else fadeTimer = setTimeout(completeDissolve, duration);
      } else {
        // Straight into reveal without a prior pick (only reachable in tests):
        // show the picker but keep it read-only.
        setFillColor(fill, "");
        renderedFill = null;
      }
      return;
    }

    // Mode is unchanged. The transition that matters here is picking↔reveal —
    // both are "picker" — where reveal makes the picker a read-only annotation.
    if (phaseChanged && mode === "picker") {
      setInteractive(phase === "picking");
    }
  }

  function destroy(): void {
    clearFadeTimer();
    stack.remove();
  }

  return { pickerSlot, element: stack, update, destroy };
}
