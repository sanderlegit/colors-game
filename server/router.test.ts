import { describe, expect, it } from "vitest";
import { createRouter, type Route } from "./router";

/**
 * The router is generic in its context type, so these tests use strings for
 * handlers and never touch a `Request`, an `Env`, or anything Cloudflare.
 */

type Ctx = { readonly label: string };

const handler =
  (name: string) =>
  (context: Ctx, params: Readonly<Record<string, string>>): Promise<Response> =>
    Promise.resolve(new Response(JSON.stringify({ name, context, params })));

const ROUTES: readonly Route<Ctx>[] = [
  { method: "GET", path: "/api/health", handle: handler("health") },
  { method: "GET", path: "/api/me", handle: handler("me") },
  { method: "DELETE", path: "/api/me", handle: handler("forget") },
  { method: "POST", path: "/api/games", handle: handler("start") },
  { method: "POST", path: "/api/games/:gameId/result", handle: handler("submit") },
];

const route = createRouter(ROUTES);

async function nameOf(match: ReturnType<typeof route>): Promise<string> {
  if (match.kind !== "found") throw new Error(`expected a match, got ${match.kind}`);
  const body: unknown = await (await match.handle({ label: "ctx" }, match.params)).json();
  return typeof body === "object" && body !== null && "name" in body ? String(body.name) : "?";
}

describe("createRouter", () => {
  it("matches a static path and method", async () => {
    expect(await nameOf(route("GET", "/api/health"))).toBe("health");
  });

  it("dispatches the same path to different handlers by method", async () => {
    expect(await nameOf(route("GET", "/api/me"))).toBe("me");
    expect(await nameOf(route("DELETE", "/api/me"))).toBe("forget");
  });

  it("is case-insensitive about the method", async () => {
    expect(await nameOf(route("get", "/api/health"))).toBe("health");
  });

  it("captures a single dynamic segment", () => {
    const match = route("POST", "/api/games/abc123/result");
    expect(match.kind === "found" && match.params).toEqual({ gameId: "abc123" });
  });

  it("percent-decodes a captured segment", () => {
    const match = route("POST", "/api/games/a%20b/result");
    expect(match.kind === "found" && match.params).toEqual({ gameId: "a b" });
  });

  it("treats an undecodable segment as no route rather than an error", () => {
    // `decodeURIComponent("%zz")` throws. A path nobody can decode matches
    // nothing; it must not become a 500.
    expect(route("POST", "/api/games/%zz/result").kind).toBe("none");
  });

  it("ignores empty segments, so a trailing slash still matches", async () => {
    expect(await nameOf(route("GET", "/api/health/"))).toBe("health");
    expect(await nameOf(route("GET", "//api//health"))).toBe("health");
  });

  it("does not let a dynamic segment swallow more than one segment", () => {
    expect(route("POST", "/api/games/a/b/result").kind).toBe("none");
  });

  it("reports an unknown path as none", () => {
    expect(route("GET", "/api/nope").kind).toBe("none");
    expect(route("GET", "/api/games/abc123").kind).toBe("none");
  });

  it("distinguishes a wrong method from an unknown path", () => {
    const match = route("POST", "/api/health");
    expect(match.kind).toBe("method");
    expect(match.kind === "method" && match.allow).toEqual(["GET"]);
  });

  it("collects every method a path accepts into Allow", () => {
    const match = route("PUT", "/api/me");
    expect(match.kind === "method" && match.allow).toEqual(["GET", "DELETE"]);
  });

  it("passes the context through untouched", async () => {
    const match = route("GET", "/api/health");
    if (match.kind !== "found") throw new Error("expected a match");
    const body: unknown = await (await match.handle({ label: "mine" }, {})).json();
    expect(body).toMatchObject({ context: { label: "mine" } });
  });

  it("matches nothing when there are no routes", () => {
    expect(createRouter<Ctx>([])("GET", "/api/health").kind).toBe("none");
  });
});
