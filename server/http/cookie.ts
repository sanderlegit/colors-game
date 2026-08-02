/**
 * The identity cookie. One cookie, one value: an opaque 43-character token whose
 * SHA-256 is the `players.token_hash` row.
 *
 * ## Why the attributes are what they are
 *
 * - **`HttpOnly`** — nothing in `src/ui/**` needs to read it, and the token is a
 *   bearer credential for a leaderboard entry. Script access buys nothing and
 *   costs the whole XSS story.
 * - **`SameSite=Strict`** rather than `Lax`. There is no cross-site entry flow
 *   here: the player lands on the page and the page's own `fetch` calls are
 *   same-site, so Strict withholds the cookie only from requests we do not want
 *   to serve anyway. Strict also makes the same-origin check in `origin.ts`
 *   belt-and-braces rather than the only defence.
 * - **`Secure`** — the site is HTTPS. Browsers treat `http://localhost` as a
 *   secure context, so this does not break `wrangler dev`.
 * - **`Max-Age` of 400 days**, which is the ceiling Chrome enforces on cookie
 *   lifetime; asking for longer silently gets you 400 anyway.
 *
 * The value is never percent-encoded. Base64url's alphabet is a strict subset of
 * what a cookie value may contain, so encoding would only introduce a decode
 * step that could disagree with the encoder.
 */

export const IDENTITY_COOKIE = "colors_id";

/** Chrome's cap. Longer values are truncated to this by the browser. */
export const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

const ATTRIBUTES = "Path=/; HttpOnly; Secure; SameSite=Strict";

/**
 * Read one cookie out of a `Cookie` header.
 *
 * First match wins. A duplicate name is not something a browser sends for one
 * path, so seeing two means either an attacker on a sibling subdomain or a stale
 * cookie from a different `Path`; taking the first is what browsers themselves
 * document, and picking arbitrarily would make the failure intermittent.
 */
export function readCookie(header: string | null, name: string): string | null {
  if (header === null) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    return value === "" ? null : value;
  }
  return null;
}

export function setCookie(
  name: string,
  value: string,
  maxAgeSeconds: number = COOKIE_MAX_AGE_SECONDS,
): string {
  return `${name}=${value}; ${ATTRIBUTES}; Max-Age=${maxAgeSeconds}`;
}

/**
 * The clearing cookie: same name, same attributes, empty value, `Max-Age=0`.
 *
 * The attributes have to match the ones the cookie was set with or the browser
 * treats it as a different cookie and clears nothing — which is why this is
 * built from the same constant rather than spelled out again.
 */
export function clearCookie(name: string): string {
  return `${name}=; ${ATTRIBUTES}; Max-Age=0`;
}
