/**
 * Request-body validation.
 *
 * Built on `src/shared/decode`, which is shared with the client on purpose: the
 * two sides must agree on what "a number" is, or they disagree about a value
 * neither of them checked twice. The policy differs though, and the header of
 * that module spells out why — the client falls back, this rejects. A default
 * here would let a client move a bound in its own favour and never be told.
 *
 * Everything a request can influence is bounded before it reaches the database:
 * body size, array length, string length, and every numeric range. The bounds
 * are the game's own (`ROUNDS_PER_GAME`, the name limit, the picker's axes),
 * imported rather than restated wherever the import is possible, so a rule
 * change cannot leave the validator behind.
 */

import { type Oklch, oklch } from "../src/color/types";
import { DEFAULT_DIFFICULTY, type Difficulty } from "../src/domain/round";
import { ROUNDS_PER_GAME } from "../src/domain/state";
import { asBoundedNumber, asEnum, asRecord, asString, parseRecord } from "../src/shared/decode";

/**
 * Five OKLCh triples and a name do not reach 1 KB. The limit is here so that a
 * body is rejected before it is parsed, not after — `JSON.parse` on a megabyte
 * of nesting is work an unauthenticated caller should not be able to ask for.
 */
export const MAX_BODY_BYTES = 4096;

/** SPEC §8: the memorize window is 3s, 5s or 8s, chosen before play. */
export const ALLOWED_MEMORIZE_MS: readonly number[] = [3000, 5000, 8000];

/**
 * Must equal `MAX_NAME_LENGTH` in `src/platform/api.ts` — a board row has to fit
 * a phone. It is duplicated rather than imported because that module is
 * `src/platform/**`, which the purity guard forbids `server/**` from importing:
 * it is `fetch` and `navigator` all the way down, and it does not type-check
 * under the Workers-only libs. If one of the two moves, move the other.
 */
export const MAX_NAME_LENGTH = 24;

/**
 * The picker's own axes (`src/ui/picker.ts`): L is OKLab lightness 0..1, hue is
 * degrees with 360 accepted as the wrap point, and chroma is capped well above
 * anything sRGB can express. The cap is generous by design — a guess outside the
 * gamut is not an exploit, it just scores badly — but a body still has to be
 * finite and in range so nothing here can put a NaN or an infinity into SQLite,
 * which has neither and would store NULL instead.
 */
const MAX_CHROMA = 0.5;

export type StartGameBody = { readonly memorizeMs: number; readonly difficulty: Difficulty };

/**
 * The only tier v1 will issue.
 *
 * `createReducer` calls `deps.target(seed, roundIndex)` with no third argument,
 * so the client generates `normal` targets whatever it asked for. Storing
 * anything else on the row would make `games.difficulty` a lie and the replay
 * would score against colours the player never saw, so a request for another
 * tier is refused rather than quietly downgraded. Widening this is the second
 * half of the "difficulty tiers are unreachable" gap in `docs/BACKLOG.md`.
 */
const ISSUABLE_DIFFICULTIES: readonly Difficulty[] = [DEFAULT_DIFFICULTY];

export type SubmitBody = {
  readonly guesses: readonly Oklch[];
  readonly name?: string;
};

/** A validated display name and the folded key its uniqueness is enforced on. */
export type NameBody = { readonly name: string; readonly key: string };

/**
 * A browser error, as `src/platform/errors.ts` beacons it.
 *
 * Both strings are bounded here rather than at the database, because this is the
 * only unauthenticated write in the API and the row it produces is deduplicated
 * by a hash of exactly these two fields — an unbounded stack would be an
 * unbounded key.
 */
export const MAX_ERROR_MESSAGE_LENGTH = 300;
export const MAX_ERROR_STACK_LENGTH = 2000;

/** Which listener fired. Nothing else about the page is accepted or stored. */
export const CLIENT_ERROR_KINDS: readonly ClientErrorKind[] = ["error", "unhandledrejection"];

export type ClientErrorKind = "error" | "unhandledrejection";

export type ClientErrorBody = {
  readonly kind: ClientErrorKind;
  readonly message: string;
  /** `null` rather than optional: `exactOptionalPropertyTypes` is on. */
  readonly stack: string | null;
};

export function decodeClientError(body: Record<string, unknown>): ClientErrorBody | null {
  const kind = asEnum(body.kind, CLIENT_ERROR_KINDS);
  const message = asString(body.message, MAX_ERROR_MESSAGE_LENGTH);
  if (kind === null || message === null || message.trim() === "") return null;
  // An absent stack is ordinary — a cross-origin script error carries none —
  // but a present one that will not narrow is a client we did not write.
  if (body.stack === undefined || body.stack === null) return { kind, message, stack: null };
  const stack = asString(body.stack, MAX_ERROR_STACK_LENGTH);
  return stack === null ? null : { kind, message, stack };
}

/**
 * Read a JSON object body without throwing.
 *
 * Returns `null` for every kind of unusable body — too large, unreadable,
 * malformed, or a JSON value that is not an object. The caller answers 400 to
 * all of them, because the distinctions are only actionable to someone writing a
 * different client, and enumerating them tells an attacker which guess was close.
 */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) return null;
  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  // Re-checked after reading: `Content-Length` is a claim, not a measurement,
  // and a chunked body does not carry one at all.
  if (text.length > MAX_BODY_BYTES) return null;
  return parseRecord(text);
}

