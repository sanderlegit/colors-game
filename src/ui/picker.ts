/**
 * The picker: an OKLCh hue × chroma-fraction plane with an inlaid lightness bar
 * (ADR 0007).
 *
 * Three properties of this model are load-bearing and are easy to "simplify"
 * back into bugs:
 *
 * 1. **The plane shows every hue at once.** x is hue over the full 0..360°, y is
 *    the chroma fraction `t` — most saturated at the top, neutral grey at the
 *    bottom. A player who has just memorised a colour begins by *finding* it,
 *    and with hue behind a slider it is not on screen to be found.
 * 2. **Chroma is a fraction of what the gamut offers, so the whole plane is
 *    displayable.** `C = t · maxChroma(L, h)`, the same construction
 *    `generateTarget` uses. There is no out-of-gamut region to render inert and
 *    nothing to clip: every point in the rectangle selects a colour, and adding
 *    a clamp back would be a bug rather than a safety net.
 * 3. **The canvas depends on lightness alone.** Hue and `t` are the plane's own
 *    axes, so a drag inside it moves the cursor and repaints nothing; only the
 *    bar dirties the canvas.
 *
 * The pure geometry and arithmetic live in the exported functions at the top;
 * `createPicker` is a thin DOM wrapper over them. happy-dom has neither canvas
 * rendering nor layout, so that split is what makes any of this testable.
 */

import { oklchToSrgb } from "@/color/convert";
import { oklchToCss } from "@/color/format";
import { maxChroma } from "@/color/gamut";
import { type Oklch, oklch } from "@/color/types";
import type { GameState } from "@/domain/state";
import { setFillColor } from "@/ui/swatch";

/* -------------------------------------------------------------------------- */
/* Pure geometry                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A position in the plane: a hue in degrees and a chroma *fraction*.
 *
 * `t` is chroma as a share of the widest chroma this `(L, h)` can reach, not an
 * absolute value. The sRGB chroma ceiling swings ~13× across `(L, h)`, so an
 * absolute axis would leave teal a usable sliver and put half the rectangle
 * outside the gamut; as a fraction, `t = 0.9` means "vivid" at every hue and
 * every point in the plane is in gamut by construction (ADR 0007).
 */
export type PlanePoint = { readonly h: number; readonly t: number };

/** A position in the plane as 0..1 of its box, y measured downward from the top. */
export type PlaneFraction = { readonly x: number; readonly y: number };

/** The subset of a client rect the pointer maths needs. */
export type Rect = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

/**
 * Hue now spans the plane's width rather than a slider's, which is the same
 * ~300px and so the same ~1.2°/px. 0.5° stays sub-pixel (SPEC §8).
 */
export const HUE_NUDGE_DEG = 0.5;

/** One arrow along the plane's y axis — ~1/400th of the chroma fraction range. */
export const CHROMA_FRACTION_NUDGE = 0.0025;

/** One arrow along the lightness bar. Full width, so this is again sub-pixel. */
export const LIGHTNESS_NUDGE = 0.0025;

/** SPEC §8: shift is the coarse modifier, ×10 on both surfaces. */
export const COARSE_MULTIPLIER = 10;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Degrees in `[0, 360)`. */
export function wrapHue(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  const wrapped = degrees % 360;
  const positive = wrapped < 0 ? wrapped + 360 : wrapped;
  return positive >= 360 ? 0 : positive;
}

/**
 * Pointer client coordinates → plane position. Clamped to the rectangle.
 *
 * The right edge is 360°, which wraps to 0° — the hue axis is a circle cut open
 * at the left edge, so the two edges show the same column of colours.
 */
export function planePointFromPointer(x: number, y: number, rect: Rect): PlanePoint {
  const across = rect.width > 0 ? (x - rect.left) / rect.width : 0;
  const down = rect.height > 0 ? (y - rect.top) / rect.height : 1;
  return { h: wrapHue(clamp01(across) * 360), t: clamp01(1 - down) };
}

