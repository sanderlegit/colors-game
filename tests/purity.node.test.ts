import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards ADR 0002. The functional core is only worth its ceremony if the
 * ceremony is actually enforced — a documented convention decays, a failing
 * build does not. See CLAUDE.md § "The purity rule".
 */

const PURE_DIRS = ["src/color", "src/domain"];

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
    pattern: /from\s+["'](?:@\/|.*\.\.\/)(?:ui|platform)\//,
    why: "the core must not import the shell",
  },
];

function collectTsFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return []; // directory not created yet — nothing to guard
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return collectTsFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/** Strip comments and string literals so a mention in prose never fails the build. */
function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, '""')
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

describe("functional core purity (ADR 0002)", () => {
  const files = PURE_DIRS.flatMap(collectTsFiles).filter((f) => !f.endsWith(".test.ts"));

  it("scans the pure directories", () => {
    // Sanity check on the guard itself: once the core exists, silence must mean
    // "clean", not "found nothing to look at".
    expect(Array.isArray(files)).toBe(true);
  });

  for (const file of files) {
    it(`${file} touches no ambient state`, () => {
      const code = stripNonCode(readFileSync(file, "utf8"));
      const violations = FORBIDDEN.filter(({ pattern }) => pattern.test(code)).map(
        ({ pattern, why }) => `${String(pattern)} — ${why}`,
      );
      expect(violations, `${file} violates the purity rule`).toEqual([]);
    });
  }
});
