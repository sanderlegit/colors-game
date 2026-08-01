import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { oklchToSrgb } from "@/color/convert";
import { oklchToCss } from "@/color/format";
import { clipChromaToGamut, isInGamut, maxChroma } from "@/color/gamut";
import { type Oklch, oklch } from "@/color/types";
import type { GameState } from "@/domain/state";
import { initialState } from "@/domain/state";
import {
  COARSE_MULTIPLIER,
  chromaAxisMax,
  createPicker,
  DRAFT_SAMPLES,
  FINAL_SAMPLES,
  HUE_NUDGE_DEG,
  hueFromPointer,
  hueSliderFraction,
  hueTrackGradient,
  nudgeHue,
  nudgeInPlane,
  PLANE_NUDGE,
  type PlaneContext,
  type PlanePoint,
  planePointForColor,
  planePointFromPointer,
  planePointToOklch,
  type Rect,
  renderPlanePixels,
  selectAtPlanePoint,
  wrapHue,
} from "@/ui/picker";
import type { PickerFactory } from "@/ui/render";

const RECT: Rect = { left: 0, top: 0, width: 300, height: 200 };

/* -------------------------------------------------------------------------- */
/* Pure geometry                                                              */
/* -------------------------------------------------------------------------- */

describe("wrapHue", () => {
  it("maps any angle into [0, 360)", () => {
    expect(wrapHue(0)).toBe(0);
    expect(wrapHue(360)).toBe(0);
    expect(wrapHue(-30)).toBe(330);
    expect(wrapHue(725)).toBe(5);
    expect(wrapHue(Number.NaN)).toBe(0);
  });
});

describe("chromaAxisMax", () => {
  // Reference points from docs/research/color-science.md §5.2, whose table is a
  // coarse (L, h) grid — the cusp between grid rows is at least as high.
  it("finds the cusp chroma of the hue leaf", () => {
    expect(chromaAxisMax(270)).toBeGreaterThan(0.29);
    expect(chromaAxisMax(270)).toBeLessThan(0.34);
    expect(chromaAxisMax(150)).toBeGreaterThan(0.23);
  });

  it("reports teal/azure as the most gamut-starved direction", () => {
    // §5.2: "Teal/azure (h ≈ 200°) is the most gamut-starved direction at every
    // lightness."
    expect(chromaAxisMax(200)).toBeLessThan(chromaAxisMax(270));
    expect(chromaAxisMax(200)).toBeLessThan(chromaAxisMax(30));
    expect(chromaAxisMax(200)).toBeLessThan(chromaAxisMax(150));
  });

  it("bounds every in-gamut chroma on its hue leaf", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.02, max: 0.98, noNaN: true }),
        fc.double({ min: 0, max: 360, noNaN: true }),
        (L, h) => {
          expect(maxChroma(L, h)).toBeLessThanOrEqual(chromaAxisMax(h) + 1e-6);
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("planePointFromPointer", () => {
  it("puts chroma on x and lightness on y, with y inverted", () => {
    expect(planePointFromPointer(0, 200, RECT)).toEqual({ u: 0, v: 0 });
    expect(planePointFromPointer(300, 0, RECT)).toEqual({ u: 1, v: 1 });
    expect(planePointFromPointer(150, 100, RECT)).toEqual({ u: 0.5, v: 0.5 });
  });

  it("honours the rect origin and clamps outside it", () => {
    const offset: Rect = { left: 40, top: 10, width: 300, height: 200 };
    expect(planePointFromPointer(190, 110, offset)).toEqual({ u: 0.5, v: 0.5 });
    expect(planePointFromPointer(-100, 999, offset)).toEqual({ u: 0, v: 0 });
    expect(planePointFromPointer(9999, -999, offset)).toEqual({ u: 1, v: 1 });
  });

  it("survives a zero-sized rect", () => {
    expect(planePointFromPointer(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({
      u: 0,
      v: 0,
    });
  });
});

describe("plane ↔ OKLCh", () => {
  it("round-trips a plane position through a colour", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 359.99, noNaN: true }),
        (u, v, h) => {
          const back = planePointForColor(planePointToOklch({ u, v }, h));
          expect(back.u).toBeCloseTo(u, 10);
          expect(back.v).toBeCloseTo(v, 10);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("puts lightness on v and normalized chroma on u", () => {
    const color = planePointToOklch({ u: 0.5, v: 0.25 }, 270);
    expect(color.L).toBe(0.25);
    expect(color.h).toBe(270);
    expect(color.c).toBeCloseTo(0.5 * chromaAxisMax(270), 12);
  });
});

describe("selectAtPlanePoint", () => {
  it("never returns a colour sRGB cannot show", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0.01, max: 0.99, noNaN: true }),
        fc.double({ min: 0, max: 359.99, noNaN: true }),
        (u, v, h) => {
          const color = selectAtPlanePoint({ u, v }, h);
          if (color !== null) expect(isInGamut(color)).toBe(true);
        },
      ),
      { numRuns: 120 },
    );
  });

  it("is inert in the out-of-gamut region rather than clamping into it", () => {
    // Light and very saturated at once: nothing sRGB can render.
    expect(selectAtPlanePoint({ u: 1, v: 0.95 }, 270)).toBeNull();
    expect(selectAtPlanePoint({ u: 0.05, v: 0.5 }, 270)).not.toBeNull();
  });

  it("maps distinct selectable positions to distinct colours", () => {
    // The whole reason the dead zone is honest rather than clamped (ADR 0005):
    // clamping would collapse many cursor positions onto one colour.
    const seen = new Set<string>();
    for (let i = 0; i <= 40; i += 1) {
      const color = selectAtPlanePoint({ u: i / 40, v: 0.5 }, 270);
      if (color === null) continue;
      const key = oklchToCss(color);
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBeGreaterThan(20);
  });
});

