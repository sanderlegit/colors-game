/**
 * Color coordinate types.
 *
 * These are branded rather than plain structural objects on purpose. `Lab` and
 * `Oklab` are both `{ L, a, b }`, but their L axes differ by a factor of 100 and
 * their a/b axes differ by roughly an order of magnitude. Structural typing would
 * let one silently flow into a function expecting the other, and the result is a
 * plausible-looking color and a scoring bug nobody can find. The brand makes that
 * a compile error.
 *
 * Construct values through the helpers below, never with an object literal cast.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Gamma-encoded sRGB, each channel 0..1. */
export type Srgb = Brand<{ readonly r: number; readonly g: number; readonly b: number }, "Srgb">;

/** Linear-light sRGB, each channel 0..1. */
export type LinearRgb = Brand<
  { readonly r: number; readonly g: number; readonly b: number },
  "LinearRgb"
>;

/** CIE 1931 XYZ, D65 reference white, nominally 0..1. */
export type Xyz = Brand<{ readonly x: number; readonly y: number; readonly z: number }, "Xyz">;

/** CIELAB, D65. L in 0..100, a/b roughly -128..128. */
export type Lab = Brand<{ readonly L: number; readonly a: number; readonly b: number }, "Lab">;

/** OKLab. L in 0..1, a/b roughly -0.4..0.4. */
export type Oklab = Brand<{ readonly L: number; readonly a: number; readonly b: number }, "Oklab">;

/** OKLab in cylindrical form. L in 0..1, c >= 0, h in degrees 0..360. */
export type Oklch = Brand<{ readonly L: number; readonly c: number; readonly h: number }, "Oklch">;

export const srgb = (r: number, g: number, b: number): Srgb => ({ r, g, b }) as Srgb;
export const linearRgb = (r: number, g: number, b: number): LinearRgb => ({ r, g, b }) as LinearRgb;
export const xyz = (x: number, y: number, z: number): Xyz => ({ x, y, z }) as Xyz;
export const lab = (L: number, a: number, b: number): Lab => ({ L, a, b }) as Lab;
export const oklab = (L: number, a: number, b: number): Oklab => ({ L, a, b }) as Oklab;
export const oklch = (L: number, c: number, h: number): Oklch => ({ L, c, h }) as Oklch;
