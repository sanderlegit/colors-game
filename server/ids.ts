/**
 * Everything the server has to conjure: a game id, the hash of a cookie token, a
 * game seed, the salt the mint buckets are keyed under, and the suffix that
 * settles a name collision nothing else could.
 *
 * WebCrypto only. `crypto.randomUUID` would be shorter but a UUIDv4 carries 122
 * bits, and these tokens are bearer credentials for a leaderboard entry — 256
 * bits costs nothing here and removes the conversation entirely. Nothing in this
 * module reads a clock, so a token can never encode when it was issued.
 *
 * Base64url rather than hex because the id travels in a URL path
 * (`/api/games/:gameId/result`): 43 characters instead of 64, and no percent
 * encoding to get wrong on either side.
 */

/** 32 bytes. Anything shorter invites a discussion nobody needs to have. */
const TOKEN_BYTES = 32;

/**
 * `getRandomValues` fills the array it is handed, so these reads cannot miss.
 * The check exists because `noUncheckedIndexedAccess` is on and CLAUDE.md bans
 * the non-null assertion that would otherwise silence it.
 */
function firstWord(words: Uint32Array): number {
  const value = words[0];
  return value === undefined ? 0 : value;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 43 characters of base64url — 256 bits, unpadded. */
export function randomToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/**
 * Lowercase hex SHA-256.
 *
 * This is deliberately a plain hash rather than a password KDF. The input is 256
 * bits of our own entropy, so there is no dictionary to run and no work factor
 * worth paying; the hash exists only so that a leaked database is not a pile of
 * live session tokens.
 */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let hex = "";
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Lowercase hex from `bytes` random bytes.
 *
 * W3C trace context fixes the widths: a trace id is 16 bytes and a span id is 8,
 * both written as hex, so this takes the byte count rather than a character
 * count and cannot be called with a length the format does not allow.
 */
export function randomHex(bytes: number): string {
  const buffer = new Uint8Array(Math.max(0, bytes));
  crypto.getRandomValues(buffer);
  let hex = "";
  for (const byte of buffer) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * The pepper the logged player key is hashed under.
 *
 * Per isolate and never persisted, so nothing outside the log store can turn a
 * key back into an identity — and, like the mint salt in `makeDailySalt`, that
 * privacy property is bought with reach: two isolates give the same player two
 * different keys. It does not rotate on a clock, because a key that changed at
 * midnight would break exactly the debugging session it exists for.
 *
 * **Minted on first use, not here.** `productionDeps` is built at module scope,
 * and the Workers runtime refuses to generate random values in global scope —
 * `crypto.getRandomValues` outside a handler is a startup error, not a warning.
 * `makeDailySalt` is lazy for the same reason.
 */
export function makeLogPepper(): () => string {
  let pepper: string | null = null;
  return (): string => {
    if (pepper === null) pepper = randomToken();
    return pepper;
  };
}

/**
 * A uint32 game seed (SPEC §5.2).
 *
 * The seed is issued by the server and the client generates its targets from it,
 * which is what moves target generation server-side without moving the colour
 * maths anywhere: both sides call the same `generateTarget`.
 */
export function randomSeed(): number {
  const words = new Uint32Array(1);
  crypto.getRandomValues(words);
  return firstWord(words) >>> 0;
}

/**
 * Crockford base32 without the vowels, so a suffix cannot spell anything and
 * cannot be misread aloud. `1`/`I` and `0`/`O` are absent for the same reason.
 */
const SUFFIX_ALPHABET = "23456789bcdfghjkmnpqrstvwxz";
const SUFFIX_LENGTH = 4;

/**
 * The last resort when every numbered variant of a name is taken. ~19 bits,
 * which is plenty against a squatter who has already had to burn eight names.
 */
export function randomSuffix(): string {
  const bytes = new Uint8Array(SUFFIX_LENGTH);
  crypto.getRandomValues(bytes);
  let suffix = "";
  for (const byte of bytes) suffix += SUFFIX_ALPHABET[byte % SUFFIX_ALPHABET.length] ?? "x";
  return suffix;
}

/**
 * The mint bucket's daily salt.
 *
 * Minted per isolate rather than read from a binding, which is a deliberate
 * trade recorded in ADR 0015: the privacy property (no address is ever stored,
 * and yesterday's buckets cannot be re-derived) holds absolutely, while the
 * *counting* is per isolate, so the ceiling is a coarse brake rather than an
 * exact quota. Binding a secret and returning it here makes it exact without
 * touching a caller.
 */
export function makeDailySalt(): (day: number) => string {
  let cached: { readonly day: number; readonly salt: string } | null = null;
  return function saltFor(day: number): string {
    if (cached === null || cached.day !== day) cached = { day, salt: randomToken() };
    return cached.salt;
  };
}