/** Plane position plus a lightness → the colour it names. Always in gamut. */
export function planePointToOklch(point: PlanePoint, lightness: number): Oklch {
  const L = clamp01(lightness);
  const h = wrapHue(point.h);
  return oklch(L, clamp01(point.t) * maxChroma(L, h), h);
}

/**
 * Where a colour sits in the plane. The inverse of `planePointToOklch` wherever
 * the hue leaf has any chroma at all; at `L = 0` and `L = 1` it cannot be, since
 * black and white are the only colours there and `t` no longer exists.
 */
export function planePointForColor(color: Oklch): PlanePoint {
  const ceiling = maxChroma(color.L, color.h);
  return { h: wrapHue(color.h), t: ceiling > 0 ? clamp01(color.c / ceiling) : 0 };
}

/** Plane position → its fraction of the plane's box, for placing the cursor. */
export function planeFraction(point: PlanePoint): PlaneFraction {
  return { x: wrapHue(point.h) / 360, y: 1 - clamp01(point.t) };
}

/** Pointer client X → lightness. The bar runs dim (0) to bright (1). */
export function lightnessFromPointer(x: number, rect: Rect): number {
  return clamp01(rect.width > 0 ? (x - rect.left) / rect.width : 0);
}

function stepFor(key: string, step: number): number | null {
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return -step;
    case "ArrowRight":
    case "ArrowUp":
      return step;
    default:
      return null;
  }
}

function isHorizontal(key: string): boolean {
  return key === "ArrowLeft" || key === "ArrowRight";
}

function sameColor(a: Oklch, b: Oklch): boolean {
  return a.L === b.L && a.c === b.c && a.h === b.h;
}

/**
 * Arrow-key nudge inside the plane: hue sideways, chroma fraction vertically.
 * `null` means "not a key we handle, or the value did not move" — either way the
 * caller must not dispatch.
 *
 * Hue wraps, so the horizontal arrows never run out of travel; `t` clamps, so
 * the vertical ones stop at the saturated top and the grey floor.
 */
export function nudgeInPlane(guess: Oklch, key: string, coarse: boolean): Oklch | null {
  const horizontal = isHorizontal(key);
  const unit = horizontal ? HUE_NUDGE_DEG : CHROMA_FRACTION_NUDGE;
  const delta = stepFor(key, unit * (coarse ? COARSE_MULTIPLIER : 1));
  if (delta === null) return null;

  const point = planePointForColor(guess);
  const moved: PlanePoint = horizontal
    ? { h: wrapHue(point.h + delta), t: point.t }
    : { h: point.h, t: clamp01(point.t + delta) };

  const next = planePointToOklch(moved, guess.L);
  return sameColor(next, guess) ? null : next;
}

/**
 * Arrow-key nudge on the lightness bar.
 *
 * Only the chroma *fraction* is taken from `anchor`; the hue is the guess's own,
 * because the plane owns hue. The anchor matters at the ends of the bar: at
 * `L = 1` every colour is white, so the fraction cannot be recovered from the
 * guess, and rebuilding from the guess would strand the player on grey the
 * moment they came back down.
 */
export function nudgeLightness(
  guess: Oklch,
  anchor: PlanePoint,
  key: string,
  coarse: boolean,
): Oklch | null {
  const delta = stepFor(key, LIGHTNESS_NUDGE * (coarse ? COARSE_MULTIPLIER : 1));
  if (delta === null) return null;

  const next = planePointToOklch({ h: guess.h, t: anchor.t }, clamp01(guess.L + delta));
  return sameColor(next, guess) ? null : next;
}

/* -------------------------------------------------------------------------- */
/* Pure painting                                                              */
/* -------------------------------------------------------------------------- */

/** Colour samples per repaint while a lightness drag is in flight (~5ms). */
export const DRAFT_SAMPLES = 24_000;

/** Colour samples for the settled repaint (~25ms, once). */
export const FINAL_SAMPLES = 120_000;

