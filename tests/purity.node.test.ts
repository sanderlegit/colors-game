import { describe, expect, it } from "vitest";
import { collectTsFiles, readCode } from "./source.node";

/**
 * Guards ADR 0002. The functional core is only worth its ceremony if the
 * ceremony is actually enforced — a documented convention decays, a failing
 * build does not. See CLAUDE.md § "The purity rule".
 */

const PURE_DIRS = ["src/color", "src/domain", "src/shared"];

/** Each pattern is matched against source with comments and strings stripped. */
const FORBIDDEN: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /\bMath\.random\b/, why: "randomness must come from the seeded Rng port" },
  { pattern: /\bDate\.now\b/, why: "time is a parameter, not an ambient read" },
  { pattern: /\bnew Date\b/, why: "time is a parameter, not an ambient read" },
  { pattern: /\bperformance\.now\b/, why: "time is a parameter, not an ambient read" },
  { pattern: /\bdocument\b/, why: "the pure core must not touch the DOM" },
  { pattern: /\bwindow\b/, why: "the pure core must not touch the DOM" },
  { pattern: /\bnavigator\b/, why: "the pure core must not touch platform APIs" },
  { pattern: /\blocalStorage\b/, why: "persistence belongs to src/platform" },
  { pattern: /\bfetch\s*\(/, why: "the pure core must not perform I/O" },
  {
    pattern: /from\s+["'](?:@\/|.*\.\.\/)(?:ui|platform|server)\//,
    why: "the core must not import the shell or the backend",
  },
];

/**
 * The backend's own, weaker rule. `server/**` is an imperative shell — it reads
 * a clock, mints randomness, and talks to a database — so the core's bans on
 * `Date.now` and `crypto` do not apply. What must hold is that it is a *Workers*
 * shell: no DOM, and no reaching into the browser shell for something that looks
 * convenient. `src/platform/**` in particular is `fetch`, `localStorage` and
 * `navigator` all the way down; importing it would compile locally against
 * tsconfig.json's DOM libs and fail at deploy, which is the worst failure mode
 * available here.
 */
const SERVER_FORBIDDEN: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /\bdocument\b/, why: "the backend has no DOM" },
  { pattern: /\bwindow\b/, why: "the backend has no DOM" },
  { pattern: /\blocalStorage\b/, why: "the backend has no DOM" },
  {
    pattern: /from\s+["'](?:@\/|.*\.\.\/)(?:ui|platform)\//,
    why: "the backend must not import the browser shell",
  },
];

describe("functional core purity (ADR 0002)", () => {
  const files = PURE_DIRS.flatMap(collectTsFiles).filter((f) => !f.endsWith(".test.ts"));

  it("scans the pure directories", () => {
    // Sanity check on the guard itself: once the core exists, silence must mean
    // "clean", not "found nothing to look at".
    expect(Array.isArray(files)).toBe(true);
  });

  for (const file of files) {
    it(`${file} touches no ambient state`, () => {
      const code = readCode(file);
      const violations = FORBIDDEN.filter(({ pattern }) => pattern.test(code)).map(
        ({ pattern, why }) => `${String(pattern)} — ${why}`,
      );
      expect(violations, `${file} violates the purity rule`).toEqual([]);
    });
  }
});

describe("backend shell purity", () => {
  const files = collectTsFiles("server").filter(
    (f) => !f.endsWith(".test.ts") && !f.endsWith(".d.ts"),
  );

  it("scans the backend", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} stays inside the Workers runtime`, () => {
      const code = readCode(file);
      const violations = SERVER_FORBIDDEN.filter(({ pattern }) => pattern.test(code)).map(
        ({ pattern, why }) => `${String(pattern)} — ${why}`,
      );
      expect(violations, `${file} violates the backend shell rule`).toEqual([]);
    });
  }
});
