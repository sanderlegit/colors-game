import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { oklchToSrgb } from "@/color/convert";
import { oklchToCss } from "@/color/format";
import { isInGamut, maxChroma } from "@/color/gamut";
import { type Oklch, oklch } from "@/color/types";
import type { GameState } from "@/domain/state";
import { initialState } from "@/domain/state";
import {
  CHROMA_FRACTION_NUDGE,
  COARSE_MULTIPLIER,
  createPicker,
  DRAFT_SAMPLES,
  FINAL_SAMPLES,
  HUE_NUDGE_DEG,
  LIGHTNESS_NUDGE,
  lightnessFromPointer,
  lightnessTrackGradient,
  nudgeInPlane,
  nudgeLightness,
  type PlaneContext,
  type PlanePoint,
  planeFraction,
  planePointForColor,
  planePointFromPointer,
  planePointToOklch,
  type Rect,
  renderPlanePixels,
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

describe("planePointFromPointer", () => {
  it("puts hue on x and the chroma fraction on y, saturated at the top", () => {
    expect(planePointFromPointer(0, 200, RECT)).toEqual({ h: 0, t: 0 });
    expect(planePointFromPointer(150, 0, RECT)).toEqual({ h: 180, t: 1 });
    expect(planePointFromPointer(75, 100, RECT)).toEqual({ h: 90, t: 0.5 });
  });

  it("wraps the right edge onto the left — the hue axis is a circle", () => {
    expect(planePointFromPointer(300, 100, RECT).h).toBe(0);
  });

  it("honours the rect origin and clamps outside it", () => {
    const offset: Rect = { left: 40, top: 10, width: 300, height: 200 };
    expect(planePointFromPointer(190, 110, offset)).toEqual({ h: 180, t: 0.5 });
    expect(planePointFromPointer(-100, 999, offset)).toEqual({ h: 0, t: 0 });
    expect(planePointFromPointer(9999, -999, offset)).toEqual({ h: 0, t: 1 });
  });

  it("survives a zero-sized rect", () => {
    expect(planePointFromPointer(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({
      h: 0,
      t: 0,
    });
  });
});

describe("plane ↔ OKLCh", () => {
  it("round-trips a plane position through a colour", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 359.99, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0.05, max: 0.95, noNaN: true }),
        (h, t, L) => {
          const back = planePointForColor(planePointToOklch({ h, t }, L));
          expect(back.h).toBeCloseTo(h, 10);
          expect(back.t).toBeCloseTo(t, 10);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("takes chroma as a fraction of what the gamut offers at (L, h)", () => {
    const color = planePointToOklch({ h: 270, t: 0.5 }, 0.25);
    expect(color.L).toBe(0.25);
    expect(color.h).toBe(270);
    expect(color.c).toBeCloseTo(0.5 * maxChroma(0.25, 270), 12);
  });

  it("puts neutral grey along the bottom edge at every hue", () => {
    for (let h = 0; h < 360; h += 30) {
      expect(planePointToOklch({ h, t: 0 }, 0.5).c).toBe(0);
    }
  });
});

describe("the plane is in gamut everywhere (ADR 0007)", () => {
  it("never names a colour sRGB cannot show", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 359.99, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0.02, max: 0.98, noNaN: true }),
        (h, t, L) => {
          expect(isInGamut(planePointToOklch({ h, t }, L))).toBe(true);
        },
      ),
      { numRuns: 150 },
    );
  });

  it("has no dead zone: the top corners select like anywhere else", () => {
    // The whole rectangle is live, which is the point of the fraction axis —
    // ADR 0005's inert region covered ~half the plane and is gone.
    for (const point of [
      { h: 0, t: 1 },
      { h: 359.9, t: 1 },
      { h: 200, t: 1 },
      { h: 90, t: 1 },
    ] satisfies PlanePoint[]) {
      expect(isInGamut(planePointToOklch(point, 0.95))).toBe(true);
      expect(isInGamut(planePointToOklch(point, 0.05))).toBe(true);
    }
  });

  it("maps distinct positions to distinct colours across the full width", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const key = oklchToCss(planePointToOklch({ h: (i / 40) * 360, t: 0.8 }, 0.6));
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(40);
  });

  it("raises chroma monotonically up the y axis", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 359.99, noNaN: true }),
        fc.double({ min: 0.1, max: 0.9, noNaN: true }),
        (h, L) => {
          let previous = -1;
          for (let i = 0; i <= 10; i += 1) {
            const c = planePointToOklch({ h, t: i / 10 }, L).c;
            expect(c).toBeGreaterThanOrEqual(previous);
            previous = c;
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe("planeFraction", () => {
  it("places hue across the width and t upward from the bottom", () => {
    expect(planeFraction({ h: 0, t: 0 })).toEqual({ x: 0, y: 1 });
    expect(planeFraction({ h: 180, t: 1 })).toEqual({ x: 0.5, y: 0 });
    expect(planeFraction({ h: 90, t: 0.25 })).toEqual({ x: 0.25, y: 0.75 });
  });

  it("inverts planePointFromPointer on the unit rect", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 299.99, noNaN: true }),
        fc.double({ min: 0, max: 200, noNaN: true }),
        (x, y) => {
          const at = planeFraction(planePointFromPointer(x, y, RECT));
          expect(at.x * RECT.width).toBeCloseTo(x, 8);
          expect(at.y * RECT.height).toBeCloseTo(y, 8);
        },
      ),
      { numRuns: 80 },
    );
  });
});