/**
 * Paint the plane into an RGBA buffer. Pure — no canvas, no DOM — so what the
 * player is aiming at is testable in happy-dom.
 *
 * The field is sampled on a lattice whose spacing is chosen to hold the sample
 * count near `sampleBudget`, and each sample fills its block. A full-resolution
 * sweep is ~0.2µs per pixel, which is a 60ms repaint on a retina swatch — too
 * slow to keep up with a lightness drag, and the field is smooth enough that one
 * sample per CSS pixel is indistinguishable.
 *
 * Columns are the outer loop because the gamut ceiling depends on `(L, h)` and
 * `L` is constant across the plane: one bisection per column of the lattice,
 * not one per sample.
 */
export function renderPlanePixels(
  width: number,
  height: number,
  lightness: number,
  sampleBudget: number,
): Uint8ClampedArray {
  if (width <= 0 || height <= 0) return new Uint8ClampedArray(0);

  const pixels = new Uint8ClampedArray(width * height * 4);
  const L = clamp01(lightness);
  const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / Math.max(1, sampleBudget))));

  for (let blockX = 0; blockX < width; blockX += step) {
    const columnEnd = Math.min(blockX + step, width);
    const h = wrapHue((Math.min(blockX + step / 2, width) / width) * 360);
    const ceiling = maxChroma(L, h);

    for (let blockY = 0; blockY < height; blockY += step) {
      const rowEnd = Math.min(blockY + step, height);
      const t = 1 - Math.min(blockY + step / 2, height) / height;
      const sample = oklchToSrgb(oklch(L, t * ceiling, h));
      const r = sample.r * 255;
      const g = sample.g * 255;
      const b = sample.b * 255;

      for (let y = blockY; y < rowEnd; y += 1) {
        for (let x = blockX; x < columnEnd; x += 1) {
          const i = (y * width + x) * 4;
          pixels[i] = r;
          pixels[i + 1] = g;
          pixels[i + 2] = b;
          pixels[i + 3] = 255;
        }
      }
    }
  }

  return pixels;
}

/**
 * The lightness bar's track: the current hue and chroma fraction swept from
 * black to white. Recoloured live rather than left a static grey ramp, because
 * the bar's job is to answer "how bright is the colour I am aiming at" and a
 * grey ramp misreports it (research § Picker UX).
 *
 * Every stop is `t · maxChroma(L, h)` and so in gamut; the ends are black and
 * white, where no chroma exists.
 */
