/**
 * Every response this API produces is built here, so that two properties hold
 * for all of them rather than for the ones somebody remembered.
 *
 * 1. **`Cache-Control: no-store` on everything.** All of these responses are
 *    identity-bearing — `/api/me`, the board's `isYou` flags, a submission's
 *    rank. A shared cache handing one player's identity to another is the worst
 *    bug available in this system, and it is the kind that only shows up in
 *    production behind a CDN. The default is therefore no-store, and any
 *    endpoint that wants caching has to say so explicitly.
 * 2. **Error bodies carry a `message` the client renders verbatim.**
 *    `src/platform/api.ts` reads exactly that field out of any 4xx and shows it
 *    to the player, falling back to its own wording if it is missing. `code` is
 *    the stable machine-readable half; `message` is prose and may be reworded.
 */

const JSON_TYPE = "application/json; charset=utf-8";

/** Past this a "message" is a payload in disguise; the client truncates at 200. */
const MAX_MESSAGE_LENGTH = 200;

function baseHeaders(extra: Readonly<Record<string, string>>): Headers {
  const headers = new Headers(extra);
  headers.set("cache-control", "no-store");
  return headers;
}

export function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders: Readonly<Record<string, string>> = {},
): Response {
  const headers = baseHeaders(extraHeaders);
  headers.set("content-type", JSON_TYPE);
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * A 204. Distinct from `jsonResponse(204, null)` because a 204 with a body is
 * malformed, and because the client treats 204 as a meaningful answer rather
 * than an empty one: on `/api/me` it means "no identity yet", which is why
 * `src/platform/api.ts` refuses to read an empty 200 the same way.
 */
export function noContent(extraHeaders: Readonly<Record<string, string>> = {}): Response {
  return new Response(null, { status: 204, headers: baseHeaders(extraHeaders) });
}

export function problem(
  status: number,
  code: string,
  message: string,
  extraHeaders: Readonly<Record<string, string>> = {},
): Response {
  return jsonResponse(
    status,
    { error: code, message: message.slice(0, MAX_MESSAGE_LENGTH) },
    extraHeaders,
  );
}
