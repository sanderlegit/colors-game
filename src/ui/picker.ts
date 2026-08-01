/**
 * The picker: an OKLCh L×C plane at constant hue, plus an inlaid hue slider
 * (ADR 0005).
 *
 * Three decisions from the ADR are load-bearing and are easy to "simplify" back
 * into bugs:
 *
 * 1. **L×C, not HSV/OKHSV/OKHSL.** Every cylinder-shaped space collapses at its
 *    edges, so a fixed pixel slip costs wildly different amounts depending on
 *    where you are (4.0×–3.5× unfairness, 24–29% near-dead area). A true L×C
 *    plane drops that to 2.2× and 2%. The perceptual label on OKHSL does not
 *    help — the problem is topological.
 * 2. **Out of gamut is inert, never clamped.** ~50% of the rectangle is outside
 *    sRGB at any hue. Clamping would map many distinct cursor positions onto one
 *    colour, which is worse than an honest dead zone, so `selectAtPlanePoint`
 *    returns `null` there and the pointer handlers do nothing.
 * 3. **The hue slider is the precision bottleneck**, not the plane — ~0.93
 *    ΔE00/px against 0.18. Hence full width, a tap-target-tall band, and a
 *    0.5°/arrow nudge, which is already finer than one pixel of slider (~1.2°).
 *
 * The pure geometry and arithmetic live in the exported functions at the top;
 * `createPicker` is a thin DOM wrapper over them. happy-dom has neither canvas
 * rendering nor layout, so that split is what makes any of this testable.
 */

import { oklchToSrgb } from "@/color/convert";
import { oklchToCss } from "@/color/format";
import { clipChromaToGamut, maxChroma } from "@/color/gamut";
import { type Oklch, oklch } from "@/color/types";
import type { GameState } from "@/domain/state";
import { setFillColor } from "@/ui/swatch";

/* -------------------------------------------------------------------------- */
/* Pure geometry                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A position in the plane, both axes normalized to 0..1.
 *
 * `v` is lightness directly. `u` is chroma as a **fraction of the widest chroma
 * this hue can reach**, not an absolute value — the sRGB gamut's chroma ceiling
 * swings 13× across hues, so an absolute axis would leave teal with a usable
 * sliver and waste most of the plane. Normalizing keeps the in-gamut share near
 * the ~50% the ADR measured at every hue.
 */
export type PlanePoint = { readonly u: number; readonly v: number };

/** The subset of a client rect the pointer maths needs. */
export type Rect = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

/** SPEC §8 / ADR 0005: 0.5° is sub-pixel on the slider (one pixel is ~1.2°). */
export const HUE_NUDGE_DEG = 0.5;

/** One arrow in the plane, in normalized units — ~1/400th of an axis. */
export const PLANE_NUDGE = 0.0025;

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
 * Widest in-gamut chroma anywhere on this hue's leaf — the cusp. This is the
 * scale of the plane's horizontal axis.
 *
 * Memoized on hue quantized to 0.5°, which bounds the cache at 720 entries and
 * costs under 0.2% of chroma. Both directions of the mapping go through this
 * function, so they stay exact inverses of each other whatever it returns.
 */
const chromaAxisCache = new Map<number, number>();

export function chromaAxisMax(hue: number): number {
  const key = Math.round(wrapHue(hue) * 2) / 2;
  const cached = chromaAxisCache.get(key);
  if (cached !== undefined) return cached;

  // The cusp is a single smooth maximum in L: a coarse sweep then a local
  // refinement finds it without a general optimizer.
  let bestL = 0.5;
  let best = 0;
  for (let L = 0.02; L < 1; L += 0.02) {
    const c = maxChroma(L, key);
    if (c > best) {
      best = c;
      bestL = L;
    }
  }
  for (let L = bestL - 0.02; L <= bestL + 0.02; L += 0.002) {
    if (L <= 0 || L >= 1) continue;
    const c = maxChroma(L, key);
    if (c > best) best = c;
  }

  chromaAxisCache.set(key, best);
  return best;
}

