/**
 * A stable, random-looking handle for a player who finished a game without
 * choosing a name (ADR 0032).
 *
 * Deterministic in `playerId` on purpose: all of one player's unnamed games get
 * the *same* handle, so they fold to one board entry rather than scattering into
 * one row per game, and `setName` can recompute the folded key to find and claim
 * them. It is not secret and not unique — a collision just means two anonymous
 * players share a handle, which the board already tolerates (it also groups by
 * player id). No randomness, so it is a pure function of the id.
 */

const ADJECTIVES = [
  "Amber",
  "Brave",
  "Clever",
  "Dapper",
  "Eager",
  "Fuzzy",
  "Gentle",
  "Happy",
  "Jolly",
  "Keen",
  "Lucky",
  "Mellow",
  "Nimble",
  "Plucky",
  "Quiet",
  "Rapid",
  "Swift",
  "Tidy",
  "Witty",
  "Zesty",
  "Bright",
  "Cosmic",
  "Dizzy",
  "Frosty",
] as const;

const ANIMALS = [
  "Otter",
  "Falcon",
  "Badger",
  "Cobra",
  "Dingo",
  "Ferret",
  "Gecko",
  "Heron",
  "Ibis",
  "Jaguar",
  "Koala",
  "Lynx",
  "Marmot",
  "Newt",
  "Osprey",
  "Puma",
  "Quokka",
  "Robin",
  "Stoat",
  "Tapir",
  "Urial",
  "Vole",
  "Wombat",
  "Yak",
] as const;

/**
 * A handle like `SwiftPuma-3f`. The multiplicative scramble keeps sequential ids
 * from mapping to adjacent words; the two-character tag lifts the space to a few
 * hundred thousand so collisions stay rare at hobby scale. The `?? ` fallbacks
 * are unreachable — the modulo is always in range — but satisfy
 * `noUncheckedIndexedAccess` without a cast.
 */
export function placeholderName(playerId: number): string {
  const h = Math.imul(playerId ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  const adjective = ADJECTIVES[h % ADJECTIVES.length] ?? "Anon";
  const animal = ANIMALS[(h >>> 5) % ANIMALS.length] ?? "Player";
  const tag = ((h >>> 10) % 1296).toString(36).padStart(2, "0");
  return `${adjective}${animal}-${tag}`;
}