export function lightnessTrackGradient(color: Oklch): string {
  const point = planePointForColor(color);
  const stops: string[] = [];
  for (let i = 0; i <= 12; i += 1) {
    const fraction = i / 12;
    stops.push(`${oklchToCss(planePointToOklch(point, fraction))} ${(fraction * 100).toFixed(2)}%`);
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/* -------------------------------------------------------------------------- */
/* DOM wrapper                                                                */
/* -------------------------------------------------------------------------- */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Vogel & Baudisch's Shift, in CSS pixels: ~26mm callout, ~22mm above contact. */
const LOUPE_SIZE = 98;
const LOUPE_OFFSET = 83;
const LOUPE_ZOOM = 4;

/** How long the plane stays at draft quality after the last lightness change. */
const REFINE_MS = 120;

/** The slice of a 2D context the plane painter uses. Narrow so tests can fake it. */
export type PlaneContext = {
  createImageData(width: number, height: number): ImageData;
  putImageData(image: ImageData, dx: number, dy: number): void;
};

export type PickerOptions = {
  /**
   * Client rect of an interactive surface. Injected because happy-dom has no
   * layout, so the real `getBoundingClientRect` returns zeros. Called once per
   * gesture on `pointerdown`, never from `update`.
   */
  readonly measure?: (element: HTMLElement) => Rect;
  /** Plane drawing context. Returns `null` where 2D canvas is unavailable. */
  readonly getContext?: (canvas: HTMLCanvasElement) => PlaneContext | null;
  readonly devicePixelRatio?: number;
};

export type PickerHandlers = {
  readonly onPick: (value: Oklch) => void;
};

export type Picker = {
  readonly element: HTMLElement;
  update(state: GameState): void;
  destroy(): void;
};

type DragKind = "plane" | "lightness";

type Drag = {
  readonly kind: DragKind;
  readonly pointerId: number;
  readonly rect: Rect;
  readonly touch: boolean;
  readonly restore: Oklch;
  value: Oklch;
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function defaultMeasure(node: HTMLElement): Rect {
  return node.getBoundingClientRect();
}

function defaultContext(canvas: HTMLCanvasElement): PlaneContext | null {
  return canvas.getContext("2d");
}

export function createPicker(
  slot: HTMLElement,
  handlers: PickerHandlers,
  options: PickerOptions = {},
): Picker {
  const measure = options.measure ?? defaultMeasure;
  const getContext = options.getContext ?? defaultContext;
  const dpr = Math.max(1, options.devicePixelRatio ?? window.devicePixelRatio ?? 1);

  const root = element("div", "picker");
  root.setAttribute("aria-hidden", "true");

  const plane = element("div", "picker-plane");
  plane.tabIndex = -1;
  plane.setAttribute("role", "application");
  plane.setAttribute("aria-label", "Hue and chroma. Arrow keys nudge, shift for coarse.");

  const planeCanvas = element("canvas", "picker-plane-canvas");
  planeCanvas.setAttribute("aria-hidden", "true");

  const cursor = element("div", "picker-cursor");
  cursor.setAttribute("aria-hidden", "true");

  // ADR 0009: the reveal screen marks where the target sat, on this same plane,
  // so the player can see the gap. Shown only during `reveal`; it never carries
  // the target color at any other time (SPEC §9.4 — no leak while picking).
  const targetMarker = element("div", "picker-target");
  targetMarker.hidden = true;
  targetMarker.setAttribute("aria-hidden", "true");

  // A line from the guess to the target, so the error reads as a vector rather
  // than two loose dots. viewBox units are percentages; it stretches to the
  // plane because it has no aspect ratio of its own.
  const diff = document.createElementNS(SVG_NS, "svg");
  diff.setAttribute("class", "picker-diff");
  diff.setAttribute("viewBox", "0 0 100 100");
  diff.setAttribute("preserveAspectRatio", "none");
  diff.setAttribute("aria-hidden", "true");
  diff.style.display = "none";
  const diffLine = document.createElementNS(SVG_NS, "line");
  diffLine.setAttribute("class", "picker-diff-line");
  diff.append(diffLine);

  const loupe = element("div", "picker-loupe");
  loupe.hidden = true;
  loupe.setAttribute("aria-hidden", "true");
  const loupeCanvas = element("canvas", "picker-loupe-canvas");
  loupeCanvas.width = Math.round(LOUPE_SIZE * dpr);
  loupeCanvas.height = Math.round(LOUPE_SIZE * dpr);
  loupe.append(loupeCanvas);

  plane.append(planeCanvas, diff, cursor, targetMarker, loupe);

  const bar = element("div", "picker-lightness");
  bar.tabIndex = -1;
  bar.setAttribute("role", "slider");
  bar.setAttribute("aria-label", "Lightness");
  bar.setAttribute("aria-orientation", "horizontal");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "1");
  bar.setAttribute("aria-valuenow", "0.5");

  const barTrack = element("div", "picker-lightness-track");
  const barThumb = element("div", "picker-lightness-thumb");
  const barTargetThumb = element("div", "picker-lightness-target");
  barTargetThumb.hidden = true;
  barTargetThumb.setAttribute("aria-hidden", "true");
  bar.append(barTrack, barThumb, barTargetThumb);

  root.append(plane, bar);
  slot.append(root);

  const planeContext = getContext(planeCanvas);
  const loupeContext = loupeCanvas.getContext("2d");

  let current: Oklch = oklch(0.5, 0, 0);
  /** Where the player last put the cursor. Survives the ends of the bar. */
  let anchor: PlanePoint = { h: 0, t: 0 };
  let paintedLightness: number | null = null;
  let paintedDraft = false;
  let refineTimer: ReturnType<typeof setTimeout> | undefined;
  let drag: Drag | null = null;
  let active = false;
  let phase: GameState["phase"] = "idle";
  let renderedKey: string | null = null;
  /** The last value we sent out, so an echo of it does not fight the cursor. */
  let sentKey: string | null = null;

  /**
   * The dirty key for the whole picker view: the interactive flag, the phase,
   * the guess, and — only at reveal — the target. Kept in one place so the
   * pointer/keyboard handlers and `update` agree on when a frame is a no-op.
   */
  function viewKey(guessCss: string, targetCss: string): string {
    return `${active ? "1" : "0"}|${phase}|${guessCss}|${targetCss}`;
  }

  function paint(budget: number): void {
    if (planeContext === null) return;
    const width = planeCanvas.width;
    const height = planeCanvas.height;
    if (width <= 0 || height <= 0) return;

    const image = planeContext.createImageData(width, height);
    image.data.set(renderPlanePixels(width, height, current.L, budget));
    planeContext.putImageData(image, 0, 0);
    paintedLightness = current.L;
    paintedDraft = budget < FINAL_SAMPLES;
  }

  function clearRefine(): void {
    if (refineTimer === undefined) return;
    clearTimeout(refineTimer);
    refineTimer = undefined;
  }

  function scheduleRefine(): void {
    clearRefine();
    refineTimer = setTimeout(() => {
      refineTimer = undefined;
      if (paintedDraft) paint(FINAL_SAMPLES);
    }, REFINE_MS);
  }

  /**
   * The plane's two axes are its own, so a drag across it never repaints — only
   * the cursor moves. A lightness drag paints at draft quality and refines once
   * it settles, because a full-resolution sweep cannot keep up with a finger.
   */
  function repaintIfLightnessChanged(): void {
    if (paintedLightness === current.L) return;
    paint(drag === null ? FINAL_SAMPLES : DRAFT_SAMPLES);
    if (paintedDraft) scheduleRefine();
  }

  function paintLoupe(at: PlaneFraction): void {
    if (loupeContext === null) return;
    const width = planeCanvas.width;
    const height = planeCanvas.height;
    if (width <= 0 || height <= 0) return;

    const size = (LOUPE_SIZE / LOUPE_ZOOM) * dpr;
    const target = loupeCanvas.width;
    loupeContext.clearRect(0, 0, target, target);
    loupeContext.imageSmoothingEnabled = false;
    loupeContext.drawImage(
      planeCanvas,
      at.x * width - size / 2,
      at.y * height - size / 2,
      size,
      size,
      0,
      0,
      target,
      target,
    );
    loupeContext.strokeStyle = "rgba(255, 255, 255, 0.9)";
    loupeContext.lineWidth = Math.max(1, dpr);
    loupeContext.beginPath();
    loupeContext.moveTo(target / 2, target / 2 - 10 * dpr);
    loupeContext.lineTo(target / 2, target / 2 + 10 * dpr);
    loupeContext.moveTo(target / 2 - 10 * dpr, target / 2);
    loupeContext.lineTo(target / 2 + 10 * dpr, target / 2);
    loupeContext.stroke();
  }

  function positionLoupe(): void {
    if (drag === null || !drag.touch || drag.kind !== "plane") return;
    const at = planeFraction(planePointForColor(current));
    const x = at.x * drag.rect.width;
    const y = at.y * drag.rect.height;
    const half = LOUPE_SIZE / 2;
    const clampedX = Math.min(Math.max(x, half), Math.max(half, drag.rect.width - half));
    const above = y - LOUPE_OFFSET;
    loupe.style.left = `${clampedX.toFixed(1)}px`;
    loupe.style.top = `${(above >= half ? above : y + LOUPE_OFFSET).toFixed(1)}px`;
    setFillColor(loupe, oklchToCss(current));
    paintLoupe(at);
  }

  function applyValue(color: Oklch): void {
    current = color;
    const at = planeFraction(planePointForColor(color));
    const css = oklchToCss(color);

    cursor.style.left = `${(at.x * 100).toFixed(3)}%`;
    cursor.style.top = `${(at.y * 100).toFixed(3)}%`;
    setFillColor(cursor, css);

    barThumb.style.left = `${(clamp01(color.L) * 100).toFixed(3)}%`;
    bar.setAttribute("aria-valuenow", color.L.toFixed(3));
    bar.setAttribute("aria-valuetext", `${Math.round(clamp01(color.L) * 100)} percent`);
    barTrack.style.setProperty("--lightness-track", lightnessTrackGradient(color));

    repaintIfLightnessChanged();
  }

  /**
   * Mark where the target sat, next to the frozen guess, and draw the gap
   * between them (ADR 0009). Only ever called during `reveal`; `hideTarget`
   * scrubs the colour again so nothing about the target lingers into the next
   * pick.
   */
  function showTarget(target: Oklch): void {
    const at = planeFraction(planePointForColor(target));
    targetMarker.style.left = `${(at.x * 100).toFixed(3)}%`;
    targetMarker.style.top = `${(at.y * 100).toFixed(3)}%`;
    setFillColor(targetMarker, oklchToCss(target));
    targetMarker.hidden = false;

    barTargetThumb.style.left = `${(clamp01(target.L) * 100).toFixed(3)}%`;
    barTargetThumb.hidden = false;

    const from = planeFraction(planePointForColor(current));
    diffLine.setAttribute("x1", (from.x * 100).toFixed(3));
    diffLine.setAttribute("y1", (from.y * 100).toFixed(3));
    diffLine.setAttribute("x2", (at.x * 100).toFixed(3));
    diffLine.setAttribute("y2", (at.y * 100).toFixed(3));
    diff.style.display = "";
  }

  function hideTarget(): void {
    targetMarker.hidden = true;
    setFillColor(targetMarker, "");
    barTargetThumb.hidden = true;
    diff.style.display = "none";
  }

  function emit(color: Oklch): void {
    sentKey = oklchToCss(color);
    handlers.onPick(color);
  }

  function surfaceOf(kind: DragKind): HTMLElement {
    return kind === "plane" ? plane : bar;
  }

  /**
   * Pointer position → the colour it selects. Every position on both surfaces
   * selects: the plane is in gamut everywhere (ADR 0007), and the bar rebuilds
   * chroma from `anchor` so the ends of its travel do not eat it.
   */
  function valueAt(kind: DragKind, rect: Rect, x: number, y: number): Oklch {
    if (kind === "plane") {
      const point = planePointFromPointer(x, y, rect);
      anchor = point;
      return planePointToOklch(point, current.L);
    }
    return planePointToOklch({ h: current.h, t: anchor.t }, lightnessFromPointer(x, rect));
  }

  function onPointerDown(kind: DragKind, event: PointerEvent): void {
    if (!active || drag !== null) return;
    const surface = surfaceOf(kind);

    event.preventDefault();
    surface.focus();
    drag = {
      kind,
      pointerId: event.pointerId,
      rect: measure(surface),
      touch: event.pointerType === "touch",
      restore: current,
      value: current,
    };
    surface.setPointerCapture(event.pointerId);

    // ADR 0005 / ARCHITECTURE § Touch: pointer-down never commits. The cursor
    // follows so the player can see where they landed, but nothing is reported
    // until the drag streams or the finger lifts.
    const next = valueAt(kind, drag.rect, event.clientX, event.clientY);
    drag.value = next;
    applyValue(next);
    if (drag.touch && kind === "plane") {
      loupe.hidden = false;
      positionLoupe();
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    const next = valueAt(drag.kind, drag.rect, event.clientX, event.clientY);
    drag.value = next;
    applyValue(next);
    positionLoupe();
    // Streamed so the preview panel is live (SPEC §4); the *commit* is the lift.
    emit(next);
  }

  function endDrag(event: PointerEvent, cancelled: boolean): void {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    const finished = drag;
    const surface = surfaceOf(finished.kind);
    if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);

    // Take-off selection (Potter/Weldon/Shneiderman 1988): the value that counts
    // is the one under the finger at lift, not at landing.
    const value = cancelled
      ? finished.restore
      : valueAt(finished.kind, finished.rect, event.clientX, event.clientY);

    drag = null;
    loupe.hidden = true;
    applyValue(value);
    if (!cancelled) emit(value);
    renderedKey = viewKey(oklchToCss(value), "");
  }

  function onPointerUp(event: PointerEvent): void {
    endDrag(event, false);
  }

  function onPointerCancel(event: PointerEvent): void {
    endDrag(event, true);
  }

  function onKeyDown(kind: DragKind, event: KeyboardEvent): void {
    if (!active) return;
    const next =
      kind === "plane"
        ? nudgeInPlane(current, event.key, event.shiftKey)
        : nudgeLightness(current, anchor, event.key, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    if (kind === "plane") anchor = planePointForColor(next);
    applyValue(next);
    emit(next);
    renderedKey = viewKey(oklchToCss(next), "");
  }

  const planeDown = (event: PointerEvent): void => {
    onPointerDown("plane", event);
  };
  const barDown = (event: PointerEvent): void => {
    onPointerDown("lightness", event);
  };
  const planeKey = (event: KeyboardEvent): void => {
    onKeyDown("plane", event);
  };
  const barKey = (event: KeyboardEvent): void => {
    onKeyDown("lightness", event);
  };

  plane.addEventListener("pointerdown", planeDown);
  bar.addEventListener("pointerdown", barDown);
  plane.addEventListener("keydown", planeKey);
  bar.addEventListener("keydown", barKey);
  for (const surface of [plane, bar]) {
    surface.addEventListener("pointermove", onPointerMove);
    surface.addEventListener("pointerup", onPointerUp);
    surface.addEventListener("pointercancel", onPointerCancel);
  }

  /**
   * The canvas backing store follows the element, not the other way round. This
   * is the only place geometry is read, and it is a ResizeObserver callback —
   * never `update`.
   */
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const width = Math.round(entry.contentRect.width * dpr);
      const height = Math.round(entry.contentRect.height * dpr);
      if (width === planeCanvas.width && height === planeCanvas.height) continue;
      planeCanvas.width = width;
      planeCanvas.height = height;
      paintedLightness = null;
      paint(FINAL_SAMPLES);
    }
  });
  observer.observe(plane);

  function update(state: GameState): void {
    phase = state.phase;
    const nextActive = state.phase === "picking";
    if (nextActive !== active) {
      active = nextActive;
      // An invisible picker must not be tab-reachable; the slot only takes
      // `pointer-events` away, which focus does not go through. The reveal
      // annotation is read-only, so it is not focusable either.
      plane.tabIndex = nextActive ? 0 : -1;
      bar.tabIndex = nextActive ? 0 : -1;
      root.setAttribute("aria-hidden", nextActive ? "false" : "true");
    }

    // A drag owns the value while it lasts. Without this the echo of our own
    // streamed `PICK` would land back here mid-gesture and re-place the cursor.
    if (drag !== null) return;

    const reveal = state.phase === "reveal";
    const guessCss = oklchToCss(state.guess);
    const key = viewKey(guessCss, reveal ? oklchToCss(state.target) : "");
    if (key === renderedKey) return;
    renderedKey = key;

    // Only a change we did not cause moves the anchor: our own echo would reset
    // it every time the bar reached an end and the fraction became unreadable.
    if (guessCss !== sentKey) anchor = planePointForColor(state.guess);
    applyValue(state.guess);

    // The target reticle rides on the frozen guess, so it is placed after it and
    // scrubbed the moment we leave reveal — the target must not linger into the
    // next pick (SPEC §9.4).
    if (reveal) showTarget(state.target);
    else hideTarget();
  }

  function destroy(): void {
    clearRefine();
    observer.disconnect();
    plane.removeEventListener("pointerdown", planeDown);
    bar.removeEventListener("pointerdown", barDown);
    plane.removeEventListener("keydown", planeKey);
    bar.removeEventListener("keydown", barKey);
    for (const surface of [plane, bar]) {
      surface.removeEventListener("pointermove", onPointerMove);
      surface.removeEventListener("pointerup", onPointerUp);
      surface.removeEventListener("pointercancel", onPointerCancel);
    }
    root.remove();
  }

  return { element: root, update, destroy };
}
