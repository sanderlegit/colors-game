/**
 * One wide structured event per request, and one per scheduled sweep. This file
 * builds the records; `app.ts` and `sweep.ts` emit them through the same
 * `deps.emit` port, and nothing else in the backend logs anything.
 *
 * ## Why there is no logging library
 *
 * Workers Logs *is* `console.log`: Cloudflare parses a JSON line and indexes its
 * fields, so `console.log(JSON.stringify(record))` is already structured,
 * queryable logging. A library would wrap indexing the platform performs anyway.
 * It is in `docs/adr/README.md` § Already rejected; do not re-propose it.
 *
 * ## Why one event and not several lines
 *
 * The free plan allows 200,000 log events a day against a 100,000 request/day
 * Worker cap — about two lines per request. One wide event per request is
 * therefore the budget, not a style preference. A field is cheap; a line is not.
 *
 * ## What must never appear here
 *
 * - **The identity token, in any form.** It is a session identifier under the
 *   OWASP Logging Cheat Sheet's exclusion list. To group one player's requests
 *   while debugging, `playerKey` logs the first 12 hex of a peppered SHA-256.
 * - **`CF-Connecting-IP`.** It exists inside one request, becomes a mint bucket,
 *   and is gone (ADR 0015). It is not in the allow-list below and must not be.
 * - **The raw path.** `/api/games/:gameId/result` carries the game id, and that
 *   id *is* the single-use submit token — logging the path would log a bearer
 *   credential. `url.path` is therefore the matched route pattern, never
 *   `url.pathname`.
 * - **Whole headers.** The failure that actually happens is a debugging
 *   `console.log({headers: [...request.headers]})`, which puts `Cookie` — and
 *   therefore the token — into the log store. Headers are allow-listed below and
 *   `tests/logging.node.test.ts` fails the build on a raw dump anywhere in
 *   `server/**`.
 */

/** Every record carries it, so logs from several Workers can share an index. */
const SERVICE = "colors-api";

/**
 * OpenTelemetry severity numbers. Kept beside the textual level because
 * `severity_number` is what sorts and filters correctly; `level` is for humans.
 */
const SEVERITY: Readonly<Record<LogLevel, number>> = { info: 9, warn: 13, error: 17 };

export type LogLevel = "info" | "warn" | "error";

/**
 * The headers worth having and the ECS field each lands in. **This list is the
 * security boundary.** Anything not named here is not logged, which is the only
 * form of this rule that survives somebody debugging in a hurry.
 */
const LOGGED_HEADERS: readonly (readonly [string, string])[] = [
  ["user-agent", "user_agent.original"],
  ["content-type", "http.request.mime_type"],
  ["cf-ray", "cloudflare.ray"],
];

/** A user agent is the only unbounded value here, and a caller chooses it. */
const MAX_HEADER_LENGTH = 200;

/** What a scheduled sweep run is called in the logs. */
export const SWEEP_EVENT = "retention_swept";

/**
 * A thrown message is ours — a D1 error or a bug — never a caller's string, but
 * it is still unbounded, and one wide event is the whole budget.
 */
const MAX_ERROR_LENGTH = 200;

export type TraceContext = {
  /** 32 hex. Adopted from an incoming `traceparent` when there is a valid one. */
  readonly traceId: string;
  /** 16 hex, minted per hop, so two Workers never claim the same one. */
  readonly requestId: string;
};

const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/**
 * The trace id from a W3C `traceparent`, or `null`.
 *
 * Strict on purpose. An unparseable header is not a reason to invent a trace id
 * that half-matches the caller's; version `ff` is reserved and an all-zero trace
 * id is explicitly invalid, and adopting either would corrupt somebody's trace
 * rather than join it.
 */
export function traceIdFrom(header: string | null): string | null {
  if (header === null) return null;
  const match = TRACEPARENT.exec(header.trim().toLowerCase());
  if (match === null) return null;
  const version = match[1];
  const traceId = match[2];
  if (version === undefined || traceId === undefined) return null;
  if (version === "ff" || /^0+$/.test(traceId)) return null;
  return traceId;
}

export function traceContext(request: Request, newId: (bytes: number) => string): TraceContext {
  return {
    traceId: traceIdFrom(request.headers.get("traceparent")) ?? newId(16),
    requestId: newId(8),
  };
}

/** Long enough to group a session's requests, far too short to invert. */
export const PLAYER_KEY_LENGTH = 12;