/** Pointer client coordinates → plane position. Clamped to the rectangle. */
export function planePointFromPointer(x: number, y: number, rect: Rect): PlanePoint {
  const u = rect.width > 0 ? (x - rect.left) / rect.width : 0;
  const v = rect.height > 0 ? 1 - (y - rect.top) / rect.height : 0;
  return { u: clamp01(u), v: clamp01(v) };
}

/** Plane position → colour, without asking whether it is displayable. */
export function planePointToOklch(point: PlanePoint, hue: number): Oklch {
  const h = wrapHue(hue);
  return oklch(clamp01(point.v), clamp01(point.u) * chromaAxisMax(h), h);
}

/** Where a colour sits in the plane. The inverse of `planePointToOklch`. */
export function planePointForColor(color: Oklch): PlanePoint {
  const scale = chromaAxisMax(color.h);
  return { u: scale > 0 ? clamp01(color.c / scale) : 0, v: clamp01(color.L) };
}

/**
 * The selection rule: a plane position yields a colour only where sRGB can
 * actually show it. `null` is the inert region (ADR 0005) — the caller must not
 * substitute a clamped colour for it.
 */
export function selectAtPlanePoint(point: PlanePoint, hue: number): Oklch | null {
  const color = planePointToOklch(point, hue);
  return color.c <= maxChroma(color.L, color.h) ? color : null;
}

/** Pointer client X → hue. The slider runs 0..360° left to right. */
export function hueFromPointer(x: number, rect: Rect): number {
  const fraction = rect.width > 0 ? (x - rect.left) / rect.width : 0;
  return wrapHue(clamp01(fraction) * 360);
}

