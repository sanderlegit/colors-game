import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { srgbToOklch } from "@/color/convert";
import { oklchToCss, parseHex, toHex } from "@/color/format";
import { oklch, srgb } from "@/color/types";
import { SRGB_TO_OKLAB } from "@/color/vectors.fixture";

const byte = fc.integer({ min: 0, max: 255 });

describe("toHex", () => {
  it("writes lowercase #rrggbb", () => {
    expect(toHex(srgb(0, 0, 0))).toBe("#000000");
    expect(toHex(srgb(1, 1, 1))).toBe("#ffffff");
    expect(toHex(srgb(1, 0, 0))).toBe("#ff0000");
    expect(toHex(srgb(102 / 255, 51 / 255, 153 / 255))).toBe("#663399");
  });

  it("pads single-digit channels", () => {
    expect(toHex(srgb(1 / 255, 10 / 255, 15 / 255))).toBe("#010a0f");
  });

  it("clamps channels a hex string cannot express", () => {
    expect(toHex(srgb(1.5, -0.2, 0.5))).toBe("#ff0080");
  });

  it("rounds to the nearest code", () => {
    expect(toHex(srgb(0.5, 0.5, 0.5))).toBe("#808080");
    expect(toHex(srgb(0.4999 / 255, 0, 0))).toBe("#000000");
    expect(toHex(srgb(0.5001 / 255, 0, 0))).toBe("#010000");
  });
});

describe("parseHex", () => {
  it("accepts the six-digit form in any case, with or without #", () => {
    const expected = srgb(102 / 255, 51 / 255, 153 / 255);
    expect(parseHex("#663399")).toEqual(expected);
    expect(parseHex("663399")).toEqual(expected);
    expect(parseHex("#663399".toUpperCase())).toEqual(expected);
    expect(parseHex("  #663399  ")).toEqual(expected);
    expect(parseHex("\t#663399\n")).toEqual(expected);
  });

  it("expands the three-digit form by doubling each digit", () => {
    expect(parseHex("#abc")).toEqual(parseHex("#aabbcc"));
    expect(parseHex("f00")).toEqual(srgb(1, 0, 0));
    expect(parseHex("#FFF")).toEqual(srgb(1, 1, 1));
  });

  it("returns null for anything else, without throwing", () => {
    for (const garbage of [
      "",
      "#",
      "   ",
      "nope",
      "#ab",
      "#abcd",
      "#abcde",
      "#abcdefa",
      "#abcdeg",
      "##abc",
      "#12345g",
      "0x663399",
      "rgb(1,2,3)",
      "#66 33 99",
      "-#663399",
    ]) {
      expect(parseHex(garbage)).toBeNull();
    }
  });

  it("rejects the alpha forms, which Srgb has no channel for", () => {
    expect(parseHex("#11223344")).toBeNull();
    expect(parseHex("#1234")).toBeNull();
  });

  it("round-trips with toHex over the whole 8-bit cube", () => {
    fc.assert(
      fc.property(byte, byte, byte, (r, g, b) => {
        const original = srgb(r / 255, g / 255, b / 255);
        expect(parseHex(toHex(original))).toEqual(original);
      }),
      { numRuns: 1000 },
    );
  });

  it("round-trips any well-formed hex string back to itself", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9a-f]{6}$/), (digits) => {
        const parsed = parseHex(`#${digits}`);
        expect(parsed).not.toBeNull();
        if (parsed !== null) expect(toHex(parsed)).toBe(`#${digits}`);
      }),
    );
  });
});

describe("oklchToCss", () => {
  it("emits a native oklch(L C H) triple", () => {
    expect(oklchToCss(oklch(0.5, 0.1, 200))).toBe("oklch(0.5 0.1 200)");
  });

  it("formats sRGB blue at the coordinates W3C publishes", () => {
    // W3C gives oklch(0.452 0.313 264.1); our unrounded values are
    // 0.45201372, 0.31321439, 264.052023.
    expect(oklchToCss(srgbToOklch(srgb(0, 0, 1)))).toBe("oklch(0.452 0.3132 264.05)");
  });

  it("drops trailing zeros rather than padding", () => {
    expect(oklchToCss(oklch(1, 0, 0))).toBe("oklch(1 0 0)");
    expect(oklchToCss(oklch(0.6, 0.12, 30))).toBe("oklch(0.6 0.12 30)");
  });

  it("produces a string every fixture colour can be described by", () => {
    const shape = /^oklch\(\d+(?:\.\d+)? \d+(?:\.\d+)? \d+(?:\.\d+)?\)$/;
    for (const row of SRGB_TO_OKLAB.rows) {
      expect(oklchToCss(srgbToOklch(srgb(0, 0, 0)))).toMatch(shape);
      expect(oklchToCss(oklch(row.L, row.chroma, row.hue ?? 0))).toMatch(shape);
    }
  });
});
