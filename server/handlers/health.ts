/**
 * `GET /api/health` — liveness only.
 *
 * It deliberately does not touch D1. A health check that queries the database
 * turns every deploy-time probe into database load, and worse, it conflates "the
 * Worker is running" with "the database is reachable" — the two have different
 * remedies and a probe that cannot tell them apart sends you to the wrong one.
 *
 * It is also the one handler here that reads nothing about the caller, which is
 * why it is the only one whose response could safely be cached — and is not,
 * because `http/json.ts` makes no-store the default and this is not worth the
 * exception.
 */

import type { Handler, RequestContext } from "../context";
import { jsonResponse } from "../http/json";

export const health: Handler = (): Promise<Response> =>
  Promise.resolve(jsonResponse(200, { ok: true }));

/**
 * `GET /api/health/deep` — the dependency check, kept off the liveness path.
 *
 * This is the endpoint you call by hand when something looks wrong. It is
 * deliberately *not* what a load balancer or an uptime monitor polls: every edge
 * location would report unhealthy the moment D1 hiccups, which turns one
 * dependency's bad minute into a global outage signal and takes the Worker out
 * with it. Liveness and dependency health have different remedies, so they have
 * different URLs.
 *
 * 503 when the database does not answer, because a monitor that reads the status
 * line and not the body is the normal case. The body says nothing about *why* —
 * `Repo.ping` reports a boolean and never an error string, for the same reason
 * `app.ts`'s failure boundary says nothing: the failure describes our internals
 * to whoever provoked it.
 */
export const deepHealth: Handler = async (context: RequestContext): Promise<Response> => {
  const database = await context.repo.ping();
  return jsonResponse(database ? 200 : 503, { ok: database, database });
};
