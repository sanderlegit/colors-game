import { describe, expect, it } from "vitest";
import { createClient, GUESSES, playGame, SITE, startGame } from "./app.fixture";
import { sha256Hex } from "./ids";
import { PLAYER_KEY_LENGTH, playerKey, requestRecord, traceContext, traceIdFrom } from "./log";

/**
 * Two kinds of assertion live here and they are not interchangeable.
 *
 * The first is the *shape* of the record — the fields a query will be written
 * against, which are a contract with whoever is debugging at 2am.
 *
 * The second is the part that matters: what must never appear. Those tests are
 * written against a whole played game rather than a hand-built record, because
 * the failure mode is not "the formatter is wrong", it is "somebody logged the
 * request". A test of the formatter alone would pass while the token was being
 * written to the log store by a line three files away.
 */

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const PARENT = "00f067aa0ba902b7";

function record(headers: Readonly<Record<string, string>> = {}) {
  return requestRecord({
    at: 1_700_000_000_000,
    trace: { traceId: TRACE, requestId: PARENT },
    method: "POST",
    route: "/api/games/:gameId/result",
    event: "score_submitted",
    status: 200,
    durationMs: 4,
    player: "0123456789ab",
    request: new Request(`${SITE}/api/games/secret-token/result`, { method: "POST", headers }),
  });
}

describe("traceparent", () => {
  it("adopts a valid trace id", () => {
    expect(traceIdFrom(`00-${TRACE}-${PARENT}-01`)).toBe(TRACE);
  });

  it("is case-insensitive and tolerates surrounding space", () => {
    expect(traceIdFrom(` 00-${TRACE.toUpperCase()}-${PARENT}-01 `)).toBe(TRACE);
  });

  it("refuses what it cannot join rather than inventing a near-match", () => {
    for (const header of [
      null,
      "",
      "garbage",
      `00-${TRACE}-${PARENT}`, // truncated
      `00-${TRACE}-${PARENT}-01-extra`,
      `00-${TRACE.slice(0, 30)}-${PARENT}-01`, // short trace id
      `ff-${TRACE}-${PARENT}-01`, // reserved version
      `00-${"0".repeat(32)}-${PARENT}-01`, // all-zero trace id is invalid
      `00-${TRACE.replace("4", "g")}-${PARENT}-01`, // not hex
    ]) {
      expect(traceIdFrom(header), `accepted ${String(header)}`).toBeNull();
    }
  });

  it("mints a trace id per request when there is none, and a request id always", () => {
    let n = 0;
    const newId = (bytes: number): string => {
      n += 1;
      return `${n}`.padStart(bytes * 2, "0");
    };
    const carried = traceContext(
      new Request(SITE, { headers: { traceparent: `00-${TRACE}-${PARENT}-01` } }),
      newId,
    );
    expect(carried.traceId).toBe(TRACE);
    expect(carried.requestId).toHaveLength(16);

    const fresh = traceContext(new Request(SITE), newId);
    expect(fresh.traceId).toHaveLength(32);
    expect(fresh.requestId).not.toBe(carried.requestId);
  });
});

describe("the record", () => {
  it("carries the baseline fields", () => {
    expect(record()).toMatchObject({
      "@timestamp": "2023-11-14T22:13:20.000Z",
      level: "info",
      severity_number: 9,
      service: "colors-api",
      request_id: PARENT,
      trace_id: TRACE,
      event: "score_submitted",
      duration_ms: 4,
      status: 200,
      "http.request.method": "POST",
    });
  });

  it("reports the route pattern, never the path that carries the game id", () => {
    // The game id *is* the single-use submit token. A path in a log line is a
    // bearer credential in a log line.
    const line = JSON.stringify(record());
    expect(line).not.toContain("secret-token");
    expect(record()["url.path"]).toBe("/api/games/:gameId/result");
  });

  it("logs only the allow-listed headers", () => {
    const built = record({
      cookie: "colors_id=super-secret-token",
      authorization: "Bearer nope",
      "cf-connecting-ip": "203.0.113.7",
      "x-forwarded-for": "203.0.113.7",
      "user-agent": "Mozilla/5.0",
      "cf-ray": "8a1b2c3d4e5f6789-AMS",
    });
    expect(built["user_agent.original"]).toBe("Mozilla/5.0");
    expect(built["cloudflare.ray"]).toBe("8a1b2c3d4e5f6789-AMS");

    const line = JSON.stringify(built);
    for (const forbidden of ["super-secret-token", "Bearer nope", "203.0.113.7", "cookie"]) {
      expect(line, `${forbidden} reached the log`).not.toContain(forbidden);
    }
  });

  it("bounds a caller-chosen header", () => {
    const built = record({ "user-agent": "x".repeat(5000) });
    expect(String(built["user_agent.original"])).toHaveLength(200);
  });

  it("grades the level and the OpenTelemetry severity by status", () => {
    const at = (status: number): Readonly<Record<string, string | number>> =>
      requestRecord({
        at: 0,
        trace: { traceId: TRACE, requestId: PARENT },
        method: "GET",
        route: "/api/health",
        event: "health_checked",
        status,
        durationMs: 0,
        player: null,
        request: new Request(SITE),
      });
    expect(at(200)).toMatchObject({ level: "info", severity_number: 9 });
    expect(at(404)).toMatchObject({ level: "warn", severity_number: 13 });
    expect(at(500)).toMatchObject({ level: "error", severity_number: 17 });
  });

  it("omits the player key entirely when there is no identity", () => {
    // Absent, not null: a null would be a field every query has to exclude.
    expect(
      requestRecord({
        at: 0,
        trace: { traceId: TRACE, requestId: PARENT },
        method: "GET",
        route: "/api/health",
        event: "health_checked",
        status: 200,
        durationMs: 0,
        player: null,
        request: new Request(SITE),
      }),
    ).not.toHaveProperty("player.key");
  });
});