/**
 * A stable, non-reversible handle for one identity.
 *
 * The pepper is deploy-scoped (`LOG_PEPPER`, ADR 0030), so the key groups a
 * player's requests across isolates for the log's 3-day life and still means
 * nothing outside the log store — it is never the DB `token_hash`. Without the
 * secret it falls back to a per-isolate random, grouping nothing globally.
 * NUL-separated so no token can be padded into another's key.
 */
export async function playerKey(
  token: string,
  pepper: string,
  hash: (value: string) => Promise<string>,
): Promise<string> {
  return (await hash(`${token}\u0000${pepper}`)).slice(0, PLAYER_KEY_LENGTH);
}

export type RequestLog = {
  /** ms since epoch, from the injected clock. */
  readonly at: number;
  readonly trace: TraceContext;
  readonly method: string;
  /** The matched route *pattern*. Never `url.pathname` — see the header. */
  readonly route: string;
  readonly event: string;
  readonly status: number;
  readonly durationMs: number;
  /** `playerKey`, or `null` for a request carrying no identity. */
  readonly player: string | null;
  readonly request: Request;
};

function levelFor(status: number): LogLevel {
  if (status >= 500) return "error";
  return status >= 400 ? "warn" : "info";
}

/**
 * The record, in ECS field order with OpenTelemetry names.
 *
 * Returned rather than emitted so it can be asserted on directly: a test that
 * had to parse stdout would be a test of the test harness.
 */
export function requestRecord(input: RequestLog): Readonly<Record<string, string | number>> {
  const level = levelFor(input.status);
  const record: Record<string, string | number> = {
    "@timestamp": new Date(input.at).toISOString(),
    level,
    severity_number: SEVERITY[level],
    message: `${input.method} ${input.route} ${input.status}`,
    service: SERVICE,
    request_id: input.trace.requestId,
    trace_id: input.trace.traceId,
    event: input.event,
    duration_ms: input.durationMs,
    status: input.status,
    "http.request.method": input.method,
    "url.path": input.route,
  };
  if (input.player !== null) record["player.key"] = input.player;
  for (const [header, field] of LOGGED_HEADERS) {
    const value = input.request.headers.get(header);
    if (value !== null) record[field] = value.slice(0, MAX_HEADER_LENGTH);
  }
  return record;
}

export type SweepLog = {
  readonly at: number;
  /** The trigger's own schedule expression, so a second cron would be distinguishable. */
  readonly cron: string;
  readonly durationMs: number;
  /** Rows removed, per pass. The field name is the log field's suffix. */
  readonly counts: Readonly<Record<string, number>>;
  /** Passes that threw. Their counts are reported as 0, not omitted. */
  readonly failed: readonly string[];
  /** Passes that hit their `LIMIT`, so there is a backlog for the next run. */
  readonly capped: readonly string[];
  /** The first failure's message, or `null`. */
  readonly error: string | null;
};

/**
 * The sweep's one wide event.
 *
 * **This is the only evidence the job ran at all.** A cron that silently stops
 * firing looks exactly like a cron with nothing to do, and the difference is
 * whether this line exists — so a run that deleted nothing still emits one.
 *
 * There is no request here, so there is no `player.key`, no header allow-list
 * and no `url.path`: a sweep touches every row of a table and belongs to nobody.
 * `service`, `level` and the timestamp match `requestRecord` so both streams
 * sort and filter together.
 */
export function sweepRecord(input: SweepLog): Readonly<Record<string, string | number>> {
  const level: LogLevel = input.failed.length > 0 ? "error" : "info";
  const rows = Object.values(input.counts).reduce((total, n) => total + n, 0);
  const record: Record<string, string | number> = {
    "@timestamp": new Date(input.at).toISOString(),
    level,
    severity_number: SEVERITY[level],
    message: `sweep removed ${rows} rows, ${input.failed.length} passes failed`,
    service: SERVICE,
    event: SWEEP_EVENT,
    duration_ms: input.durationMs,
    "sweep.cron": input.cron,
    "sweep.rows": rows,
  };
  for (const [pass, n] of Object.entries(input.counts)) record[`sweep.${pass}`] = n;
  // Absent rather than empty when there is nothing to say: a field that is
  // always present is a field nobody filters on.
  if (input.capped.length > 0) record["sweep.capped"] = input.capped.join(",");
  if (input.failed.length > 0) record["sweep.failed"] = input.failed.join(",");
  if (input.error !== null) record["sweep.error"] = input.error.slice(0, MAX_ERROR_LENGTH);
  return record;
}
