import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { linearToOklab, oklabToOklch, oklchToSrgb, srgbToOklch } from "@/color/convert";
import { parseHex } from "@/color/format";
import { clipChromaToGamut, isInGamut, maxChroma } from "@/color/gamut";
import { linearRgb, oklch, type Srgb, srgb } from "@/color/types";
import {
  MAX_CHROMA_HUES,
  MAX_CHROMA_TABLE,
  SRGB_TO_OKLAB,
  W3C_CHAIN_CHECKS,
} from "@/color/vectors.fixture";

function fromHex(hex: string): Srgb {
  const parsed = parseHex(hex);
  if (parsed === null) throw new Error(`unparseable fixture hex: ${hex}`);
  return parsed;
}

const lightness = fc.double({ min: 0.02, max: 0.98, noNaN: true });
const hue = fc.double({ min: 0, max: 359.999, noNaN: true });
const chroma = fc.double({ min: 0, max: 0.5, noNaN: true });

describe("isInGamut", () => {
  it("accepts every colour that came from an sRGB hex", () => {
    for (const row of SRGB_TO_OKLAB.rows) {
      expect(isInGamut(srgbToOklch(fromHex(row.hex)))).toBe(true);
    }
  });

  it("rejects chroma the gamut cannot reach", () => {
    // Nothing in sRGB exceeds C ≈ 0.322, and the teal/azure direction tops out
    // near 0.13 (color-science.md §5.2).
    expect(isInGamut(oklch(0.45, 0.45, 264))).toBe(false);
    expect(isInGamut(oklch(0.55, 0.2, 210))).toBe(false);
    expect(isInGamut(oklch(0.95, 0.3, 120))).toBe(false);
  });

  it("rejects lightness outside the cube regardless of chroma", () => {
    expect(isInGamut(oklch(1.2, 0, 0))).toBe(false);
    expect(isInGamut(oklch(-0.2, 0, 0))).toBe(false);
  });
});

describe("maxChroma", () => {
  for (const row of MAX_CHROMA_TABLE.rows) {
    it(`matches the measured gamut boundary at L = ${row.L}`, () => {
      for (const [index, expected] of row.chroma.entries()) {
        const h = MAX_CHROMA_HUES[index] ?? 0;
        const actual = maxChroma(row.L, h);
        expect(Math.abs(actual - expected)).toBeLessThan(MAX_CHROMA_TABLE.tolerance);
        // The direction matters more than the magnitude: overestimating would
        // generate targets that need clipping, which is the bug this function
        // exists to prevent. See the fixture's note on the low-L divergence.
        expect(actual - expected).toBeLessThan(1e-3);
      }
    });
  }

  it("is zero where only black and white live", () => {
    expect(maxChroma(0, 120)).toBe(0);
    expect(maxChroma(1, 120)).toBe(0);
    expect(maxChroma(-0.5, 120)).toBe(0);
    expect(maxChroma(1.5, 120)).toBe(0);
  });

  it("brackets the gamut boundary: just inside is in, just outside is out", () => {
    fc.assert(
      fc.property(lightness, hue, (L, h) => {
        const max = maxChroma(L, h);
        expect(isInGamut(oklch(L, max, h))).toBe(true);
        expect(isInGamut(oklch(L, max + 1e-3, h))).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});

describe("clipChromaToGamut", () => {
  it("leaves an in-gamut colour alone", () => {
    for (const row of SRGB_TO_OKLAB.rows) {
      const original = srgbToOklch(fromHex(row.hex));
      expect(clipChromaToGamut(original)).toEqual(original);
    }
  });

  it("preserves hue where clamping RGB channels would not", () => {
    // The CSS spec's worked example: linear-light (0.5, 1, 3) is out of gamut at
    // OKLCh hue 265.1°; clamping the blue channel to 1 drags it to 196.1°.
    const { clampingDemo } = W3C_CHAIN_CHECKS;
    const [r, g, b] = clampingDemo.outOfGamutLinear;
    const [cr, cg, cb] = clampingDemo.clampedLinear;
    const outOfGamut = oklabToOklch(linearToOklab(linearRgb(r, g, b)));
    const clamped = oklabToOklch(linearToOklab(linearRgb(cr, cg, cb)));

    expect(Math.abs(outOfGamut.h - clampingDemo.outOfGamutHue)).toBeLessThan(
      clampingDemo.tolerance,
    );
    expect(Math.abs(clamped.h - clampingDemo.clampedHue)).toBeLessThan(clampingDemo.tolerance);

    expect(isInGamut(outOfGamut)).toBe(false);
    expect(Math.abs(outOfGamut.h - clamped.h)).toBeGreaterThan(60);
    // That colour is also brighter than white (L = 1.019), so it is the one
    // case where chroma reduction cannot help; see the lightness test below.
    expect(outOfGamut.L).toBeGreaterThan(1);
  });

  it("reduces chroma at constant hue instead of moving the colour sideways", () => {
    // Same hue as the spec's example, at a lightness chroma reduction can serve.
    const wanted = oklch(0.55, 0.36, 265.1);
    expect(isInGamut(wanted)).toBe(false);

    const clipped = clipChromaToGamut(wanted);
    expect(isInGamut(clipped)).toBe(true);
    expect(clipped.L).toBe(wanted.L);
    expect(clipped.h).toBe(wanted.h);
    expect(clipped.c).toBeLessThan(wanted.c);

    // Channel clamping moves the hue even here, where the excursion is small —
    // the 69° in the W3C example above is the same defect at full stretch.
    const raw = oklchToSrgb(wanted);
    const clampChannel = (v: number): number => Math.min(1, Math.max(0, v));
    const clampedHue = srgbToOklch(
      srgb(clampChannel(raw.r), clampChannel(raw.g), clampChannel(raw.b)),
    ).h;
    expect(clampedHue).not.toBe(wanted.h);
    expect(clipped.h).toBe(wanted.h);
  });

  it("clamps lightness only where no chroma could rescue it", () => {
    expect(clipChromaToGamut(oklch(1.4, 0.2, 30))).toEqual(oklch(1, 0, 30));
    expect(clipChromaToGamut(oklch(-0.4, 0.2, 30))).toEqual(oklch(0, 0, 30));
    expect(isInGamut(clipChromaToGamut(oklch(1.4, 0.2, 30)))).toBe(true);
    expect(isInGamut(clipChromaToGamut(oklch(-0.4, 0.2, 30)))).toBe(true);
  });

  it("always returns an in-gamut colour, at the same L and h", () => {
    fc.assert(
      fc.property(lightness, chroma, hue, (L, c, h) => {
        const clipped = clipChromaToGamut(oklch(L, c, h));
        expect(isInGamut(clipped)).toBe(true);
        expect(clipped.L).toBe(L);
        expect(clipped.h).toBe(h);
        expect(clipped.c).toBeLessThanOrEqual(c);
      }),
      { numRuns: 300 },
    );
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(lightness, chroma, hue, (L, c, h) => {
        const once = clipChromaToGamut(oklch(L, c, h));
        expect(clipChromaToGamut(once)).toEqual(once);
      }),
      { numRuns: 200 },
    );
  });

  it("lands on colours a display can actually show", () => {
    fc.assert(
      fc.property(lightness, chroma, hue, (L, c, h) => {
        const { r, g, b } = oklchToSrgb(clipChromaToGamut(oklch(L, c, h)));
        for (const channel of [r, g, b]) {
          expect(Math.round(channel * 255)).toBeGreaterThanOrEqual(0);
          expect(Math.round(channel * 255)).toBeLessThanOrEqual(255);
        }
      }),
      { numRuns: 200 },
    );
  });
});
