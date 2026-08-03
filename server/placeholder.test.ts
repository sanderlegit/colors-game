import { describe, expect, it } from "vitest";
import { placeholderName } from "./placeholder";

describe("placeholderName", () => {
  it("is deterministic in the player id", () => {
    // Stability is load-bearing: all of one player's unnamed games must fold to
    // the same handle, and `setName` recomputes the key to claim them.
    expect(placeholderName(42)).toBe(placeholderName(42));
  });

  it("gives adjacent ids different handles (the scramble works)", () => {
    const handles = [placeholderName(1), placeholderName(2), placeholderName(3)];
    expect(new Set(handles).size).toBe(3);
  });

  it("reads as a handle: two words and a short tag", () => {
    expect(placeholderName(7)).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+-[0-9a-z]{2}$/);
  });

  it("spreads across the space rather than clustering", () => {
    const handles = new Set(Array.from({ length: 500 }, (_, i) => placeholderName(i + 1)));
    // Collisions in a few-hundred-thousand space are rare; a cluster would fail.
    expect(handles.size).toBeGreaterThan(495);
  });
});
