import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  labToXyz,
  linearToOklab,
  linearToSrgb,
  linearToXyz,
  OKLCH_HUE_EPSILON,
  oklabToLinear,
  oklabToOklch,
  oklchToLab,
  oklchToOklab,
  oklchToSrgb,
  srgbToLab,
  srgbToLinear,
  srgbToOklch,
  xyzToLab,
  xyzToLinear,
} from "@/color/convert";
import { parseHex } from "@/color/format";
import { lab, linearRgb, oklab, oklch, type Srgb, srgb, xyz } from "@/color/types";
import {
  OTTOSSON_XYZ_TO_OKLAB,
  SRGB_TO_LAB_D65,
  SRGB_TO_OKLAB,
  SRGB_TO_XYZ,
  W3C_CHAIN_CHECKS,
} from "@/color/vectors.fixture";

function fromHex(hex: string): Srgb {
  const parsed = parseHex(hex);
  if (parsed === null) throw new Error(`unparseable fixture hex: ${hex}`);
  return parsed;
}

const byte = fc.integer({ min: 0, max: 255 });

/** `Math.round` returns -0 for a tiny negative; normalize so 0 compares as 0. */
function toCode(channel: number): number {
  return Math.round(channel * 255) || 0;
}

describe("fixture provenance", () => {
  it("makes every VERIFIED fixture name a primary source", () => {
    // The guard against quietly promoting a computed baseline to a reference
    // value: if a table claims VERIFIED, it must say where it was retrieved
    // from. Everything else is a regression baseline and gets said so.
    const fixtures = [SRGB_TO_XYZ, SRGB_TO_LAB_D65, SRGB_TO_OKLAB, OTTOSSON_XYZ_TO_OKLAB];
    for (const fixture of fixtures) {
      if (fixture.provenance !== "VERIFIED") continue;
      expect(fixture.source).toMatch(/https?:\/\/|\(\d{4}\)|Ottosson|W3C|CSS Color/);
    }
    expect(W3C_CHAIN_CHECKS.provenance).toBe("VERIFIED");
  });
});

describe("sRGB transfer function", () => {
  it("uses 0.04045 to decode and 0.0031308 to encode — different numbers", () => {
    // If one constant were shared, 0.02 would take the linear branch on the way
    // back out and come to 0.2584 instead of the power-law value below.
    const encoded = linearToSrgb(linearRgb(0.02, 0.02, 0.02)).r;
    expect(encoded).toBeCloseTo(1.055 * 0.02 ** (1 / 2.4) - 0.055, 12);
    expect(encoded).not.toBeCloseTo(12.92 * 0.02, 3);

    // And symmetrically, 0.0031308 must decode through the *linear* branch.
    expect(srgbToLinear(srgb(0.0031308, 0, 0)).r).toBeCloseTo(0.0031308 / 12.92, 12);
  });

  it("is continuous at both breakpoints", () => {
    const decodedAtBreak = srgbToLinear(srgb(0.04045, 0, 0)).r;
    expect(decodedAtBreak).toBeCloseTo(((0.04045 + 0.055) / 1.055) ** 2.4, 8);

    // The encode breakpoint carries a real step of ~2.9e-8, because the sRGB
    // standard rounds the two thresholds independently rather than deriving one
    // from the other. It is far below an 8-bit code (0.0039); the assertion is
    // sized to notice a *wrong* constant, not to pretend the step is absent.
    const encodedAtBreak = linearToSrgb(linearRgb(0.0031308, 0, 0)).r;
    expect(Math.abs(encodedAtBreak - (1.055 * 0.0031308 ** (1 / 2.4) - 0.055))).toBeLessThan(1e-7);
  });

  it("mirrors through the origin instead of clamping", () => {
    expect(srgbToLinear(srgb(-0.5, -0.01, -2)).r).toBe(-srgbToLinear(srgb(0.5, 0, 0)).r);
    expect(srgbToLinear(srgb(-0.01, 0, 0)).r).toBe(-srgbToLinear(srgb(0.01, 0, 0)).r);
    expect(linearToSrgb(linearRgb(-0.5, 0, 0)).r).toBe(-linearToSrgb(linearRgb(0.5, 0, 0)).r);
    expect(linearToSrgb(linearRgb(-0.001, 0, 0)).r).toBe(-linearToSrgb(linearRgb(0.001, 0, 0)).r);
  });

  it("round-trips every 8-bit code exactly", () => {
    for (let v = 0; v < 256; v++) {
      const back = linearToSrgb(srgbToLinear(srgb(v / 255, v / 255, v / 255)));
      expect(toCode(back.r)).toBe(v);
    }
  });
});

