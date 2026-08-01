/**
 * The SeedSource port's real adapter (SPEC §5.2).
 *
 * A game is fully determined by one uint32, so this is the single place the
 * outside world's entropy enters. `crypto.getRandomValues` is used because it is
 * the only unbiased uint32 source that is available everywhere and needs no
 * fallback quality argument — not because anything here is security sensitive.
 *
 * ## The fallback is deterministic on purpose
 *
 * If `crypto` is absent (an ancient webview, a non-secure context in some old
 * builds), we do not reach for `Date.now()`. A clock read is neither random nor
 * reproducible: it is low-entropy, it correlates across simultaneous players,
 * and it destroys the one property SPEC §5.2 is buying — that a bug report can
 * say "seed 41762, round 3" and be replayed.
 *
 * Instead the fallback walks a fixed sequence from a fixed constant. Two
 * consequences, both accepted: a crypto-less browser plays the same five colors
 * on its first game every time it loads, and successive games within a session
 * still differ. A reproducible game is a worse *surprise* but a better
 * *artifact* than an unreproducible one.
 */

import { mixSeed } from "@/domain/rng";

/** The 32-bit fraction of the golden ratio — the usual arbitrary-but-not-special constant. */
export const FALLBACK_SEED_BASE = 0x9e3779b9;

export type SeedSource = () => number;

let fallbackStep = 0;

/** The documented deterministic fallback. Exported so tests can drive it directly. */
export function deterministicSeed(): number {
  fallbackStep += 1;
  return mixSeed(FALLBACK_SEED_BASE, fallbackStep) >>> 0;
}

/** Reset the fallback sequence. Exists so one test cannot leak into the next. */
export function resetDeterministicSeed(): void {
  fallbackStep = 0;
}

/** A uint32 game seed from `crypto.getRandomValues`, or the deterministic fallback. */
export function createSeed(): number {
  const source: Crypto | undefined = globalThis.crypto;
  if (!source || typeof source.getRandomValues !== "function") {
    return deterministicSeed();
  }
  const out = new Uint32Array(1);
  try {
    source.getRandomValues(out);
  } catch {
    return deterministicSeed();
  }
  const value = out[0];
  return value === undefined ? deterministicSeed() : value >>> 0;
}