/** Hue → its fraction along the slider, for positioning the thumb. */
export function hueSliderFraction(hue: number): number {
  return wrapHue(hue) / 360;
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

function sameColor(a: Oklch, b: Oklch): boolean {
  return a.L === b.L && a.c === b.c && a.h === b.h;
}

/**
 * Arrow-key nudge inside the plane. `null` means "not a key we handle, or the
 * value did not move" — either way the caller must not dispatch.
 *
 * Unlike the pointer path this *does* clip chroma back into gamut rather than
 * refusing the move. A nudge is relative, so there is no cursor-position-to-
 * colour ambiguity to protect; refusing instead would strand the player against
 * the cusp with a key that silently does nothing.
 */
export function nudgeInPlane(guess: Oklch, key: string, coarse: boolean): Oklch | null {
  const step = PLANE_NUDGE * (coarse ? COARSE_MULTIPLIER : 1);
  const delta = stepFor(key, step);
  if (delta === null) return null;

  const point = planePointForColor(guess);
  const horizontal = key === "ArrowLeft" || key === "ArrowRight";
  const moved: PlanePoint = horizontal
    ? { u: clamp01(point.u + delta), v: point.v }
    : { u: point.u, v: clamp01(point.v + delta) };

  const next = clipChromaToGamut(planePointToOklch(moved, guess.h));
  return sameColor(next, guess) ? null : next;
}

/**
 * Arrow-key nudge on the hue slider. `anchor` is the plane position the chroma
 * is rebuilt from, so travelling through a gamut-starved hue and back does not
 * ratchet chroma down a step at a time.
 */
export function nudgeHue(
  guess: Oklch,
  anchor: PlanePoint,
  key: string,
  coarse: boolean,
): Oklch | null {
  const step = HUE_NUDGE_DEG * (coarse ? COARSE_MULTIPLIER : 1);
  const delta = stepFor(key, step);
  if (delta === null) return null;

  const next = clipChromaToGamut(planePointToOklch(anchor, wrapHue(guess.h + delta)));
  return sameColor(next, guess) ? null : next;
}

/* -------------------------------------------------------------------------- */
/* Pure painting                                                              */
/* -------------------------------------------------------------------------- */

/** Neutral hatch over the inert region — translucent, so it reads in both themes. */
const INERT_R = 128;
const INERT_G = 128;
const INERT_B = 134;
const INERT_ALPHA_A = 40;
const INERT_ALPHA_B = 100;
const HATCH_PERIOD = 10;

/** Colour samples per repaint while a hue drag is in flight (~5ms). */
export const DRAFT_SAMPLES = 24_000;

/** Colour samples for the settled repaint (~25ms, once). */
export const FINAL_SAMPLES = 120_000;

/**
 * Paint the plane into an RGBA buffer. Pure — no canvas, no DOM — so the gamut
 * boundary and the inert treatment are testable in happy-dom.
 *
 * The field is sampled on a lattice whose spacing is chosen to hold the sample
 * count near `sampleBudget`, and each sample fills its block. A full-resolution
 * sweep is ~0.2µs per pixel, which is a 60ms repaint on a retina swatch — far
 * too slow to keep up with a hue drag, and the field is smooth enough that one
 * sample per CSS pixel is indistinguishable.
 */
export function renderPlanePixels(
  width: number,
  height: number,
  hue: number,
  sampleBudget: number,
): Uint8ClampedArray {
  if (width <= 0 || height <= 0) return new Uint8ClampedArray(0);

  const pixels = new Uint8ClampedArray(width * height * 4);
  const h = wrapHue(hue);
  const scale = chromaAxisMax(h);
  const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / Math.max(1, sampleBudget))));

  for (let blockY = 0; blockY < height; blockY += step) {
    const rowEnd = Math.min(blockY + step, height);
    const L = 1 - Math.min(blockY + step / 2, height) / height;
    const boundary = scale > 0 ? (maxChroma(L, h) / scale) * width : 0;

    for (let blockX = 0; blockX < width; blockX += step) {
      const columnEnd = Math.min(blockX + step, width);
      const centre = Math.min(blockX + step / 2, width);
      const inGamut = centre <= boundary;

      let r = 0;
      let g = 0;
      let b = 0;
      if (inGamut) {
        const sample = oklchToSrgb(oklch(L, (centre / width) * scale, h));
        r = sample.r * 255;
        g = sample.g * 255;
        b = sample.b * 255;
      }

      for (let y = blockY; y < rowEnd; y += 1) {
        for (let x = blockX; x < columnEnd; x += 1) {
          const i = (y * width + x) * 4;
          if (inGamut) {
            pixels[i] = r;
            pixels[i + 1] = g;
            pixels[i + 2] = b;
            pixels[i + 3] = 255;
          } else {
            pixels[i] = INERT_R;
            pixels[i + 1] = INERT_G;
            pixels[i + 2] = INERT_B;
            pixels[i + 3] =
              (x + y) % HATCH_PERIOD < HATCH_PERIOD / 2 ? INERT_ALPHA_A : INERT_ALPHA_B;
          }
        }
      }
    }
  }

  return pixels;
}

/**
 * The hue slider track, recoloured to the current lightness and chroma
 * (research § Picker UX: a static rainbow misreports where the player is
 * heading). Chroma is clipped per stop so every stop is a colour sRGB can show.
 */
