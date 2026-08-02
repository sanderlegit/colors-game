import { describe, expect, it } from "vitest";
import { createClient, playGame } from "../app.fixture";
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS, secured } from "./security";

/**
 * The headers are only worth anything if they are on *every* response, which is
 * why these assertions go through the whole app rather than calling `secured`
 * and stopping there: the 404s, the 405s and the 500s are where a per-handler
 * approach leaks, and they are the responses no handler owns.
 */

const REQUIRED: readonly string[] = [
  "content-security-policy",
  "strict-transport-security",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
];

describe("secured", () => {
  it("adds every header without disturbing status or body", async () => {
    const response = secured(new Response('{"a":1}', { status: 418, headers: { x: "kept" } }));
    expect(response.status).toBe(418);
    expect(response.headers.get("x")).toBe("kept");
    await expect(response.json()).resolves.toEqual({ a: 1 });
    for (const header of REQUIRED) expect(response.headers.get(header)).not.toBeNull();
  });

  it("survives a body-less response", () => {
    // A 204 with a body is malformed, so the copy must not invent one.
    expect(secured(new Response(null, { status: 204 })).status).toBe(204);
  });
});

describe("the policy", () => {
  it("locks the default and opens only what the app uses", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    // The load-bearing one: it gates /api/* and the error beacon.
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("base-uri 'none'");
  });

  it("has no inline escape hatch", () => {
    // The app has no inline script and no inline style attribute. If that ever
    // changes, this is where it has to be argued for rather than slipped in.
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-inline");
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval");
  });

  it("does not preload HSTS", () => {
    // Removal takes months to reach users; two years of max-age is the
    // commitment worth making before that one.
    expect(SECURITY_HEADERS["strict-transport-security"]).toBe(
      "max-age=63072000; includeSubDomains",
    );
    expect(SECURITY_HEADERS["strict-transport-security"]).not.toContain("preload");
  });

  it("sets neither of the two headers that are worse than nothing", () => {
    // X-XSS-Protection is deprecated and its filter has been a vulnerability;
    // frame-ancestors supersedes X-Frame-Options.
    expect(Object.keys(SECURITY_HEADERS)).not.toContain("x-xss-protection");
    expect(Object.keys(SECURITY_HEADERS)).not.toContain("x-frame-options");
  });
});

describe("every API response", () => {
  it("carries the headers, whatever the status", async () => {
    const client = createClient();
    const responses = [
      await client.send("GET", "/api/health"),
      await client.send("GET", "/api/leaderboard"),
      await client.send("GET", "/api/nope"),
      await client.send("POST", "/api/health"),
      await client.send("POST", "/api/games", { body: { memorizeMs: 5000 } }),
      await client.send("GET", "/api/me"),
    ];
    expect(responses.map((response) => response.status)).toEqual([200, 200, 404, 405, 201, 204]);

    for (const response of responses) {
      for (const header of REQUIRED) {
        expect(response.headers.get(header), `${response.status} is missing ${header}`).toBe(
          SECURITY_HEADERS[header],
        );
      }
    }
  });

  it("keeps the headers a handler set", async () => {
    const client = createClient();
    // `no-store` is the property `http/json.ts` exists to guarantee; the copy
    // `secured` makes must not drop it.
    const response = await client.send("GET", "/api/health");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });

  it("keeps Set-Cookie, which a naive header copy loses", async () => {
    // Set-Cookie is the header most likely to be mangled by a rebuild, and the
    // identity depends on it surviving intact. The first submission mints the
    // identity and is the response that carries the cookie.
    const client = createClient();
    const response = await playGame(client);
    expect(response.headers.get("set-cookie")).toContain("colors_id=");
  });
});