describe("lightnessFromPointer", () => {
  it("runs dim to bright across the bar", () => {
    const bar: Rect = { left: 0, top: 200, width: 300, height: 44 };
    expect(lightnessFromPointer(0, bar)).toBe(0);
    expect(lightnessFromPointer(150, bar)).toBe(0.5);
    expect(lightnessFromPointer(300, bar)).toBe(1);
    expect(lightnessFromPointer(-50, bar)).toBe(0);
    expect(lightnessFromPointer(9999, bar)).toBe(1);
    expect(lightnessFromPointer(10, { left: 0, top: 0, width: 0, height: 0 })).toBe(0);
  });
});

describe("nudgeInPlane", () => {
  const base = planePointToOklch({ h: 270, t: 0.5 }, 0.5);

  it("ignores keys it does not own", () => {
    expect(nudgeInPlane(base, "Enter", false)).toBeNull();
    expect(nudgeInPlane(base, "a", false)).toBeNull();
  });

  it("moves hue sideways, one step per arrow and ten with shift", () => {
    const right = nudgeInPlane(base, "ArrowRight", false);
    const coarse = nudgeInPlane(base, "ArrowRight", true);
    const left = nudgeInPlane(base, "ArrowLeft", false);
    if (right === null || coarse === null || left === null) throw new Error("expected a move");

    expect(right.h).toBeCloseTo(270 + HUE_NUDGE_DEG, 10);
    expect(coarse.h).toBeCloseTo(270 + HUE_NUDGE_DEG * COARSE_MULTIPLIER, 10);
    expect(left.h).toBeCloseTo(270 - HUE_NUDGE_DEG, 10);
    expect(right.L).toBe(base.L);
  });

  it("keeps the chroma fraction across a hue move rather than the chroma", () => {
    const right = nudgeInPlane(base, "ArrowRight", true);
    if (right === null) throw new Error("expected a move");
    expect(planePointForColor(right).t).toBeCloseTo(0.5, 10);
  });

  it("wraps across the seam", () => {
    const near = planePointToOklch({ h: 359.8, t: 0.5 }, 0.5);
    const next = nudgeInPlane(near, "ArrowRight", false);
    if (next === null) throw new Error("expected a move");
    expect(next.h).toBeCloseTo(0.3, 8);
  });

  it("moves the chroma fraction on the vertical arrows", () => {
    const up = nudgeInPlane(base, "ArrowUp", false);
    const down = nudgeInPlane(base, "ArrowDown", false);
    if (up === null || down === null) throw new Error("expected a move");
    expect(planePointForColor(up).t).toBeCloseTo(0.5 + CHROMA_FRACTION_NUDGE, 8);
    expect(planePointForColor(down).t).toBeCloseTo(0.5 - CHROMA_FRACTION_NUDGE, 8);
    expect(up.h).toBe(base.h);
  });

  it("reports no move at the top and bottom of the plane", () => {
    expect(nudgeInPlane(planePointToOklch({ h: 270, t: 1 }, 0.5), "ArrowUp", false)).toBeNull();
    expect(nudgeInPlane(planePointToOklch({ h: 270, t: 0 }, 0.5), "ArrowDown", false)).toBeNull();
  });

  it("stays in gamut wherever it walks", () => {
    let color = planePointToOklch({ h: 200, t: 0.99 }, 0.5);
    for (let i = 0; i < 60; i += 1) {
      const next = nudgeInPlane(color, "ArrowRight", true) ?? nudgeInPlane(color, "ArrowUp", true);
      if (next === null) break;
      color = next;
      expect(isInGamut(color)).toBe(true);
    }
  });
});

