import { describe, expect, it } from "vitest";

import {
  asArray,
  asBoundedNumber,
  asEnum,
  asFiniteNumber,
  asRecord,
  asString,
  booleanField,
  numberField,
  parseRecord,
} from "@/shared/decode";

describe("asRecord", () => {
  it("accepts a plain object", () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
  });

  it.each([
    ["null", null],
    ["an array", [1, 2]],
    ["a string", "x"],
    ["a number", 1],
    ["undefined", undefined],
  ])("rejects %s", (_label, value) => {
    expect(asRecord(value)).toBeNull();
  });
});

describe("parseRecord", () => {
  it("parses an object", () => {
    expect(parseRecord('{"a":1}')).toEqual({ a: 1 });
  });

  it("returns null rather than throwing on malformed JSON", () => {
    expect(parseRecord("{not json")).toBeNull();
  });

  it("rejects valid JSON that is not an object", () => {
    expect(parseRecord("[1,2]")).toBeNull();
    expect(parseRecord("null")).toBeNull();
    expect(parseRecord('"a string"')).toBeNull();
  });
});

describe("asArray", () => {
  it("accepts an array and rejects an object", () => {
    expect(asArray([1])).toEqual([1]);
    expect(asArray({ length: 1 })).toBeNull();
  });
});

describe("asFiniteNumber", () => {
  it("accepts ordinary numbers including zero and negatives", () => {
    expect(asFiniteNumber(0)).toBe(0);
    expect(asFiniteNumber(-3.5)).toBe(-3.5);
  });

  // The reason this function exists: SQLite has no NaN and silently stores NULL,
  // which turns any later SUM into NULL.
  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("rejects %s", (_label, value) => {
    expect(asFiniteNumber(value)).toBeNull();
  });

  it("rejects a numeric string, so JSON type confusion cannot slip through", () => {
    expect(asFiniteNumber("0.5")).toBeNull();
  });
});

describe("asBoundedNumber", () => {
  it("is inclusive at both ends", () => {
    expect(asBoundedNumber(0, 0, 1)).toBe(0);
    expect(asBoundedNumber(1, 0, 1)).toBe(1);
  });

  it("rejects outside the range", () => {
    expect(asBoundedNumber(-0.0001, 0, 1)).toBeNull();
    expect(asBoundedNumber(1.0001, 0, 1)).toBeNull();
  });

  it("rejects NaN, which compares false against every bound", () => {
    expect(asBoundedNumber(Number.NaN, 0, 1)).toBeNull();
  });
});

describe("asString", () => {
  it("accepts a string within the limit", () => {
    expect(asString("ada", 20)).toBe("ada");
  });

  it("rejects an over-long string", () => {
    expect(asString("abcdef", 5)).toBeNull();
  });

  it("measures code points, not UTF-16 units", () => {
    // Four astral-plane emoji are 8 UTF-16 units but 4 characters to a reader.
    expect(asString("👩👨👧👦", 4)).toBe("👩👨👧👦");
  });

  it("rejects a non-string", () => {
    expect(asString(5, 20)).toBeNull();
  });
});

describe("asEnum", () => {
  const allowed = ["easy", "normal", "hard"] as const;

  it("returns the matching member", () => {
    expect(asEnum("normal", allowed)).toBe("normal");
  });

  it("rejects a non-member and a non-string", () => {
    expect(asEnum("NORMAL", allowed)).toBeNull();
    expect(asEnum(1, allowed)).toBeNull();
  });
});

describe("numberField", () => {
  it("reads a valid value", () => {
    expect(numberField({ n: 7 }, "n", 0)).toBe(7);
  });

  it.each([
    ["a missing key", {}],
    ["a negative value", { n: -1 }],
    ["NaN", { n: Number.NaN }],
    ["a string", { n: "7" }],
  ])("falls back for %s", (_label, record) => {
    expect(numberField(record, "n", 42)).toBe(42);
  });
});

describe("booleanField", () => {
  it("reads a valid value and falls back otherwise", () => {
    expect(booleanField({ b: true }, "b", false)).toBe(true);
    expect(booleanField({ b: "true" }, "b", false)).toBe(false);
    expect(booleanField({}, "b", true)).toBe(true);
  });
});