export function decodeStartGame(body: Record<string, unknown>): StartGameBody | null {
  const memorizeMs = asBoundedNumber(body.memorizeMs, 0, Number.MAX_SAFE_INTEGER);
  if (memorizeMs === null || !ALLOWED_MEMORIZE_MS.includes(memorizeMs)) return null;
  // Absent is the normal case — the client sends only `memorizeMs`. Present and
  // unissuable is refused; present and `normal` is the same request.
  const difficulty =
    body.difficulty === undefined
      ? DEFAULT_DIFFICULTY
      : asEnum(body.difficulty, ISSUABLE_DIFFICULTIES);
  if (difficulty === null) return null;
  return { memorizeMs, difficulty };
}

/**
 * Degrees onto [0, 360). 360 and 0 are the same hue, and storing both would let
 * one game's guesses round-trip into two different strings.
 *
 * An in-range hue is returned untouched rather than run through the modulus.
 * `((h % 360) + 360) % 360` is not the identity on [0, 360): adding 360 to a
 * tiny hue rounds off its low bits, and the guess the server scores would then
 * differ in the last place from the one the client scored for the reveal screen.
 * A perturbation that small is invisible right up until two screens disagree.
 */
function normaliseHue(h: number): number {
  return h >= 0 && h < 360 ? h : ((h % 360) + 360) % 360;
}

function decodeGuess(value: unknown): Oklch | null {
  const record = asRecord(value);
  if (record === null) return null;
  const L = asBoundedNumber(record.L, 0, 1);
  const c = asBoundedNumber(record.c, 0, MAX_CHROMA);
  const h = asBoundedNumber(record.h, 0, 360);
  if (L === null || c === null || h === null) return null;
  return oklch(L, c, normaliseHue(h));
}

/**
 * Exactly `ROUNDS_PER_GAME` guesses, or `null`.
 *
 * Exported because the resubmit path decodes `games.guesses_json` through it:
 * what the replay reads back has to be narrowed by the same rules that let it
 * be written, or a stored row becomes a second, unvalidated entry point.
 */
export function decodeGuesses(value: unknown): readonly Oklch[] | null {
  if (!Array.isArray(value) || value.length !== ROUNDS_PER_GAME) return null;
  const guesses: Oklch[] = [];
  for (const item of value) {
    const guess = decodeGuess(item);
    if (guess === null) return null;
    guesses.push(guess);
  }
  return guesses;
}

/**
 * The submitted round guesses, and optionally the name to claim with them.
 *
 * The length is pinned to exactly `ROUNDS_PER_GAME` rather than merely capped.
 * A short array would replay fewer rounds and score lower, which is harmless; a
 * long one would score rounds the game never had, which is not. Requiring the
 * exact count means the replay covers the same five rounds the player saw, and
 * the check lives here rather than in the handler so there is one place to read.
 */
export function decodeSubmit(body: Record<string, unknown>): SubmitBody | null {
  const guesses = decodeGuesses(body.guesses);
  if (guesses === null) return null;
  if (body.name === undefined) return { guesses };
  const named = decodeName(body);
  return named === null ? null : { guesses, name: named.name };
}

/**
 * Fold a display name to the key uniqueness is enforced on.
 *
 * NFKC first, so the fullwidth and compatibility forms of a name collapse onto
 * it instead of standing beside it on the board looking identical. Then case
 * folding, then whitespace collapsing — "Ada  Lovelace" and "ada lovelace" are
 * one name to a reader, so they are one name to the index.
 *
 * This is not confusable detection and does not pretend to be: Cyrillic "а" is
 * still a different key from Latin "a". Homoglyph folding needs a table we would
 * have to ship and keep current, which is a dependency and an ADR, and the worst
 * it prevents is impersonation on a colour-matching leaderboard.
 */
export function nameKey(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Characters a name may not contain: C0 and C1 controls, the bidirectional
 * overrides, and the zero-width joiners and marks. All of them render as nothing
 * or as reordered text, so they appear in a name only to make one row of the
 * board lie about what it says.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
const FORBIDDEN_IN_NAME = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\ufeff]/;

/**
 * A display name and its key, or `null`.
 *
 * The name is stored with the player's own casing and spacing (after trimming),
 * because that is what they typed and what they will expect to see; only the key
 * is folded. Length is counted in code points by `asString`, so an emoji-heavy
 * name costs what it looks like it costs rather than twice that.
 */
export function decodeName(body: Record<string, unknown>): NameBody | null {
  const raw = asString(body.name, MAX_NAME_LENGTH);
  if (raw === null || FORBIDDEN_IN_NAME.test(raw)) return null;
  const name = raw.replace(/\s+/g, " ").trim();
  if (name === "") return null;
  const key = nameKey(name);
  // NFKC can lengthen a string, and the key is what the unique index holds — so
  // the key is what the bound has to apply to.
  return key === "" || [...key].length > MAX_NAME_LENGTH ? null : { name, key };
}
