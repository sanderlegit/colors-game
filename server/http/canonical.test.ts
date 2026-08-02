import { describe, expect, it } from "vitest";

import { canonicalRedirect } from "./canonical";

const CANONICAL = "colors.aaadataplumbing.com";

function get(url: string): Request {
  return new Request(url);
}

describe("canonicalRedirect (ADR 0021)", () => {
  it("does nothing when no canonical host is configured", () => {
    // The property every local surface depends on: `wrangler dev` on
    // localhost, the e2e proxy, and a ts.net phone address all leave it unset.
    expect(canonicalRedirect(get("https://colors-game.pages.dev/api/me"), undefined)).toBeNull();
    expect(canonicalRedirect(get("http://localhost:8788/api/me"), undefined)).toBeNull();
  });

  it("treats an empty string as unset rather than as a host", () => {
    expect(canonicalRedirect(get("https://anything/api/me"), "")).toBeNull();
  });

  it("lets the canonical host through", () => {
    expect(canonicalRedirect(get(`https://${CANONICAL}/api/me`), CANONICAL)).toBeNull();
  });

  it("redirects the pages.dev hostname, which is the case it exists for", () => {
    const response = canonicalRedirect(get("https://colors-game.pages.dev/api/me"), CANONICAL);
    expect(response?.status).toBe(308);
    expect(response?.headers.get("location")).toBe(`https://${CANONICAL}/api/me`);
  });

  it("preserves the path and the query string", () => {
    const response = canonicalRedirect(
      get("https://colors-game.pages.dev/api/games/abc/result?x=1"),
      CANONICAL,
    );
    expect(response?.headers.get("location")).toBe(`https://${CANONICAL}/api/games/abc/result?x=1`);
  });

  it("uses 308 so a POST stays a POST", () => {
    // 301/302 permit a browser to rewrite the method to GET. That would turn a
    // score submission into a page load and lose the game silently.
    const response = canonicalRedirect(
      new Request("https://colors-game.pages.dev/api/games", { method: "POST", body: "{}" }),
      CANONICAL,
    );
    expect(response?.status).toBe(308);
  });

  it("drops a non-default port rather than carrying it to production", () => {
    const response = canonicalRedirect(get("https://preview.example.com:8788/x"), CANONICAL);
    expect(response?.headers.get("location")).toBe(`https://${CANONICAL}/x`);
  });

  it("is not cached, because the wrong hostname is a fact about the request", () => {
    const response = canonicalRedirect(get("https://colors-game.pages.dev/"), CANONICAL);
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  it("carries no body, so nothing leaks to the non-canonical origin", async () => {
    const response = canonicalRedirect(get("https://colors-game.pages.dev/api/me"), CANONICAL);
    expect(await response?.text()).toBe("");
  });
});
