import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Reading the repo as text, for the guard tests that enforce rules a type system
 * cannot: `purity.node.test.ts` (ADR 0002) and `logging.node.test.ts`.
 *
 * Shared rather than copied because `stripNonCode` is the part both guards
 * depend on being right — a stripper that misses a comment makes a guard fire on
 * prose, and one that strips too much makes it miss real code. Two copies would
 * drift, and the drift would be invisible until a guard silently stopped
 * guarding.
 *
 * Typed by `tsconfig.node.json`, which is why the filename ends `.node.ts`:
 * `tsconfig.json` has no Node types and would reject `node:fs`.
 */

export function collectTsFiles(dir: string): string[] {
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
export function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, '""')
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

export function readCode(file: string): string {
  return stripNonCode(readFileSync(file, "utf8"));
}
