/**
 * The security headers every response carries, applied once in `app.ts` rather
 * than per handler — the same reasoning as the CSRF check: a new endpoint is
 * protected the moment it joins the route table, not the moment somebody
 * remembers.
 *
 * The static half of the site does not pass through this file at all. The
 * platform serves `dist/**` from the `[assets]` binding and applies
 * `public/_headers` to those responses and not to this Worker's, which is why
 * the same policy is written down twice. **If you change one, change the
 * other** — a `connect-src` that is right for the API and wrong for the document
 * is a page whose `fetch` calls fail silently.
 *
 * ## `connect-src` is the load-bearing directive
 *
 * It gates every `fetch` in `src/platform/api.ts` and the `navigator.sendBeacon`
 * in `src/platform/errors.ts`. Both are same-origin, so `'self'` covers them;
 * getting it wrong does not throw anywhere the player can see, it just makes the
 * board and the error beacon stop working.
 *
 * ## What is deliberately absent
 *
 * - **No `'unsafe-inline'` anywhere.** The app has no inline `<script>` and no
 *   inline `style=` attribute: colour goes through the `--fill-color` custom
 *   property via the CSSOM (`style.setProperty`), which CSP does not govern.
 *   Note the trap — `element.setAttribute("style", …)` *is* governed by
 *   `style-src` and would be blocked. Keep using the CSSOM.
 * - **No `preload` on HSTS.** Getting onto the preload list is easy and getting
 *   off it takes months to reach users. Two years of `max-age` is the commitment
 *   worth making now.
 * - **No `X-XSS-Protection`.** It is deprecated, ignored by current browsers,
 *   and its filter has itself been a source of vulnerabilities.
 * - **No `X-Frame-Options`.** `frame-ancestors 'none'` supersedes it and is the
 *   directive browsers actually consult.
 * - **No canvas directive**, because there is no such thing: the picker's canvas
 *   is an in-memory JS API and lives under `script-src`.
 */

/**
 * `default-src 'none'` first, so anything a future change forgets to name is
 * refused rather than allowed. Every other directive is an opening, not a
 * restriction, which is why they can be read as a list of what this app does.
 */
const CSP_DIRECTIVES: readonly string[] = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
];

export const CONTENT_SECURITY_POLICY: string = CSP_DIRECTIVES.join("; ");

/** Two years, the usual HSTS commitment. `preload` is deliberately absent. */
export const HSTS = "max-age=63072000; includeSubDomains";

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": CONTENT_SECURITY_POLICY,
  "strict-transport-security": HSTS,
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "geolocation=(), camera=(), microphone=(), payment=(), usb=()",
};

/**
 * A copy of `response` carrying the headers above.
 *
 * A copy rather than a mutation because a `Response` that came from anywhere but
 * our own constructor has immutable headers, and a header set that silently
 * fails to apply is the worst outcome available here. The body is passed through
 * unread, so this costs an object and not a buffer.
 */
export function secured(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