describe("the player key", () => {
  const hash = async (value: string): Promise<string> => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    let hex = "";
    for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, "0");
    return hex;
  };

  it("is short, stable, and unlike the token", async () => {
    const key = await playerKey("a-token", "a-pepper", hash);
    expect(key).toHaveLength(PLAYER_KEY_LENGTH);
    expect(key).toMatch(/^[0-9a-f]+$/);
    expect(key).toBe(await playerKey("a-token", "a-pepper", hash));
    expect(key).not.toContain("a-token");
  });

  it("changes with the pepper, which is what makes it meaningless off-isolate", async () => {
    expect(await playerKey("a-token", "one", hash)).not.toBe(
      await playerKey("a-token", "two", hash),
    );
  });

  it("separates the token from the pepper", async () => {
    // Without a separator, ("ab", "c") and ("a", "bc") would be one player.
    expect(await playerKey("ab", "c", hash)).not.toBe(await playerKey("a", "bc", hash));
  });
});

describe("one wide event per request", () => {
  it("emits exactly one line per request, whatever the outcome", async () => {
    const client = createClient();
    await client.send("GET", "/api/health");
    await client.send("GET", "/api/nope");
    await client.send("POST", "/api/health");
    expect(client.logs()).toHaveLength(3);
    expect(client.logs().map((line) => line.status)).toEqual([200, 404, 405]);
  });

  it("names the event from the route table", async () => {
    const client = createClient();
    await playGame(client);
    expect(client.logs().map((line) => line.event)).toEqual(["game_started", "score_submitted"]);
  });

  it("does not echo an attacker-chosen path", async () => {
    const client = createClient();
    await client.send("GET", "/api/%3Cscript%3E-and-friends");
    const line = client.logs()[0];
    expect(line?.["url.path"]).toBe("(unrouted)");
    expect(line?.event).toBe("not_routed");
  });

  it("carries an incoming trace id across the request", async () => {
    const client = createClient();
    await client.send("GET", "/api/health", {
      headers: { traceparent: `00-${TRACE}-${PARENT}-01` },
    });
    expect(client.logs()[0]?.trace_id).toBe(TRACE);
  });

  it("logs a 500 at error level without the fault's text", async () => {
    const client = createClient({
      repo: () => {
        throw new Error("D1_ERROR: no such table: players");
      },
    });
    await client.send("GET", "/api/me");
    const line = client.logs()[0];
    expect(line).toMatchObject({ level: "error", severity_number: 17, status: 500 });
    expect(JSON.stringify(line)).not.toContain("players");
  });

  it("never writes the identity token, however the request is shaped", async () => {
    // The whole point, asserted across a real session: mint an identity by
    // playing, then use it. The token is in the cookie jar on every later hop.
    //
    // The *real* SHA-256, not the fixture's `hash:${token}` stand-in — that one
    // echoes its input, so a log line carrying it would look like a leak and a
    // log line carrying a real digest would look clean whatever it held. This is
    // the one test where the difference is the test.
    const client = createClient({ hashToken: sha256Hex });
    await playGame(client, { name: "Ada" });
    const token = client.token();
    expect(token).not.toBeNull();

    await client.send("GET", "/api/me");
    await client.send("GET", "/api/leaderboard");
    const { gameId } = await startGame(client);
    await client.send("POST", `/api/games/${gameId}/result`, { body: { guesses: GUESSES } });

    const all = JSON.stringify(client.logs());
    expect(all).not.toContain(token ?? "impossible");
    expect(all).not.toContain("colors_id");
    expect(all).not.toContain(gameId);
  });

  it("groups a player's requests under one key without naming them", async () => {
    const client = createClient();
    await playGame(client);
    await client.send("GET", "/api/me");
    await client.send("GET", "/api/leaderboard");

    const keys = client.logs().map((line) => line["player.key"]);
    // The first two requests were made before the identity existed.
    expect(keys.slice(0, 2)).toEqual([undefined, undefined]);
    const identified = keys.slice(2);
    expect(identified).toHaveLength(2);
    expect(new Set(identified).size).toBe(1);
    expect(String(identified[0])).toHaveLength(PLAYER_KEY_LENGTH);
  });

  it("never logs the caller's address", async () => {
    const client = createClient();
    await client.send("POST", "/api/games", { body: { memorizeMs: 5000 }, ip: "203.0.113.7" });
    expect(JSON.stringify(client.logs())).not.toContain("203.0.113.7");
  });
});

describe("logging can never take down a request", () => {
  it("answers normally when the emit sink throws", async () => {
    // The log runs after the response exists, outside `app.ts`'s failure
    // boundary. An escaping throw there is an unhandled rejection, which a
    // Worker renders as an opaque platform error page — turning a good 200 into
    // a 500 because a log line failed.
    const client = createClient({
      emit: (): void => {
        throw new Error("the log sink is down");
      },
    });
    expect((await client.send("GET", "/api/health")).status).toBe(200);
  });

  it("answers normally when the player-key hash rejects", async () => {
    const client = createClient({
      hashToken: (): Promise<string> => Promise.reject(new Error("subtle crypto is unavailable")),
    });
    // A cookie is present, so the logger does try to derive a player key.
    expect((await client.send("GET", "/api/health", { cookie: "anything" })).status).toBe(200);
  });
});
