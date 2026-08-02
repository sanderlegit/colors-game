import { describe, expect, it } from "vitest";
import { isSameOrigin, isUnsafeMethod } from "./origin";

const SITE = "https://colors.example";

function request(url: string, origin?: string): Request {
  return new Request(url, {
    method: "POST",
    ...(origin === undefined ? {} : { headers: { origin } }),
  });
}

describe("isUnsafeMethod", () => {
  it("covers the state-changing methods this API uses", () => {
    expect(isUnsafeMethod("POST")).toBe(true);
    expect(isUnsafeMethod("DELETE")).toBe(true);
  });

  it("leaves the safe ones alone", () => {
    // Browsers routinely omit `Origin` on same-origin GETs, so guarding them
    // would reject real traffic to change nothing.
    expect(isUnsafeMethod("GET")).toBe(false);
    expect(isUnsafeMethod("HEAD")).toBe(false);
    expect(isUnsafeMethod("OPTIONS")).toBe(false);
  });

  it("does not care about case", () => {
    expect(isUnsafeMethod("post")).toBe(true);
    expect(isUnsafeMethod("get")).toBe(false);
  });
});

describe("isSameOrigin", () => {
  it("accepts an Origin naming this very origin", () => {
    expect(isSameOrigin(request(`${SITE}/api/games`, SITE))).toBe(true);
  });

  it("rejects a different host", () => {
    expect(isSameOrigin(request(`${SITE}/api/games`, "https://evil.example"))).toBe(false);
  });

  it("rejects a different scheme on the same host", () => {
    expect(isSameOrigin(request(`${SITE}/api/games`, "http://colors.example"))).toBe(false);
  });

  it("rejects a different port on the same host", () => {
    expect(isSameOrigin(request("http://localhost:8788/api/games", "http://localhost:5173"))).toBe(
      false,
    );
  });

  it("accepts a matching origin with an explicit port", () => {
    expect(isSameOrigin(request("http://localhost:8788/api/games", "http://localhost:8788"))).toBe(
      true,
    );
  });

  it("rejects a missing Origin", () => {
    // Every browser sends `Origin` on POST, so its absence never describes a
    // real player — treating absent as allowed is how this check ends up doing
    // nothing at all.
    expect(isSameOrigin(request(`${SITE}/api/games`))).toBe(false);
  });

  it("rejects the opaque origin a sandboxed frame sends", () => {
    expect(isSameOrigin(request(`${SITE}/api/games`, "null"))).toBe(false);
  });

  it("ignores the path and query, comparing origins only", () => {
    expect(isSameOrigin(request(`${SITE}/api/games?x=1`, SITE))).toBe(true);
  });

  it("rejects an Origin that is a prefix of ours", () => {
    expect(isSameOrigin(request("https://colors.example.evil/api/games", SITE))).toBe(false);
  });
});
