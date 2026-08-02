/**
 * Narrowing primitives for untrusted JSON.
 *
 * Two callers with opposite failure policies share this module:
 *
 * - `src/platform/storage.ts` reads `localStorage`, where a bad value is someone
 *   else's problem from a past version. It **falls back** — nothing may throw into
 *   the frame loop.
 * - `server/` reads request bodies, where a bad value is an attacker. It
 *   **rejects** — a silent default there would let a client move a bound in its
 *   own favour.
 *
 * So the strict primitives return `null` on mismatch and the lenient field
 * readers are thin wrappers that swap `null` for a default. Sharing the narrowing
 * itself is the point: the two must agree on what "a number" is, or the client
 * and the server disagree about a value neither of them validated twice.
 *
 * Pure by construction — no DOM, no clock, no I/O. Lives under `src/shared` so
 * the purity guard scans it.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

/** `JSON.parse` that cannot throw, narrowed to a plain object. */
export function parseRecord(raw: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return asRecord(parsed);
}

export function asArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value : null;
}

/**
 * Rejects `NaN` and both infinities, not just non-numbers.
 *
 * This is the check that keeps `NaN` out of SQLite, which has no such value and
 * silently stores `NULL` instead — poisoning any later `SUM` into `NULL`.
 */
export function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Inclusive on both ends. */
export function asBoundedNumber(value: unknown, min: number, max: number): number | null {
  const n = asFiniteNumber(value);
  if (n === null || n < min || n > max) return null;
  return n;
}

export function asString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  // Count code points, not UTF-16 units: `[...s].length` stops an emoji-heavy
  // name from costing twice its apparent length.
  return [...value].length <= maxLength ? value : null;
}

/**
 * Membership by scan rather than `allowed.includes(value as T)` — the cast that
 * spelling requires is exactly the kind CLAUDE.md forbids, and this needs none.
 */
export function asEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== "string") return null;
  for (const candidate of allowed) {
    if (candidate === value) return candidate;
  }
  return null;
}

/**
 * Lenient reader for stored numbers, which are all counts or durations here.
 *
 * Negatives are treated as corruption rather than clamped: a negative best score
 * or games-played is not a value this app can produce, so the default is a
 * better answer than `0`.
 */
export function numberField(
  record: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = asFiniteNumber(record[key]);
  return value === null || value < 0 ? fallback : value;
}

export function booleanField(
  record: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}