describe("hue slider mapping", () => {
  it("runs 0..360 across the track", () => {
    expect(hueFromPointer(0, RECT)).toBe(0);
    expect(hueFromPointer(150, RECT)).toBe(180);
    // The right edge is 360°, which is 0° — the track is a circle.
    expect(hueFromPointer(300, RECT)).toBe(0);
    expect(hueFromPointer(-50, RECT)).toBe(0);
  });

  it("round-trips through the thumb fraction", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 359.99, noNaN: true }), (h) => {
        const x = hueSliderFraction(h) * RECT.width + RECT.left;
        expect(hueFromPointer(x, RECT)).toBeCloseTo(h, 8);
      }),
      { numRuns: 80 },
    );
  });
});

describe("nudgeInPlane", () => {
  const base = oklch(0.5, 0.05, 270);

  it("ignores keys it does not own", () => {
    expect(nudgeInPlane(base, "Enter", false)).toBeNull();
    expect(nudgeInPlane(base, "a", false)).toBeNull();
  });

  it("moves one normalized step per arrow, ten with shift", () => {
    const right = nudgeInPlane(base, "ArrowRight", false);
    const coarse = nudgeInPlane(base, "ArrowRight", true);
    if (right === null || coarse === null) throw new Error("expected a move");

    const scale = chromaAxisMax(270);
    expect(right.c - base.c).toBeCloseTo(PLANE_NUDGE * scale, 10);
    expect(coarse.c - base.c).toBeCloseTo(PLANE_NUDGE * COARSE_MULTIPLIER * scale, 10);
    expect(right.L).toBe(base.L);
    expect(right.h).toBe(base.h);
  });

  it("moves lightness on the vertical arrows", () => {
    const up = nudgeInPlane(base, "ArrowUp", false);
    const down = nudgeInPlane(base, "ArrowDown", false);
    if (up === null || down === null) throw new Error("expected a move");
    expect(up.L).toBeCloseTo(base.L + PLANE_NUDGE, 10);
    expect(down.L).toBeCloseTo(base.L - PLANE_NUDGE, 10);
  });

  it("reports no move at the edge of the plane", () => {
    expect(nudgeInPlane(oklch(0.5, 0, 270), "ArrowLeft", false)).toBeNull();
    expect(nudgeInPlane(oklch(0, 0, 270), "ArrowDown", false)).toBeNull();
  });

  it("stays in gamut — a nudge slides along the cusp rather than off it", () => {
    // Unlike the pointer path, keyboard is a relative move with no cursor-to-
    // colour ambiguity, so clipping is the right answer instead of refusal.
    let color = oklch(0.5, chromaAxisMax(270) * 0.99, 270);
    for (let i = 0; i < 40; i += 1) {
      const next = nudgeInPlane(color, "ArrowUp", true) ?? nudgeInPlane(color, "ArrowLeft", true);
      if (next === null) break;
      color = next;
      expect(isInGamut(color)).toBe(true);
    }
  });
});

