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
 */

import type { Oklch } from "@/color/types";
import type { GameState } from "@/domain/state";

/** SPEC §8 / ARCHITECTURE: the dissolve is 450ms, or 0 under reduced motion. */
export const DISSOLVE_MS = 450;

function clampMin(value: number, min: number): number {
  if (!Number.isFinite(value) || value < min) return min;
  return value;
}

function normalizeHue(hue: number): number {
  if (!Number.isFinite(hue)) return 0;
  const wrapped = hue % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * OKLCh as a CSS color. Every browser we target implements the `oklch()`
 * function natively, so rendering a color needs no conversion code at all.
 *
 * Temporary home: this belongs in `src/color/format.ts` alongside hex
 * parse/format (BACKLOG 1.4). That module landed in parallel with this one and
 * now exports `oklchToCss`; the two should be collapsed into it — the callers
 * here and the precision the readout dirty-check depends on are the only things
 * that need checking when they are.
 */
export function oklchCss(color: Oklch): string {
  const L = Math.min(clampMin(color.L, 0), 1);
  const c = clampMin(color.c, 0);
  return `oklch(${L.toFixed(4)} ${c.toFixed(4)} ${normalizeHue(color.h).toFixed(2)})`;
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

  function completeDissolve(): void {
    fadeTimer = undefined;
    // The target must not be readable from the DOM once picking is live
    // (SPEC §9.4). Dropping the color is the last step of the fade, by which
    // point the layer is fully transparent anyway.
    setFillColor(fill, "");
    renderedFill = null;
    setInteractive(true);
  }

  function update(state: GameState): void {
    const mode: Mode = state.phase === "picking" ? "picker" : "fill";
    const duration =
      options.reducedMotion === true || state.settings.reducedMotion ? 0 : configuredDuration;

    if (mode === "fill") {
      const css = oklchCss(state.target);
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
    fill.style.opacity = mode === "picker" ? "0" : "1";
    pickerSlot.style.opacity = mode === "picker" ? "1" : "0";

    if (mode !== "picker") return;
    if (duration === 0) {
      completeDissolve();
      return;
    }
    fadeTimer = setTimeout(completeDissolve, duration);
  }

  function destroy(): void {
    clearFadeTimer();
    stack.remove();
  }

  return { pickerSlot, element: stack, update, destroy };
}