describe("linear sRGB ↔ XYZ (D65)", () => {
  const { rows, tolerance } = SRGB_TO_XYZ;

  for (const row of rows) {
    it(`${row.name} decodes and projects to XYZ`, () => {
      const [r, g, b] = row.linear;
      const linear = srgbToLinear(fromHex(row.hex));
      expect(linear.r).toBeCloseTo(r, 8);
      expect(linear.g).toBeCloseTo(g, 8);
      expect(linear.b).toBeCloseTo(b, 8);

      const [x, y, z] = row.xyz;
      const projected = linearToXyz(linearRgb(r, g, b));
      expect(Math.abs(projected.x - x)).toBeLessThan(tolerance);
      expect(Math.abs(projected.y - y)).toBeLessThan(tolerance);
      expect(Math.abs(projected.z - z)).toBeLessThan(tolerance);
    });
  }

  it("sends white to the D65 white point the Lab conversion uses", () => {
    const white = linearToXyz(linearRgb(1, 1, 1));
    expect(white.x).toBeCloseTo(0.3127 / 0.329, 12);
    expect(white.y).toBeCloseTo(1, 12);
    expect(white.z).toBeCloseTo((1 - 0.3127 - 0.329) / 0.329, 12);
  });

  it("inverts itself", () => {
    fc.assert(
      fc.property(byte, byte, byte, (r, g, b) => {
        const linear = srgbToLinear(srgb(r / 255, g / 255, b / 255));
        const back = xyzToLinear(linearToXyz(linear));
        expect(back.r).toBeCloseTo(linear.r, 12);
        expect(back.g).toBeCloseTo(linear.g, 12);
        expect(back.b).toBeCloseTo(linear.b, 12);
      }),
    );
  });
});

describe("CIELab (D65, no adaptation)", () => {
  const { rows, tolerance } = SRGB_TO_LAB_D65;

  for (const row of rows) {
    it(`${row.name} converts to Lab`, () => {
      const actual = srgbToLab(fromHex(row.hex));
      expect(Math.abs(actual.L - row.L)).toBeLessThan(tolerance);
      expect(Math.abs(actual.a - row.a)).toBeLessThan(tolerance);
      expect(Math.abs(actual.b - row.b)).toBeLessThan(tolerance);

      const chroma = Math.hypot(actual.a, actual.b);
      expect(Math.abs(chroma - row.chroma)).toBeLessThan(tolerance);
      if (row.hue === null) expect(chroma).toBeLessThan(1e-9);
      else {
        const degrees = (Math.atan2(actual.b, actual.a) * 180) / Math.PI;
        expect(Math.abs((degrees < 0 ? degrees + 360 : degrees) - row.hue)).toBeLessThan(tolerance);
      }
    });
  }

  it("is D65, not the D50 that CSS lab() uses", () => {
    // The single most likely mistake in the whole chain. Both numbers are
    // "CIELab" for #0000FF; only the D65 one belongs in an sRGB scorer.
    const blue = srgbToLab(fromHex("#0000FF"));
    expect(blue.L).toBeCloseTo(32.300873, 5);
    expect(Math.abs(blue.L - 29.57)).toBeGreaterThan(2);
  });

  it("puts white at exactly (100, 0, 0) and black at exactly (0, 0, 0)", () => {
    const white = srgbToLab(srgb(1, 1, 1));
    expect(white.L).toBeCloseTo(100, 12);
    expect(white.a).toBeCloseTo(0, 12);
    expect(white.b).toBeCloseTo(0, 12);

    const black = srgbToLab(srgb(0, 0, 0));
    expect(black).toEqual({ L: 0, a: 0, b: 0 });
  });

  it("keeps every neutral exactly neutral", () => {
    for (let v = 0; v < 256; v++) {
      const neutral = srgbToLab(srgb(v / 255, v / 255, v / 255));
      expect(Math.abs(neutral.a)).toBeLessThan(1e-12);
      expect(Math.abs(neutral.b)).toBeLessThan(1e-12);
    }
  });

  it("preserves hue when linear light is scaled — the matrix really is linear", () => {
    const hue = (hex: string): number => {
      const { a, b } = srgbToLab(fromHex(hex));
      return Math.atan2(b, a);
    };
    expect(hue("#008080")).toBeCloseTo(hue("#00FFFF"), 12);
    expect(hue("#808000")).toBeCloseTo(hue("#FFFF00"), 12);
  });

  it("inverts through XYZ, on both the cube-root and the linear branch", () => {
    const samples = [lab(53.2, 80.1, 67.2), lab(5, -3, 2), lab(0.5, 0.2, -0.4), lab(100, 0, 0)];
    for (const sample of samples) {
      const back = xyzToLab(labToXyz(sample));
      expect(back.L).toBeCloseTo(sample.L, 10);
      expect(back.a).toBeCloseTo(sample.a, 10);
      expect(back.b).toBeCloseTo(sample.b, 10);
    }
  });
});

