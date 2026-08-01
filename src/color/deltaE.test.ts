import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { srgbToLab } from "@/color/convert";
import { ciede2000, deltaEOk } from "@/color/deltaE";
import { parseHex } from "@/color/format";
import { lab, oklab } from "@/color/types";
import { SHARMA_CIEDE2000, SRGB_TO_LAB_D65 } from "@/color/vectors.fixture";

const labArb = fc.record({
  L: fc.double({ min: 0, max: 100, noNaN: true }),
  a: fc.double({ min: -128, max: 128, noNaN: true }),
  b: fc.double({ min: -128, max: 128, noNaN: true }),
});

function labFromHex(hex: string) {
  const parsed = parseHex(hex);
  if (parsed === null) throw new Error(`unparseable fixture hex: ${hex}`);
  return srgbToLab(parsed);
}

describe("ciede2000 — Sharma, Wu & Dalal 34-pair set", () => {
  const { rows, tolerance } = SHARMA_CIEDE2000;

  for (const [index, row] of rows.entries()) {
    const [L1, a1, b1, L2, a2, b2, expected] = row;
    it(`pair ${index + 1} is ${expected.toFixed(4)}`, () => {
      expect(ciede2000(lab(L1, a1, b1), lab(L2, a2, b2))).toBeCloseTo(expected, 4);
    });
  }

  it("is within the published rounding limit on every row", () => {
    const worst = rows.reduce((max, [L1, a1, b1, L2, a2, b2, expected]) => {
      const actual = ciede2000(lab(L1, a1, b1), lab(L2, a2, b2));
      return Math.max(max, Math.abs(actual - expected));
    }, 0);
    expect(worst).toBeLessThan(tolerance);
  });

  it("is exactly symmetric on every row", () => {
    // The cheapest test that catches abs(ΔC′) / abs(ΔH′) — but only necessary,
    // not sufficient: abs() on *both* is symmetric and still wrong, which is
    // what the 34 expected values above are for.
    for (const [L1, a1, b1, L2, a2, b2] of rows) {
      const forward = ciede2000(lab(L1, a1, b1), lab(L2, a2, b2));
      const backward = ciede2000(lab(L2, a2, b2), lab(L1, a1, b1));
      expect(backward).toBe(forward);
    }
  });
});

describe("ciede2000 — anchors", () => {
  it("is exactly zero for a colour against itself", () => {
    for (const row of SRGB_TO_LAB_D65.rows) {
      expect(ciede2000(labFromHex(row.hex), labFromHex(row.hex))).toBe(0);
    }
  });

  it("is exactly 100 for black against white", () => {
    // Analytically certain, not a baseline: ΔL′ = 100 and C′ = 0 force S_L = 1.
    expect(ciede2000(lab(0, 0, 0), lab(100, 0, 0))).toBe(100);
  });

  it("reproduces the measured primary-pair distances", () => {
    // color-science.md §1.4, measured to 1 decimal place.
    expect(ciede2000(labFromHex("#0000FF"), labFromHex("#FFFF00"))).toBeCloseTo(103.4, 1);
    expect(ciede2000(labFromHex("#FF0000"), labFromHex("#00FF00"))).toBeCloseTo(86.6, 1);
  });

  it("never returns NaN when one colour is exactly neutral", () => {
    // C′₁·C′₂ = 0 has its own Δh′ and h̄′ cases; missing them divides by zero.
    for (const row of SRGB_TO_LAB_D65.rows) {
      expect(Number.isNaN(ciede2000(lab(50, 0, 0), labFromHex(row.hex)))).toBe(false);
    }
  });
});

describe("ciede2000 — properties", () => {
  it("is symmetric for arbitrary Lab pairs", () => {
    fc.assert(
      fc.property(labArb, labArb, (x, y) => {
        const p = lab(x.L, x.a, x.b);
        const q = lab(y.L, y.a, y.b);
        expect(ciede2000(p, q)).toBe(ciede2000(q, p));
      }),
    );
  });

  it("is zero exactly on the diagonal", () => {
    fc.assert(
      fc.property(labArb, (x) => {
        expect(ciede2000(lab(x.L, x.a, x.b), lab(x.L, x.a, x.b))).toBe(0);
      }),
    );
  });

  it("is finite and non-negative", () => {
    fc.assert(
      fc.property(labArb, labArb, (x, y) => {
        const d = ciede2000(lab(x.L, x.a, x.b), lab(y.L, y.a, y.b));
        expect(Number.isFinite(d)).toBe(true);
        expect(d).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});

describe("deltaEOk", () => {
  it("is the Euclidean distance in OKLab", () => {
    expect(deltaEOk(oklab(0.5, 0.1, 0.2), oklab(0.5, 0.4, 0.6))).toBeCloseTo(0.5, 12);
  });

  it("is exactly 1 from black to white", () => {
    expect(deltaEOk(oklab(0, 0, 0), oklab(1, 0, 0))).toBe(1);
  });

  it("is symmetric and zero on the diagonal", () => {
    const oklabArb = fc.record({
      L: fc.double({ min: 0, max: 1, noNaN: true }),
      a: fc.double({ min: -0.5, max: 0.5, noNaN: true }),
      b: fc.double({ min: -0.5, max: 0.5, noNaN: true }),
    });
    fc.assert(
      fc.property(oklabArb, oklabArb, (x, y) => {
        const p = oklab(x.L, x.a, x.b);
        const q = oklab(y.L, y.a, y.b);
        expect(deltaEOk(p, q)).toBe(deltaEOk(q, p));
        expect(deltaEOk(p, p)).toBe(0);
      }),
    );
  });
});
