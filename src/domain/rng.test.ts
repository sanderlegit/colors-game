import { describe, expect, it } from "vitest";
import { makeRng, mixSeed, nextInRange, nextInt } from "@/domain/rng";

function draw(seed: number, count: number): number[] {
  const rng = makeRng(seed);
  return Array.from({ length: count }, () => rng.next());
}

describe("makeRng", () => {
  it("is deterministic: the same seed replays the same sequence", () => {
    expect(draw(12345, 50)).toEqual(draw(12345, 50));
  });

  it("diverges for different seeds", () => {
    const a = draw(1, 20);
    const b = draw(2, 20);
    expect(a).not.toEqual(b);
    // Not just "the arrays differ" — no individual draw should coincide either.
    expect(a.filter((value, i) => value === b[i])).toEqual([]);
  });

  it("treats seeds as 32-bit, so 2^32 apart is the same generator", () => {
    expect(draw(7, 5)).toEqual(draw(7 + 4294967296, 5));
  });

  it("returns values in [0, 1)", () => {
    for (const value of draw(0xc0ffee, 10000)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("produces distinct values from adjacent seeds (no short-cycle collapse)", () => {
    const firsts = new Set(Array.from({ length: 1000 }, (_, seed) => makeRng(seed).next()));
    expect(firsts.size).toBe(1000);
  });
});

describe("state snapshot and resume", () => {
  it("starts at the seed, truncated to 32 bits", () => {
    expect(makeRng(99).state).toBe(99);
    expect(makeRng(-1).state).toBe(-1);
    expect(makeRng(2 ** 31).state).toBe(-(2 ** 31));
  });

  it("advances the state on every draw", () => {
    const rng = makeRng(5);
    const before = rng.state;
    rng.next();
    expect(rng.state).not.toBe(before);
  });

  it("reproduces the continuation exactly from a captured state", () => {
    const original = makeRng(4242);
    for (let i = 0; i < 17; i++) original.next();

    const snapshot = original.state;
    const tail = Array.from({ length: 25 }, () => original.next());

    const resumed = makeRng(snapshot);
    expect(Array.from({ length: 25 }, () => resumed.next())).toEqual(tail);
  });

  it("survives a round-trip through JSON, which is the point of a numeric state", () => {
    const rng = makeRng(2026);
    rng.next();
    const revived = makeRng(JSON.parse(JSON.stringify({ s: rng.state })).s);
    expect(revived.next()).toBe(makeRng(rng.state).next());
  });
});

describe("uniformity", () => {
  it("fills 10 buckets evenly over 100k draws", () => {
    const draws = 100_000;
    const buckets = new Array<number>(10).fill(0);
    const rng = makeRng(20260801);

    for (let i = 0; i < draws; i++) {
      const bucket = Math.min(9, Math.floor(rng.next() * 10));
      const current = buckets[bucket] ?? 0;
      buckets[bucket] = current + 1;
    }

    // Expected 10k per bucket. The tolerance is deliberately enormous relative
    // to the ~±300 (3 sigma) a fair generator would produce: this test exists to
    // catch a generator that is broken (stuck, biased, half-range), not to
    // measure randomness quality. A fixed seed makes it fully deterministic.
    const expected = draws / 10;
    for (const count of buckets) {
      expect(count).toBeGreaterThan(expected * 0.9);
      expect(count).toBeLessThan(expected * 1.1);
    }
    expect(buckets.reduce((sum, count) => sum + count, 0)).toBe(draws);
  });
});

describe("nextInRange", () => {
  it("stays inside [min, max)", () => {
    const rng = makeRng(31337);
    for (let i = 0; i < 5000; i++) {
      const value = nextInRange(rng, -10, 30);
      expect(value).toBeGreaterThanOrEqual(-10);
      expect(value).toBeLessThan(30);
    }
  });

  it("maps the unit draw linearly onto the range", () => {
    const unit = makeRng(8).next();
    expect(nextInRange(makeRng(8), 100, 200)).toBeCloseTo(100 + unit * 100, 10);
  });

  it("returns min for an empty or inverted range, still consuming a draw", () => {
    const empty = makeRng(8);
    expect(nextInRange(empty, 5, 5)).toBe(5);
    expect(nextInRange(makeRng(8), 5, 1)).toBe(5);
    // The stride is fixed: one call, one draw, whatever the range.
    const reference = makeRng(8);
    reference.next();
    expect(empty.state).toBe(reference.state);
  });
});

describe("nextInt", () => {
  it("covers exactly [minInclusive, maxExclusive)", () => {
    const rng = makeRng(777);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const value = nextInt(rng, 3, 7);
      expect(Number.isInteger(value)).toBe(true);
      seen.add(value);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([3, 4, 5, 6]);
  });

  it("returns min for an empty range", () => {
    expect(nextInt(makeRng(1), 4, 4)).toBe(4);
  });

  it("handles negative ranges", () => {
    const rng = makeRng(55);
    for (let i = 0; i < 1000; i++) {
      const value = nextInt(rng, -5, 0);
      expect(value).toBeGreaterThanOrEqual(-5);
      expect(value).toBeLessThan(0);
    }
  });
});

describe("mixSeed", () => {
  it("is deterministic", () => {
    expect(mixSeed(42, 3)).toBe(mixSeed(42, 3));
  });

  it("returns a 32-bit integer", () => {
    for (let i = 0; i < 100; i++) {
      const mixed = mixSeed(i * 7919, i);
      expect(mixed).toBe(mixed | 0);
    }
  });

  it("decorrelates adjacent counters, which is the only reason it exists", () => {
    const firstDraws = Array.from({ length: 64 }, (_, i) => makeRng(mixSeed(1000, i)).next());
    expect(new Set(firstDraws).size).toBe(64);
  });

  it("separates streams that share one argument", () => {
    expect(mixSeed(1, 2)).not.toBe(mixSeed(2, 1));
  });
});