describe("OKLab", () => {
  for (const row of OTTOSSON_XYZ_TO_OKLAB.rows) {
    const [x, y, z] = row.xyz;
    it(`matches the published OKLab for XYZ (${x}, ${y}, ${z})`, () => {
      // Rows with a zero component are non-physical on purpose: they drive LMS
      // negative, which is NaN under `x ** (1/3)` and fine under Math.cbrt.
      const actual = linearToOklab(xyzToLinear(xyz(x, y, z)));
      const [L, a, b] = row.oklab;
      expect(Math.abs(actual.L - L)).toBeLessThan(OTTOSSON_XYZ_TO_OKLAB.tolerance);
      expect(Math.abs(actual.a - a)).toBeLessThan(OTTOSSON_XYZ_TO_OKLAB.tolerance);
      expect(Math.abs(actual.b - b)).toBeLessThan(OTTOSSON_XYZ_TO_OKLAB.tolerance);
    });
  }

  it("keeps greys neutral to double precision, which the blog matrices do not", () => {
    for (const hex of ["#FFFFFF", "#808080", "#C0C0C0", "#696969"]) {
      const { a, b } = linearToOklab(srgbToLinear(fromHex(hex)));
      expect(Math.abs(a)).toBeLessThan(1e-12);
      expect(Math.abs(b)).toBeLessThan(1e-12);
    }
  });

  it("inverts itself", () => {
    fc.assert(
      fc.property(byte, byte, byte, (r, g, b) => {
        const linear = srgbToLinear(srgb(r / 255, g / 255, b / 255));
        const back = oklabToLinear(linearToOklab(linear));
        expect(back.r).toBeCloseTo(linear.r, 12);
        expect(back.g).toBeCloseTo(linear.g, 12);
        expect(back.b).toBeCloseTo(linear.b, 12);
      }),
    );
  });
});