describe("nudgeHue", () => {
  const anchor: PlanePoint = { u: 0.9, v: 0.55 };
  const base = planePointToOklch(anchor, 270);

  it("moves half a degree per arrow, five with shift", () => {
    const right = nudgeHue(base, anchor, "ArrowRight", false);
    const coarse = nudgeHue(base, anchor, "ArrowRight", true);
    if (right === null || coarse === null) throw new Error("expected a move");
    expect(right.h).toBeCloseTo(270 + HUE_NUDGE_DEG, 10);
    expect(coarse.h).toBeCloseTo(270 + HUE_NUDGE_DEG * COARSE_MULTIPLIER, 10);
  });

  it("wraps across the seam", () => {
    const near = planePointToOklch(anchor, 359.8);
    const next = nudgeHue(near, anchor, "ArrowRight", false);
    if (next === null) throw new Error("expected a move");
    expect(next.h).toBeCloseTo(0.3, 8);
  });

  it("rebuilds chroma from the anchor, so hue travel does not ratchet it down", () => {
    // 200° is the most gamut-starved hue, so a colour parked there has had most
    // of its chroma clipped away. Walking out of it one step at a time has to
    // land exactly where a single jump would — otherwise each step would clip
    // the already-clipped chroma and the plane would drain to grey.
    let color = clipChromaToGamut(planePointToOklch(anchor, 200));
    for (let i = 0; i < 20; i += 1) {
      const next = nudgeHue(color, anchor, "ArrowRight", true);
      if (next !== null) color = next;
    }

    expect(color.h).toBeCloseTo(200 + 20 * HUE_NUDGE_DEG * COARSE_MULTIPLIER, 6);
    expect(color.c).toBeCloseTo(clipChromaToGamut(planePointToOklch(anchor, color.h)).c, 10);
    expect(color.c).toBeGreaterThan(planePointToOklch(anchor, 200).c * 0.5);
  });

  it("ignores keys it does not own", () => {
    expect(nudgeHue(base, anchor, "Home", false)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Pure painting                                                              */
/* -------------------------------------------------------------------------- */

describe("renderPlanePixels", () => {
  it("returns an empty buffer for a zero-sized canvas", () => {
    expect(renderPlanePixels(0, 10, 270, FINAL_SAMPLES)).toHaveLength(0);
    expect(renderPlanePixels(10, 0, 270, FINAL_SAMPLES)).toHaveLength(0);
  });

  it("fills exactly one RGBA quad per pixel", () => {
    expect(renderPlanePixels(8, 6, 270, FINAL_SAMPLES)).toHaveLength(8 * 6 * 4);
  });

  it("paints in-gamut pixels with the colour they select", () => {
    const width = 40;
    const height = 20;
    const hue = 270;
    const pixels = renderPlanePixels(width, height, hue, FINAL_SAMPLES);

    // Column 1 of row 10: low chroma, mid lightness — comfortably in gamut.
    const x = 1;
    const y = 10;
    const L = 1 - (y + 0.5) / height;
    const c = ((x + 0.5) / width) * chromaAxisMax(hue);
    const expected = oklchToSrgb(oklch(L, c, hue));
    const i = (y * width + x) * 4;

    expect(pixels[i + 3]).toBe(255);
    expect(pixels[i]).toBeCloseTo(Math.round(expected.r * 255), -0.4);
    expect(pixels[i + 1]).toBeCloseTo(Math.round(expected.g * 255), -0.4);
    expect(pixels[i + 2]).toBeCloseTo(Math.round(expected.b * 255), -0.4);
  });

  it("marks the out-of-gamut region translucent so it reads as inert", () => {
    const width = 40;
    const height = 20;
    const hue = 270;
    const pixels = renderPlanePixels(width, height, hue, FINAL_SAMPLES);

    let opaque = 0;
    let inert = 0;
    for (let y = 0; y < height; y += 1) {
      const L = 1 - (y + 0.5) / height;
      const boundary = (maxChroma(L, hue) / chromaAxisMax(hue)) * width;
      for (let x = 0; x < width; x += 1) {
        const alpha = pixels[(y * width + x) * 4 + 3] ?? 0;
        if (alpha === 255) {
          opaque += 1;
          expect(x + 0.5).toBeLessThanOrEqual(boundary + 1);
        } else {
          inert += 1;
          expect(x + 0.5).toBeGreaterThanOrEqual(boundary - 1);
        }
      }
    }

    // ADR 0005 measured ~50% of the rectangle out of gamut at any hue.
    expect(opaque).toBeGreaterThan(0);
    expect(inert).toBeGreaterThan(0);
  });

  it("hatches the inert region rather than flooding it", () => {
    const pixels = renderPlanePixels(40, 20, 270, FINAL_SAMPLES);
    const alphas = new Set<number>();
    for (let i = 3; i < pixels.length; i += 4) {
      const alpha = pixels[i] ?? 0;
      if (alpha !== 255) alphas.add(alpha);
    }
    expect(alphas.size).toBe(2);
  });

  it("keeps the sample lattice inside its budget", () => {
    // The draft pass exists so a hue drag stays interactive; if it ever sampled
    // per-pixel the drag would run at ~15fps.
    const wide = renderPlanePixels(400, 400, 270, DRAFT_SAMPLES);
    expect(wide).toHaveLength(400 * 400 * 4);
  });
});

describe("hueTrackGradient", () => {
  it("recolours the track from the current lightness and chroma", () => {
    const dark = hueTrackGradient(oklch(0.25, 0.05, 0));
    const light = hueTrackGradient(oklch(0.85, 0.05, 0));
    expect(dark.startsWith("linear-gradient(to right, ")).toBe(true);
    expect(dark.split("oklch(")).toHaveLength(14);
    expect(dark).not.toBe(light);
  });
});

/* -------------------------------------------------------------------------- */
/* DOM wrapper                                                                */
/* -------------------------------------------------------------------------- */

const PLANE_RECT: Rect = { left: 0, top: 0, width: 300, height: 200 };
const HUE_RECT: Rect = { left: 0, top: 200, width: 300, height: 44 };

function measure(node: HTMLElement): Rect {
  return node.classList.contains("picker-hue") ? HUE_RECT : PLANE_RECT;
}

type Surface = PlaneContext & { paints: number };

function fakeContext(): Surface {
  return {
    paints: 0,
    createImageData(width: number, height: number): ImageData {
      return new ImageData(Math.max(1, width), Math.max(1, height));
    },
    putImageData(): void {
      this.paints += 1;
    },
  };
}

function must<T extends Element>(node: T | null): T {
  if (node === null) throw new Error("expected element to exist");
  return node;
}

function stateWith(patch: Partial<GameState>): GameState {
  return { ...initialState(), ...patch };
}

function picking(guess: Oklch): GameState {
  return stateWith({ phase: "picking", guess });
}

type Harness = {
  readonly slot: HTMLElement;
  readonly plane: HTMLElement;
  readonly hue: HTMLElement;
  readonly cursor: HTMLElement;
  readonly loupe: HTMLElement;
  readonly surface: Surface;
  readonly picks: Oklch[];
  readonly picker: ReturnType<typeof createPicker>;
};

function mount(): Harness {
  const slot = document.createElement("div");
  slot.className = "swatch-picker-slot";
  document.body.append(slot);

  const surface = fakeContext();
  const picks: Oklch[] = [];
  const picker = createPicker(
    slot,
    { onPick: (value) => picks.push(value) },
    { measure, getContext: () => surface, devicePixelRatio: 2 },
  );

  return {
    slot,
    plane: must(slot.querySelector<HTMLElement>(".picker-plane")),
    hue: must(slot.querySelector<HTMLElement>(".picker-hue")),
    cursor: must(slot.querySelector<HTMLElement>(".picker-cursor")),
    loupe: must(slot.querySelector<HTMLElement>(".picker-loupe")),
    surface,
    picks,
    picker,
  };
}

function pointer(
  node: HTMLElement,
  type: string,
  x: number,
  y: number,
  pointerType = "mouse",
): void {
  node.dispatchEvent(
    new PointerEvent(type, {
      pointerId: 1,
      pointerType,
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function key(node: HTMLElement, name: string, shiftKey = false): void {
  node.dispatchEvent(
    new KeyboardEvent("keydown", { key: name, shiftKey, bubbles: true, cancelable: true }),
  );
}

/** Somewhere comfortably inside the in-gamut half of the plane. */
const IN_GAMUT = { x: 30, y: 100 };
/** Light and vivid at once — the inert region at every hue. */
const OUT_OF_GAMUT = { x: 298, y: 6 };
/** Low in the plane, so the loupe has room to sit above the fingertip. */
const LOW_CONTACT = { x: 30, y: 180 };

const START = oklch(0.5, 0, 270);

describe("createPicker", () => {
  it("fills the slot without writing to it", () => {
    const { slot, picker } = mount();
    picker.update(picking(START));

    // The mount contract: the slot's size, opacity and pointer-events belong to
    // the swatch's dissolve, so the picker must not have touched its style.
    expect(slot.getAttribute("style")).toBeNull();
    expect(slot.childElementCount).toBe(1);
    expect(must(slot.firstElementChild).className).toBe("picker");
  });

  it("satisfies the PickerFactory contract in src/ui/render.ts", () => {
    // The composition root injects the picker rather than importing it; the
    // optional third argument is test-only and must not break that shape.
    const factory: PickerFactory = createPicker;
    expect(typeof factory).toBe("function");
  });

  it("mounts a canvas plane, a cursor and a hue slider", () => {
    const { slot, hue } = mount();
    expect(slot.querySelector(".picker-plane-canvas")).not.toBeNull();
    expect(slot.querySelector(".picker-cursor")).not.toBeNull();
    expect(hue.getAttribute("role")).toBe("slider");
    expect(hue.getAttribute("aria-valuemax")).toBe("360");
  });

  it("is only focusable while picking", () => {
    const { plane, hue, picker } = mount();
    picker.update(stateWith({ phase: "memorize", guess: START }));
    expect(plane.tabIndex).toBe(-1);
    expect(hue.tabIndex).toBe(-1);

    picker.update(picking(START));
    expect(plane.tabIndex).toBe(0);
    expect(hue.tabIndex).toBe(0);

    picker.update(stateWith({ phase: "reveal", guess: START }));
    expect(plane.tabIndex).toBe(-1);
  });

  it("renders the guess through a custom property, not style.background", () => {
    const { cursor, hue, picker } = mount();
    const guess = oklch(0.6, 0.1, 120);
    picker.update(picking(guess));

    expect(cursor.style.getPropertyValue("--fill-color")).toBe(oklchToCss(guess));
    expect(cursor.style.left).toBe(`${(planePointForColor(guess).u * 100).toFixed(3)}%`);
    expect(hue.getAttribute("aria-valuenow")).toBe("120.0");
  });

  it("bails out of update when nothing it cares about changed", () => {
    const { surface, picker, cursor } = mount();
    picker.update(picking(START));
    const paints = surface.paints;
    const left = cursor.style.left;

    // `now` advances every frame; the picker does not care.
    picker.update(picking(START));
    picker.update(stateWith({ phase: "picking", guess: START, now: 4321 }));

    expect(surface.paints).toBe(paints);
    expect(cursor.style.left).toBe(left);
  });

  it("repaints the gradient on a hue change and never on a plane drag", () => {
    const { plane, hue, surface, picker } = mount();
    picker.update(picking(START));
    const afterMount = surface.paints;
    expect(afterMount).toBeGreaterThan(0);

    pointer(plane, "pointerdown", IN_GAMUT.x, IN_GAMUT.y);
    pointer(plane, "pointermove", 60, 80);
    pointer(plane, "pointermove", 90, 120);
    pointer(plane, "pointerup", 90, 120);
    expect(surface.paints).toBe(afterMount);

    pointer(hue, "pointerdown", 150, 220);
    pointer(hue, "pointermove", 160, 220);
    expect(surface.paints).toBeGreaterThan(afterMount);
  });

  it("does not commit on pointer-down and commits the value at lift", () => {
    const { plane, picks, picker } = mount();
    picker.update(picking(START));

    pointer(plane, "pointerdown", IN_GAMUT.x, IN_GAMUT.y);
    expect(picks).toHaveLength(0);

    pointer(plane, "pointermove", 60, 60);
    expect(picks).toHaveLength(1);

    pointer(plane, "pointerup", 90, 150);
    const committed = picks[picks.length - 1];
    if (committed === undefined) throw new Error("expected a commit");

    // Take-off: the value that counts is the one under the lift, not the land.
    const expected = selectAtPlanePoint(planePointFromPointer(90, 150, PLANE_RECT), START.h);
    expect(expected).not.toBeNull();
    expect(oklchToCss(committed)).toBe(oklchToCss(expected ?? START));
  });

  it("restores the value on pointercancel without committing", () => {
    const { plane, picks, picker, cursor } = mount();
    picker.update(picking(START));
    const before = cursor.style.left;

    pointer(plane, "pointerdown", IN_GAMUT.x, IN_GAMUT.y);
    pointer(plane, "pointermove", 60, 60);
    const streamed = picks.length;
    pointer(plane, "pointercancel", 60, 60);

    // A cancelled gesture is not a lift, so nothing is committed and the cursor
    // goes back where it was.
    expect(picks).toHaveLength(streamed);
    expect(cursor.style.left).toBe(before);
  });

  it("is inert over the out-of-gamut region", () => {
    const { plane, picks, picker, cursor } = mount();
    picker.update(picking(START));

    pointer(plane, "pointerdown", OUT_OF_GAMUT.x, OUT_OF_GAMUT.y);
    const parked = cursor.style.left;
    pointer(plane, "pointermove", OUT_OF_GAMUT.x, OUT_OF_GAMUT.y);
    expect(picks).toHaveLength(0);
    expect(cursor.style.left).toBe(parked);

    // Dragging back into the live half picks up again.
    pointer(plane, "pointermove", IN_GAMUT.x, IN_GAMUT.y);
    expect(picks).toHaveLength(1);
  });

  it("ignores a drag that starts before picking", () => {
    const { plane, picks, picker } = mount();
    picker.update(stateWith({ phase: "memorize", guess: START }));
    pointer(plane, "pointerdown", IN_GAMUT.x, IN_GAMUT.y);
    pointer(plane, "pointerup", IN_GAMUT.x, IN_GAMUT.y);
    expect(picks).toHaveLength(0);
  });

  it("shows the loupe for touch only, and hides it on lift", () => {
    const { plane, loupe, picker } = mount();
    picker.update(picking(START));

    pointer(plane, "pointerdown", IN_GAMUT.x, IN_GAMUT.y, "mouse");
    expect(loupe.hidden).toBe(true);
    pointer(plane, "pointerup", IN_GAMUT.x, IN_GAMUT.y, "mouse");

    pointer(plane, "pointerdown", LOW_CONTACT.x, LOW_CONTACT.y, "touch");
    expect(loupe.hidden).toBe(false);
    // Offset above the contact point so the fingertip is not covering it.
    expect(Number.parseFloat(loupe.style.top)).toBeLessThan(LOW_CONTACT.y);
    expect(loupe.style.getPropertyValue("--fill-color")).not.toBe("");

    pointer(plane, "pointerup", LOW_CONTACT.x, LOW_CONTACT.y, "touch");
    expect(loupe.hidden).toBe(true);
  });

  it("does not let an incoming update fight the drag in progress", () => {
    const { plane, cursor, picker } = mount();
    picker.update(picking(START));

    pointer(plane, "pointerdown", IN_GAMUT.x, IN_GAMUT.y);
    pointer(plane, "pointermove", 120, 60);
    const dragged = cursor.style.left;

    // The frame loop keeps calling update with a state that has not caught up
    // with the PICK we just streamed.
    picker.update(picking(START));
    expect(cursor.style.left).toBe(dragged);
  });

  it("nudges with the arrow keys and takes shift as the coarse modifier", () => {
    const { plane, hue, picks, picker } = mount();
    const guess = oklch(0.5, 0.05, 270);
    picker.update(picking(guess));

    key(plane, "ArrowRight");
    key(hue, "ArrowRight", true);

    expect(picks).toHaveLength(2);
    const [fine, coarse] = picks;
    if (fine === undefined || coarse === undefined) throw new Error("expected two picks");
    expect(fine.c).toBeGreaterThan(guess.c);
    expect(coarse.h).toBeCloseTo(270 + HUE_NUDGE_DEG * COARSE_MULTIPLIER, 6);
  });

  it("leaves keys it does not own to the page", () => {
    const { plane, picks, picker } = mount();
    picker.update(picking(START));

    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    plane.dispatchEvent(event);

    expect(picks).toHaveLength(0);
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores the keyboard outside the picking phase", () => {
    const { plane, picks, picker } = mount();
    picker.update(stateWith({ phase: "reveal", guess: START }));
    key(plane, "ArrowRight");
    expect(picks).toHaveLength(0);
  });

  it("removes its nodes and stops listening on destroy", () => {
    const { slot, plane, picks, picker } = mount();
    picker.update(picking(START));
    picker.destroy();

    expect(slot.querySelector(".picker")).toBeNull();
    pointer(plane, "pointerdown", IN_GAMUT.x, IN_GAMUT.y);
    pointer(plane, "pointerup", IN_GAMUT.x, IN_GAMUT.y);
    key(plane, "ArrowRight");
    expect(picks).toHaveLength(0);
  });
});