export function hueTrackGradient(color: Oklch): string {
  const stops: string[] = [];
  for (let i = 0; i <= 12; i += 1) {
    const h = wrapHue(i * 30);
    const stop = clipChromaToGamut(planePointToOklch(planePointForColor(color), h));
    stops.push(`${oklchToCss(stop)} ${((i / 12) * 100).toFixed(2)}%`);
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/* -------------------------------------------------------------------------- */
/* DOM wrapper                                                                */
/* -------------------------------------------------------------------------- */

/** Vogel & Baudisch's Shift, in CSS pixels: ~26mm callout, ~22mm above contact. */
const LOUPE_SIZE = 98;
const LOUPE_OFFSET = 83;
const LOUPE_ZOOM = 4;

/** How long the plane stays at draft quality after the last hue change. */
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

type DragKind = "plane" | "hue";

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
  plane.setAttribute("aria-label", "Lightness and chroma. Arrow keys nudge, shift for coarse.");

  const planeCanvas = element("canvas", "picker-plane-canvas");
  planeCanvas.setAttribute("aria-hidden", "true");

  const cursor = element("div", "picker-cursor");
  cursor.setAttribute("aria-hidden", "true");

  const loupe = element("div", "picker-loupe");
  loupe.hidden = true;
  loupe.setAttribute("aria-hidden", "true");
  const loupeCanvas = element("canvas", "picker-loupe-canvas");
  loupeCanvas.width = Math.round(LOUPE_SIZE * dpr);
  loupeCanvas.height = Math.round(LOUPE_SIZE * dpr);
  loupe.append(loupeCanvas);

  plane.append(planeCanvas, cursor, loupe);

  const hue = element("div", "picker-hue");
  hue.tabIndex = -1;
  hue.setAttribute("role", "slider");
  hue.setAttribute("aria-label", "Hue");
  hue.setAttribute("aria-orientation", "horizontal");
  hue.setAttribute("aria-valuemin", "0");
  hue.setAttribute("aria-valuemax", "360");
  hue.setAttribute("aria-valuenow", "0");

  const hueTrack = element("div", "picker-hue-track");
  const hueThumb = element("div", "picker-hue-thumb");
  hue.append(hueTrack, hueThumb);

  root.append(plane, hue);
  slot.append(root);

  const planeContext = getContext(planeCanvas);
  const loupeContext = loupeCanvas.getContext("2d");

  let current: Oklch = oklch(0.5, 0, 0);
  /** Where the player last put the cursor. Survives hue travel; see `nudgeHue`. */
  let anchor: PlanePoint = { u: 0, v: 0.5 };
  let paintedHue: number | null = null;
  let paintedDraft = false;
  let refineTimer: ReturnType<typeof setTimeout> | undefined;
  let drag: Drag | null = null;
  let active = false;
  let renderedKey: string | null = null;
  /** The last value we sent out, so an echo of it does not fight the cursor. */
  let sentKey: string | null = null;

  function paint(budget: number): void {
    if (planeContext === null) return;
    const width = planeCanvas.width;
    const height = planeCanvas.height;
    if (width <= 0 || height <= 0) return;

    const image = planeContext.createImageData(width, height);
    image.data.set(renderPlanePixels(width, height, current.h, budget));
    planeContext.putImageData(image, 0, 0);
    paintedHue = current.h;
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
   * The gradient depends on hue alone, so a plane drag never repaints it — only
   * the cursor moves. A hue drag paints at draft quality and refines once it
   * settles, because a full-resolution sweep cannot keep up with a finger.
   */
  function repaintIfHueChanged(): void {
    if (paintedHue === current.h) return;
    paint(drag === null ? FINAL_SAMPLES : DRAFT_SAMPLES);
    if (paintedDraft) scheduleRefine();
  }

  function paintLoupe(point: PlanePoint): void {
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
      point.u * width - size / 2,
      (1 - point.v) * height - size / 2,
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
    const point = planePointForColor(current);
    const x = point.u * drag.rect.width;
    const y = (1 - point.v) * drag.rect.height;
    const half = LOUPE_SIZE / 2;
    const clampedX = Math.min(Math.max(x, half), Math.max(half, drag.rect.width - half));
    const above = y - LOUPE_OFFSET;
    loupe.style.left = `${clampedX.toFixed(1)}px`;
    loupe.style.top = `${(above >= half ? above : y + LOUPE_OFFSET).toFixed(1)}px`;
    setFillColor(loupe, oklchToCss(current));
    paintLoupe(point);
  }

  function applyValue(color: Oklch): void {
    current = color;
    const point = planePointForColor(color);
    const css = oklchToCss(color);

    cursor.style.left = `${(point.u * 100).toFixed(3)}%`;
    cursor.style.top = `${((1 - point.v) * 100).toFixed(3)}%`;
    setFillColor(cursor, css);

    hueThumb.style.left = `${(hueSliderFraction(color.h) * 100).toFixed(3)}%`;
    hue.setAttribute("aria-valuenow", color.h.toFixed(1));
    hue.setAttribute("aria-valuetext", `${color.h.toFixed(1)} degrees`);
    hueTrack.style.setProperty("--hue-track", hueTrackGradient(color));

    repaintIfHueChanged();
  }

  function emit(color: Oklch): void {
    sentKey = oklchToCss(color);
    handlers.onPick(color);
  }

  function surfaceOf(kind: DragKind): HTMLElement {
    return kind === "plane" ? plane : hue;
  }

  /**
   * Pointer position → the colour it selects, or `null` where nothing is
   * selectable. On the plane that is the inert out-of-gamut region; on the hue
   * slider every position selects, with chroma rebuilt from `anchor`.
   */
  function valueAt(kind: DragKind, rect: Rect, x: number, y: number): Oklch | null {
    if (kind === "plane") {
      const point = planePointFromPointer(x, y, rect);
      const color = selectAtPlanePoint(point, current.h);
      if (color !== null) anchor = point;
      return color;
    }
    return clipChromaToGamut(planePointToOklch(anchor, hueFromPointer(x, rect)));
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
    if (next !== null) {
      drag.value = next;
      applyValue(next);
    }
    if (drag.touch && kind === "plane") {
      loupe.hidden = false;
      positionLoupe();
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    const next = valueAt(drag.kind, drag.rect, event.clientX, event.clientY);
    if (next === null) return;
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
    const lift = cancelled
      ? null
      : valueAt(finished.kind, finished.rect, event.clientX, event.clientY);
    const value = cancelled ? finished.restore : (lift ?? finished.value);

    drag = null;
    loupe.hidden = true;
    applyValue(value);
    if (!cancelled) emit(value);
    renderedKey = `${active ? "1" : "0"}|${oklchToCss(value)}`;
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
        : nudgeHue(current, anchor, event.key, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    if (kind === "plane") anchor = planePointForColor(next);
    applyValue(next);
    emit(next);
    renderedKey = `${active ? "1" : "0"}|${oklchToCss(next)}`;
  }

  const planeDown = (event: PointerEvent): void => {
    onPointerDown("plane", event);
  };
  const hueDown = (event: PointerEvent): void => {
    onPointerDown("hue", event);
  };
  const planeKey = (event: KeyboardEvent): void => {
    onKeyDown("plane", event);
  };
  const hueKey = (event: KeyboardEvent): void => {
    onKeyDown("hue", event);
  };

  plane.addEventListener("pointerdown", planeDown);
  hue.addEventListener("pointerdown", hueDown);
  plane.addEventListener("keydown", planeKey);
  hue.addEventListener("keydown", hueKey);
  for (const surface of [plane, hue]) {
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
      paintedHue = null;
      paint(FINAL_SAMPLES);
    }
  });
  observer.observe(plane);

  function update(state: GameState): void {
    const nextActive = state.phase === "picking";
    if (nextActive !== active) {
      active = nextActive;
      // An invisible picker must not be tab-reachable; the slot only takes
      // `pointer-events` away, which focus does not go through.
      plane.tabIndex = nextActive ? 0 : -1;
      hue.tabIndex = nextActive ? 0 : -1;
      root.setAttribute("aria-hidden", nextActive ? "false" : "true");
    }

    // A drag owns the value while it lasts. Without this the echo of our own
    // streamed `PICK` would land back here mid-gesture and re-place the cursor.
    if (drag !== null) return;

    const key = `${nextActive ? "1" : "0"}|${oklchToCss(state.guess)}`;
    if (key === renderedKey) return;
    renderedKey = key;

    // Only a change we did not cause moves the anchor: our own echo would drag
    // it down a step every time chroma got clipped at a starved hue.
    if (key.slice(2) !== sentKey) anchor = planePointForColor(state.guess);
    applyValue(state.guess);
  }

  function destroy(): void {
    clearRefine();
    observer.disconnect();
    plane.removeEventListener("pointerdown", planeDown);
    hue.removeEventListener("pointerdown", hueDown);
    plane.removeEventListener("keydown", planeKey);
    hue.removeEventListener("keydown", hueKey);
    for (const surface of [plane, hue]) {
      surface.removeEventListener("pointermove", onPointerMove);
      surface.removeEventListener("pointerup", onPointerUp);
      surface.removeEventListener("pointercancel", onPointerCancel);
    }
    root.remove();
  }

  return { element: root, update, destroy };
}
