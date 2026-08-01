/**
 * Seeded pseudo-random number generator (mulberry32).
 *
 * ## Why mulberry32
 *
 * It is a single 32-bit word of state and five integer operations. That is small
 * enough to audit by eye, fast enough that a 100k-draw uniformity test runs in
 * milliseconds, and statistically far better than anything a game needs (it
 * passes gjrand's smallcrush-class batteries). It is not cryptographic and must
 * never be used as if it were — the only thing riding on it here is which color
 * you get.
 *
 * ## Mutable object, explicit state (the design call)
 *
 * `Rng` is a *mutable* generator that publishes its state, not a persistent
 * value. `next()` advances the internal word; `state` is a getter exposing the
 * word as it stands right now.
 *
 * The alternative — a fully immutable `next(): [value, Rng]` — was rejected
 * because every call site becomes a threading exercise, and the property the
 * architecture actually asks for is *snapshot and resume*, not persistence:
 *
 * ```ts
 * const a = makeRng(42);
 * a.next();
 * const snapshot = a.state;       // capture
 * const b = makeRng(snapshot);    // resume — b and a now produce the same tail
 * ```
 *
 * `makeRng(rng.state)` is exact, not approximate: the state word *is* the whole
 * generator. So a `GameState` can carry a plain number and reconstruct the
 * generator on demand, which keeps the state serializable and keeps the domain
 * layer free of live objects.
 *
 * Because the object mutates, an `Rng` must not be shared across two logically
 * independent draw sequences. Derive a fresh one from a mixed seed instead.
 */

export type Rng = {
  next(): number;
  /** The current 32-bit state word. `makeRng(state)` resumes this generator exactly. */
  readonly state: number;
};

/** mulberry32's increment: the odd 32-bit fraction of 2^32 / golden ratio. */
const STEP = 0x6d2b79f5;

const TWO_POW_32 = 4294967296;

/**
 * Build a generator from a seed. Any finite number is accepted; it is truncated
 * to a 32-bit integer, so seeds are effectively mod 2^32.
 */
export function makeRng(seed: number): Rng {
  let s = seed | 0;
  return {
    next(): number {
      s = (s + STEP) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / TWO_POW_32;
    },
    get state(): number {
      return s;
    },
  };
}

/**
 * Uniform draw in `[min, max)`. Returns `min` when the range is empty or
 * inverted, and still consumes a draw so that call sites keep a fixed stride
 * through the sequence regardless of their arguments.
 */
export function nextInRange(rng: Rng, min: number, max: number): number {
  const u = rng.next();
  if (!(max > min)) return min;
  return min + u * (max - min);
}

/**
 * Uniform integer in `[minInclusive, maxExclusive)`. Returns `minInclusive` for
 * an empty or inverted range. Never returns `maxExclusive`, because `next()` is
 * strictly below 1.
 */
export function nextInt(rng: Rng, minInclusive: number, maxExclusive: number): number {
  return Math.floor(nextInRange(rng, minInclusive, maxExclusive));
}

/**
 * Mix two integers into a seed. Used where one logical seed has to fan out into
 * several independent sequences (per round, per purpose) that must not
 * correlate with each other.
 */
export function mixSeed(a: number, b: number): number {
  let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) | 0;
}
