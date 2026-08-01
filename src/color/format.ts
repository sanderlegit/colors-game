/**
 * Colour ↔ string conversions: the only place colours meet text.
 *
 * `parseHex` never throws. Hex arrives from user input and from persisted state
 * written by an older build, so "not a colour" is an ordinary outcome and gets
 * an ordinary return value.
 */

import type { Oklch, Srgb } from "@/color/types";
import { srgb } from "@/color/types";

const SIX_HEX_DIGITS = /^[0-9a-f]{6}$/;

function toByte(channel: number): number {
  const clamped = Math.min(1, Math.max(0, channel));
  return Math.round(clamped * 255);
}

/** Lowercase `#rrggbb`. Channels outside 0..1 are clamped — a hex string cannot express them. */
export function toHex(c: Srgb): string {
  const hex = [c.r, c.g, c.b].map((channel) => toByte(channel).toString(16).padStart(2, "0"));
  return `#${hex.join("")}`;
}

/**
 * Parse `#rgb`, `#rrggbb`, with or without the `#`, any case, any surrounding
 * whitespace. Anything else — including the 4- and 8-digit alpha forms, which
 * `Srgb` has no channel for — returns `null`.
 */
export function parseHex(s: string): Srgb | null {
  const body = s.trim().replace(/^#/, "").toLowerCase();
  const digits = body.length === 3 ? body.replace(/./g, (d) => `${d}${d}`) : body;
  if (!SIX_HEX_DIGITS.test(digits)) return null;

  const value = Number.parseInt(digits, 16);
  return srgb((value >> 16) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255);
}

/**
 * A native CSS `oklch(L C H)` string — no fallback, no conversion. Browsers
 * without OKLCh support are out of scope.
 *
 * Precision is fixed at 4/4/2 decimals. A step of 1e-4 in `L` is ~0.01 CIELAB
 * `L*`, and 0.01° of hue is ~0.008 ΔE00 at full chroma — both far below the
 * 8-bit display's own quantization floor of ~0.24 ΔE00, so nothing visible is
 * lost, and short strings keep the DOM readable when debugging.
 */
export function oklchToCss(c: Oklch): string {
  const trim = (value: number, places: number): string => String(Number(value.toFixed(places)));
  return `oklch(${trim(c.L, 4)} ${trim(c.c, 4)} ${trim(c.h, 2)})`;
}