describe("OKLCh", () => {
  const { rows, tolerance } = SRGB_TO_OKLAB;

  for (const row of rows) {
    it(`${row.name} converts to OKLab/OKLCh`, () => {
      const actual = srgbToOklch(fromHex(row.hex));
      expect(Math.abs(actual.L - row.L)).toBeLessThan(tolerance);
      expect(Math.abs(actual.c - row.chroma)).toBeLessThan(tolerance);
      if (row.hue === null) expect(actual.c).toBeLessThan(OKLCH_HUE_EPSILON);
      else expect(Math.abs(actual.h - row.hue)).toBeLessThan(tolerance);

      const asOklab = oklchToOklab(actual);
      expect(Math.abs(asOklab.a - row.a)).toBeLessThan(tolerance);
      expect(Math.abs(asOklab.b - row.b)).toBeLessThan(tolerance);
    });
  }

  it("agrees with the two hues W3C publishes", () => {
    const { blue, yellow } = W3C_CHAIN_CHECKS;
    const actualBlue = srgbToOklch(fromHex(blue.hex));
    expect(actualBlue.L).toBeCloseTo(blue.L, 3);
    expect(actualBlue.c).toBeCloseTo(blue.chroma, 3);
    expect(Math.abs(actualBlue.h - blue.hue)).toBeLessThan(0.05);

    const actualYellow = srgbToOklch(fromHex(yellow.hex));
    expect(actualYellow.L).toBeCloseTo(yellow.L, 3);
    expect(actualYellow.c).toBeCloseTo(yellow.chroma, 3);
    expect(Math.abs(actualYellow.h - yellow.hue)).toBeLessThan(0.05);
  });

  it("reports a stable hue of 0 for a neutral rather than NaN or noise", () => {
    for (const hex of ["#000000", "#808080", "#FFFFFF"]) {
      const { h } = srgbToOklch(fromHex(hex));
      expect(h).toBe(0);
    }
    expect(oklabToOklch(oklab(0.5, -0, -0)).h).toBe(0);
    expect(oklabToOklch(oklab(0.5, -1e-9, -1e-9)).h).toBe(0);
  });

  it("puts hue in [0, 360) for every quadrant", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -0.4, max: 0.4, noNaN: true }),
        fc.double({ min: -0.4, max: 0.4, noNaN: true }),
        (a, b) => {
          const { h } = oklabToOklch(oklab(0.5, a, b));
          expect(h).toBeGreaterThanOrEqual(0);
          expect(h).toBeLessThan(360);
        },
      ),
    );
    // atan2 returns exactly ±180° on the negative real axis; that must land on
    // 180, not on 360 or -180.
    expect(oklabToOklch(oklab(0.5, -0.1, 0)).h).toBeCloseTo(180, 12);
    expect(oklabToOklch(oklab(0.5, -0.1, -0)).h).toBeCloseTo(180, 12);
  });

  it("round-trips OKLab ↔ OKLCh above the chroma epsilon", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: -0.4, max: 0.4, noNaN: true }),
        fc.double({ min: -0.4, max: 0.4, noNaN: true }),
        (L, a, b) => {
          fc.pre(Math.hypot(a, b) > OKLCH_HUE_EPSILON);
          const back = oklchToOklab(oklabToOklch(oklab(L, a, b)));
          expect(back.L).toBe(L);
          expect(back.a).toBeCloseTo(a, 12);
          expect(back.b).toBeCloseTo(b, 12);
        },
      ),
    );
  });
});

describe("composites", () => {
  it("round-trips the 8-bit cube through OKLCh without changing a single code", () => {
    fc.assert(
      fc.property(byte, byte, byte, (r, g, b) => {
        const original = srgb(r / 255, g / 255, b / 255);
        const back = oklchToSrgb(srgbToOklch(original));
        expect(toCode(back.r)).toBe(r);
        expect(toCode(back.g)).toBe(g);
        expect(toCode(back.b)).toBe(b);
        expect(back.r).toBeCloseTo(original.r, 10);
        expect(back.g).toBeCloseTo(original.g, 10);
        expect(back.b).toBeCloseTo(original.b, 10);
      }),
      { numRuns: 1000 },
    );
  });

  it("reaches the same Lab whether it starts from sRGB or from OKLCh", () => {
    for (const row of SRGB_TO_LAB_D65.rows) {
      const direct = srgbToLab(fromHex(row.hex));
      const viaOklch = oklchToLab(srgbToOklch(fromHex(row.hex)));
      expect(viaOklch.L).toBeCloseTo(direct.L, 9);
      expect(viaOklch.a).toBeCloseTo(direct.a, 9);
      expect(viaOklch.b).toBeCloseTo(direct.b, 9);
    }
  });

  it("holds a chosen OKLCh coordinate through the round trip", () => {
    const target = oklch(0.62, 0.18, 137.5);
    const back = srgbToOklch(oklchToSrgb(target));
    expect(back.L).toBeCloseTo(target.L, 10);
    expect(back.c).toBeCloseTo(target.c, 10);
    expect(back.h).toBeCloseTo(target.h, 10);
  });
});
