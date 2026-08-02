/**
 * `POST /api/client-error` → 204.
 *
 * Where `window.onerror` and `unhandledrejection` land (`src/platform/errors.ts`).
 * A browser exception is the one class of failure the server cannot see at all,
 * and a game whose frame loop dies renders nothing and reports nothing.
 *
 * ## Three things bound what this can cost
 *
 * 1. **Dedup by fingerprint.** The row key is `hash(message + stack)` and a day,
 *    so one broken browser reloading in a loop increments `n` instead of adding
 *    rows. This is the difference between a table and a firehose.
 * 2. **A mint-bucket rate limit**, the tightest in `limits.ts`, because this is
 *    the only unauthenticated write in the API. It bounds the case dedup cannot:
 *    a caller inventing a fresh stack each time.
 * 3. **Bounded strings**, checked in `decode.ts` before anything is hashed.
 *
 * ## What is deliberately not recorded
 *
 * No identity, no cookie, no address, no URL. A stack trace plus a message is
 * enough to find the bug; anything more turns an error report into a session
 * record, and ADR 0014's whole position is that there is nothing here to
 * subject-access or delete.
 *
 * Retention is 30 days, enforced twice. `Repo.recordClientError` drops older
 * days on every write, which is what makes the promise true while reports are
 * arriving; `server/sweep.ts` drops them again on the daily cron, which is what
 * makes it true when they stop — a purge that only runs on write keeps the last
 * 30 days forever the moment the last browser stops throwing.
 */

import type { Handler, RequestContext } from "../context";
import { decodeClientError, readJsonBody } from "../decode";
import { noContent, problem } from "../http/json";
import {
  CLIENT_ERROR_RETENTION_DAYS,
  CLIENT_ERRORS_PER_BUCKET_PER_DAY,
  DAY_MS,
  dayNumber,
  mintBucket,
  secondsUntilNextDay,
} from "../limits";
import { dayKey } from "../telemetry";

/** Fingerprints are compared, never inverted; half a SHA-256 is ample. */
const FINGERPRINT_LENGTH = 32;

export const reportClientError: Handler = async (context: RequestContext): Promise<Response> => {
  const body = await readJsonBody(context.request);
  if (body === null) return problem(400, "bad_request", "That request could not be read.");

  const report = decodeClientError(body);
  if (report === null) return problem(422, "invalid_report", "That is not an error report.");

  const now = context.deps.now();
  const bucket = await mintBucket("error", context.request, context.deps, now);
  const seen = await context.repo.bumpMintBucket(bucket, dayNumber(now));
  if (seen > CLIENT_ERRORS_PER_BUCKET_PER_DAY) {
    // 429 rather than a silent 204: `sendBeacon` ignores the response either
    // way, so the honest status costs the caller nothing and makes the limit
    // visible in the one wide log event.
    return problem(429, "rate_limited", "Too many error reports from your network today.", {
      "retry-after": String(secondsUntilNextDay(now)),
    });
  }

  // `JSON.stringify` of the pair rather than a concatenation: it is unambiguous
  // without a separator a message could itself contain, and it keeps a literal
  // control character out of this file (docs/history/README.md).
  const fingerprint = (
    await context.deps.hashToken(JSON.stringify([report.message, report.stack]))
  ).slice(0, FINGERPRINT_LENGTH);

  // Deferred: the reporter is a beacon whose response nothing reads, so making
  // the browser wait on a D1 write buys it nothing.
  context.ctx.waitUntil(
    context.repo.recordClientError({
      fingerprint,
      day: dayKey(now),
      message: report.message,
      stack: report.stack,
      at: now,
      keepFromDay: dayKey(now - CLIENT_ERROR_RETENTION_DAYS * DAY_MS),
    }),
  );

  return noContent();
};