describe("nudgeLightness", () => {
  const anchor: PlanePoint = { h: 270, t: 0.9 };
  const base = planePointToOklch(anchor, 0.55);

  it("moves one step per arrow, ten with shift", () => {
    const right = nudgeLightness(base, anchor, "ArrowRight", false);
    const coarse = nudgeLightness(base, anchor, "ArrowRight", true);
    if (right === null || coarse === null) throw new Error("expected a move");
    expect(right.L).toBeCloseTo(0.55 + LIGHTNESS_NUDGE, 10);
    expect(coarse.L).toBeCloseTo(0.55 + LIGHTNESS_NUDGE * COARSE_MULTIPLIER, 10);
    expect(right.h).toBe(base.h);
  });

  it("stops at both ends of the bar", () => {
    const white = planePointToOklch(anchor, 1);
    const black = planePointToOklch(anchor, 0);
    expect(nudgeLightness(white, anchor, "ArrowRight", false)).toBeNull();
    expect(nudgeLightness(black, anchor, "ArrowLeft", false)).toBeNull();
  });

  it("rebuilds chroma from the anchor, so a trip to white does not drain it", () => {
    // At L = 1 every colour is white and the fraction is unrecoverable from the
    // guess. Rebuilding from the anchor is what lets the player come back down
    // to the saturation they had, instead of to grey.
    const coarse = LIGHTNESS_NUDGE * COARSE_MULTIPLIER;
    let color = base;
    for (let i = 0; i < 60; i += 1) {
      color = nudgeLightness(color, anchor, "ArrowRight", true) ?? color;
    }
    expect(color.L).toBe(1);
    expect(color.c).toBe(0);

    for (let i = 0; i < 20; i += 1) {
      color = nudgeLightness(color, anchor, "ArrowLeft", true) ?? color;
    }
    expect(color.L).toBeCloseTo(1 - 20 * coarse, 8);
    expect(planePointForColor(color).t).toBeCloseTo(anchor.t, 8);
  });

  it("keeps the guess's own hue — the plane owns that axis", () => {
    const moved = oklch(base.L, base.c, 30);
    const next = nudgeLightness(moved, anchor, "ArrowRight", false);
    if (next === null) throw new Error("expected a move");
    expect(next.h).toBe(30);
  });

  it("ignores keys it does not own", () => {
    expect(nudgeLightness(base, anchor, "Home", false)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Pure painting                                                              */
/* -------------------------------------------------------------------------- */

describe("renderPlanePixels", () => {
  it("returns an empty buffer for a zero-sized canvas", () => {
    expect(renderPlanePixels(0, 10, 0.5, FINAL_SAMPLES)).toHaveLength(0);
    expect(renderPlanePixels(10, 0, 0.5, FINAL_SAMPLES)).toHaveLength(0);
  });

  it("fills exactly one RGBA quad per pixel", () => {
    expect(renderPlanePixels(8, 6, 0.5, FINAL_SAMPLES)).toHaveLength(8 * 6 * 4);
  });

  it("paints each pixel the colour that pixel selects", () => {
    const width = 40;
    const height = 20;
    const L = 0.5;
    const pixels = renderPlanePixels(width, height, L, FINAL_SAMPLES);

    const x = 11;
    const y = 6;
    const point: PlanePoint = { h: ((x + 0.5) / width) * 360, t: 1 - (y + 0.5) / height };
    const expected = oklchToSrgb(planePointToOklch(point, L));
    const i = (y * width + x) * 4;

    expect(pixels[i + 3]).toBe(255);
    expect(pixels[i]).toBeCloseTo(Math.round(expected.r * 255), -0.4);
    expect(pixels[i + 1]).toBeCloseTo(Math.round(expected.g * 255), -0.4);
    expect(pixels[i + 2]).toBeCloseTo(Math.round(expected.b * 255), -0.4);
  });

  it("leaves no inert pixel: every one is fully opaque", () => {
    // ADR 0007: with chroma expressed as a fraction there is nothing to hatch.
    const pixels = renderPlanePixels(40, 20, 0.5, FINAL_SAMPLES);
    for (let i = 3; i < pixels.length; i += 4) expect(pixels[i]).toBe(255);
  });

  it("greys out along the bottom row and saturates towards the top", () => {
    const width = 24;
    const height = 24;
    const pixels = renderPlanePixels(width, height, 0.6, FINAL_SAMPLES);
    const spread = (x: number, y: number): number => {
      const i = (y * width + x) * 4;
      const channels = [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0];
      return Math.max(...channels) - Math.min(...channels);
    };

    // The lattice samples the bottom row at t ≈ 1/48 rather than exactly 0, so
    // "grey" is a couple of code values wide, not identically neutral.
    for (const x of [0, 6, 12, 18]) {
      expect(spread(x, height - 1)).toBeLessThanOrEqual(5);
      expect(spread(x, 0)).toBeGreaterThan(50);
    }
  });

  it("keeps the sample lattice inside its budget", () => {
    // The draft pass exists so a lightness drag stays interactive; if it ever
    // sampled per-pixel the drag would run at ~15fps.
    const wide = renderPlanePixels(400, 400, 0.5, DRAFT_SAMPLES);
    expect(wide).toHaveLength(400 * 400 * 4);
  });
});

describe("lightnessTrackGradient", () => {
  it("sweeps the current hue and chroma fraction from black to white", () => {
    const track = lightnessTrackGradient(planePointToOklch({ h: 30, t: 0.9 }, 0.5));
    expect(track.startsWith("linear-gradient(to right, ")).toBe(true);
    expect(track.split("oklch(")).toHaveLength(14);
    expect(track).toContain("oklch(0 0 30) 0.00%");
    expect(track).toContain("oklch(1 0 30) 100.00%");
  });

  it("recolours with the hue the player is on", () => {
    const warm = lightnessTrackGradient(planePointToOklch({ h: 30, t: 0.9 }, 0.5));
    const cool = lightnessTrackGradient(planePointToOklch({ h: 240, t: 0.9 }, 0.5));
    expect(warm).not.toBe(cool);
  });
});

/* -------------------------------------------------------------------------- */
/* DOM wrapper                                                                */
/* -------------------------------------------------------------------------- */

const PLANE_RECT: Rect = { left: 0, top: 0, width: 300, height: 200 };
const BAR_RECT: Rect = { left: 0, top: 200, width: 300, height: 44 };

function measure(node: HTMLElement): Rect {
  return node.classList.contains("picker-lightness") ? BAR_RECT : PLANE_RECT;
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
  readonly bar: HTMLElement;
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
    bar: must(slot.querySelector<HTMLElement>(".picker-lightness")),
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

/** Mid-plane: a mid hue at a mid chroma fraction. */
const MIDDLE = { x: 30, y: 100 };
/** The most saturated corner — inert under ADR 0005, live now. */
const TOP_RIGHT = { x: 298, y: 2 };
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

  it("mounts a canvas plane, a cursor and a lightness bar", () => {
    const { slot, bar } = mount();
    expect(slot.querySelector(".picker-plane-canvas")).not.toBeNull();
    expect(slot.querySelector(".picker-cursor")).not.toBeNull();
    expect(slot.querySelector(".picker-lightness-track")).not.toBeNull();
    expect(bar.getAttribute("role")).toBe("slider");
    expect(bar.getAttribute("aria-label")).toBe("Lightness");
    expect(bar.getAttribute("aria-valuemax")).toBe("1");
  });

  it("is only focusable while picking", () => {
    const { plane, bar, picker } = mount();
    picker.update(stateWith({ phase: "memorize", guess: START }));
    expect(plane.tabIndex).toBe(-1);
    expect(bar.tabIndex).toBe(-1);

    picker.update(picking(START));
    expect(plane.tabIndex).toBe(0);
    expect(bar.tabIndex).toBe(0);

    picker.update(stateWith({ phase: "reveal", guess: START }));
    expect(plane.tabIndex).toBe(-1);
  });

  it("renders the guess through a custom property, not style.background", () => {
    const { cursor, bar, picker } = mount();
    const guess = planePointToOklch({ h: 120, t: 0.5 }, 0.6);
    picker.update(picking(guess));

    expect(cursor.style.getPropertyValue("--fill-color")).toBe(oklchToCss(guess));
    expect(cursor.style.left).toBe(`${((120 / 360) * 100).toFixed(3)}%`);
    expect(bar.getAttribute("aria-valuenow")).toBe("0.600");
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

  it("repaints on a lightness change and never on a plane drag", () => {
    const { plane, bar, surface, picker } = mount();
    picker.update(picking(START));
    const afterMount = surface.paints;
    expect(afterMount).toBeGreaterThan(0);

    pointer(plane, "pointerdown", MIDDLE.x, MIDDLE.y);
    pointer(plane, "pointermove", 60, 80);
    pointer(plane, "pointermove", 90, 120);
    pointer(plane, "pointerup", 90, 120);
    expect(surface.paints).toBe(afterMount);

    pointer(bar, "pointerdown", 150, 220);
    pointer(bar, "pointermove", 220, 220);
    expect(surface.paints).toBeGreaterThan(afterMount);
  });

  it("does not commit on pointer-down and commits the value at lift", () => {
    const { plane, picks, picker } = mount();
    picker.update(picking(START));

    pointer(plane, "pointerdown", MIDDLE.x, MIDDLE.y);
    expect(picks).toHaveLength(0);

    pointer(plane, "pointermove", 60, 60);
    expect(picks).toHaveLength(1);

    pointer(plane, "pointerup", 90, 150);
    const committed = picks[picks.length - 1];
    if (committed === undefined) throw new Error("expected a commit");

    // Take-off: the value that counts is the one under the lift, not the land.
    const expected = planePointToOklch(planePointFromPointer(90, 150, PLANE_RECT), START.L);
    expect(oklchToCss(committed)).toBe(oklchToCss(expected));
  });

  it("restores the value on pointercancel without committing", () => {
    const { plane, picks, picker, cursor } = mount();
    picker.update(picking(START));
    const before = cursor.style.left;

    pointer(plane, "pointerdown", MIDDLE.x, MIDDLE.y);
    pointer(plane, "pointermove", 60, 60);
    const streamed = picks.length;
    pointer(plane, "pointercancel", 60, 60);

    // A cancelled gesture is not a lift, so nothing is committed and the cursor
    // goes back where it was.
    expect(picks).toHaveLength(streamed);
    expect(cursor.style.left).toBe(before);
  });

  it("selects everywhere in the plane, including the saturated corner", () => {
    const { plane, picks, picker, cursor } = mount();
    picker.update(picking(START));

    pointer(plane, "pointerdown", TOP_RIGHT.x, TOP_RIGHT.y);
    pointer(plane, "pointermove", TOP_RIGHT.x, TOP_RIGHT.y);
    expect(picks).toHaveLength(1);
    expect(cursor.style.top).toBe(`${((TOP_RIGHT.y / PLANE_RECT.height) * 100).toFixed(3)}%`);

    const picked = picks[0];
    if (picked === undefined) throw new Error("expected a pick");
    expect(isInGamut(picked)).toBe(true);
  });

  it("carries the chroma fraction through a lightness drag", () => {
    const { plane, bar, picks, picker } = mount();
    picker.update(picking(START));

    pointer(plane, "pointerdown", 200, 40);
    pointer(plane, "pointerup", 200, 40);
    const inPlane = picks[picks.length - 1];
    if (inPlane === undefined) throw new Error("expected a pick");

    pointer(bar, "pointerdown", 240, 220);
    pointer(bar, "pointerup", 240, 220);
    const brighter = picks[picks.length - 1];
    if (brighter === undefined) throw new Error("expected a pick");

    expect(brighter.L).toBeCloseTo(0.8, 10);
    expect(brighter.h).toBeCloseTo(inPlane.h, 10);
    expect(planePointForColor(brighter).t).toBeCloseTo(planePointForColor(inPlane).t, 8);
    expect(isInGamut(brighter)).toBe(true);
  });

  it("ignores a drag that starts before picking", () => {
    const { plane, picks, picker } = mount();
    picker.update(stateWith({ phase: "memorize", guess: START }));
    pointer(plane, "pointerdown", MIDDLE.x, MIDDLE.y);
    pointer(plane, "pointerup", MIDDLE.x, MIDDLE.y);
    expect(picks).toHaveLength(0);
  });

  it("shows the loupe for touch only, and hides it on lift", () => {
    const { plane, loupe, picker } = mount();
    picker.update(picking(START));

    pointer(plane, "pointerdown", MIDDLE.x, MIDDLE.y, "mouse");
    expect(loupe.hidden).toBe(true);
    pointer(plane, "pointerup", MIDDLE.x, MIDDLE.y, "mouse");

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

    pointer(plane, "pointerdown", MIDDLE.x, MIDDLE.y);
    pointer(plane, "pointermove", 120, 60);
    const dragged = cursor.style.left;

    // The frame loop keeps calling update with a state that has not caught up
    // with the PICK we just streamed.
    picker.update(picking(START));
    expect(cursor.style.left).toBe(dragged);
  });

  it("nudges with the arrow keys and takes shift as the coarse modifier", () => {
    const { plane, bar, picks, picker } = mount();
    const guess = planePointToOklch({ h: 270, t: 0.5 }, 0.5);
    picker.update(picking(guess));

    key(plane, "ArrowRight");
    key(bar, "ArrowRight", true);

    expect(picks).toHaveLength(2);
    const [fine, coarse] = picks;
    if (fine === undefined || coarse === undefined) throw new Error("expected two picks");
    expect(fine.h).toBeCloseTo(270 + HUE_NUDGE_DEG, 6);
    expect(coarse.L).toBeCloseTo(0.5 + LIGHTNESS_NUDGE * COARSE_MULTIPLIER, 6);
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
    pointer(plane, "pointerdown", MIDDLE.x, MIDDLE.y);
    pointer(plane, "pointerup", MIDDLE.x, MIDDLE.y);
    key(plane, "ArrowRight");
    expect(picks).toHaveLength(0);
  });
});
