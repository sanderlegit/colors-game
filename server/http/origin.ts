/**
 * CSRF defence for the state-changing endpoints.
 *
 * The identity cookie is `SameSite=Strict`, which already means a browser will
 * not attach it to a cross-site request. This is the second lock, and it exists
 * because the first one is enforced by software we do not ship: a browser bug, a
 * relaxed embedded webview, or a future change of the cookie's attributes would
 * otherwise silently turn "no CSRF" into "CSRF".
 *
 * ## A missing `Origin` is a failure, not an exemption
 *
 * Every browser sends `Origin` on POST and DELETE, so on the endpoints this
 * guards its absence never describes a real player. It does describe `curl`, a
 * script, and a replayed request — none of which should be minting games or
 * claiming names against somebody else's cookie. Treating "absent" as "allowed"
 * is the standard way this check ends up doing nothing at all.
 *
 * Safe methods are not guarded: they change nothing, and browsers routinely omit
 * `Origin` on same-origin GETs, so requiring it there would reject real traffic.
 */

/** Methods that may change state and therefore need the check. */
const UNSAFE_METHODS: readonly string[] = ["POST", "PUT", "PATCH", "DELETE"];

export function isUnsafeMethod(method: string): boolean {
  return UNSAFE_METHODS.includes(method.toUpperCase());
}

/**
 * True when the request carries an `Origin` naming this very origin.
 *
 * The comparison is against the request's own URL rather than a configured
 * hostname, so preview deployments and custom domains work without a list to
 * keep current. Cloudflare rewrites neither, and a `Host` a client made up
 * changes both sides of the comparison at once.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null || origin === "null") return false;
  return origin === new URL(request.url).origin;
}
