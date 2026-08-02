import { describe, expect, it } from "vitest";
import { randomSeed, randomToken, sha256Hex } from "./ids";

/**
 * The SHA-256 vectors are the NIST FIPS 180-2 examples, not values read back
 * from this implementation. CLAUDE.md's rule about pinning tests to published
 * references rather than to our own output applies to every hash in the repo,
 * not only to the colour maths.
 */
const NIST_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const NIST_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("randomToken", () => {
  it("is 43 characters — 32 bytes of base64url, unpadded", () => {
    expect(randomToken()).toHaveLength(43);
  });

  it("uses only the base64url alphabet, so it needs no percent-encoding in a path", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it("does not repeat", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(randomToken());
    expect(seen.size).toBe(500);
  });
});

describe("sha256Hex", () => {
  it("matches the published vector for 'abc'", async () => {
    await expect(sha256Hex("abc")).resolves.toBe(NIST_ABC);
  });

  it("matches the published vector for the empty string", async () => {
    await expect(sha256Hex("")).resolves.toBe(NIST_EMPTY);
  });

  it("is 64 lowercase hex characters, zero-padded", async () => {
    // The padStart in the implementation is the easy thing to get wrong: a byte
    // below 0x10 renders as one character without it, and the hash silently
    // shortens for roughly 1 in 16 of its bytes.
    for (const input of ["a", "b", "colors", "🎨", "x".repeat(1000)]) {
      await expect(sha256Hex(input)).resolves.toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("hashes bytes, so two different strings differ", async () => {
    expect(await sha256Hex("ada")).not.toBe(await sha256Hex("Ada"));
  });

  it("is stable across calls", async () => {
    expect(await sha256Hex("colors")).toBe(await sha256Hex("colors"));
  });
});

describe("randomSeed", () => {
  it("is a uint32", () => {
    for (let i = 0; i < 1000; i += 1) {
      const seed = randomSeed();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("varies", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i += 1) seen.add(randomSeed());
    // A generator stuck on one value would still pass the range test above.
    expect(seen.size).toBeGreaterThan(190);
  });
});
