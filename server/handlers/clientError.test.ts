import { describe, expect, it } from "vitest";
import { createClient } from "../app.fixture";
import { sha256Hex } from "../ids";
import { CLIENT_ERRORS_PER_BUCKET_PER_DAY, DAY_MS } from "../limits";

/**
 * The endpoint exists because a browser exception is the one failure the server
 * cannot see. Everything asserted here is about it not becoming a liability:
 * one broken browser must cost one row, and the report must carry nothing about
 * who sent it.
 */

const BOOM = {
  kind: "error",
  message: "TypeError: cannot read properties of null",
  stack: "at update (index-abc.js:1:200)",
};

/**
 * A client that hashes for real, rather than with the fixture's stand-in.
 *
 * Dedup is the whole design here and it is a property of the hash: the
 * stand-in echoes its input, so a 32-character fingerprint of two long stacks
 * that share a prefix would collide and every report would look deduplicated.
 */
function errorClient(): ReturnType<typeof createClient> {
  return createClient({ hashToken: sha256Hex });
}

function report(body: unknown): { readonly body: unknown } {
  return { body };
}

describe("POST /api/client-error", () => {
  it("takes a report and answers 204", async () => {
    const client = errorClient();
    const response = await client.send("POST", "/api/client-error", report(BOOM));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(client.repo.clientErrors()).toHaveLength(1);
  });

  it("deduplicates: one broken browser is one row, however often it reloads", async () => {
    const client = errorClient();
    for (let n = 0; n < 20; n += 1) {
      await client.send("POST", "/api/client-error", report(BOOM));
    }
    const stored = client.repo.clientErrors();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.n).toBe(20);
  });

  it("keeps different errors apart", async () => {
    const client = errorClient();
    await client.send("POST", "/api/client-error", report(BOOM));
    await client.send(
      "POST",
      "/api/client-error",
      report({ ...BOOM, message: "RangeError: out of range" }),
    );
    expect(client.repo.clientErrors()).toHaveLength(2);
  });

  it("stores nothing about who reported it", async () => {
    const client = errorClient();
    await client.send("POST", "/api/client-error", report(BOOM));
    const stored = JSON.stringify(client.repo.clientErrors());
    expect(stored).not.toContain("203.0.113");
    expect(stored).not.toContain("tok-");
    expect(stored).not.toContain("colors_id");
  });

  it("accepts a report with no stack, which is what a cross-origin script gives", async () => {
    const client = errorClient();
    const response = await client.send(
      "POST",
      "/api/client-error",
      report({ kind: "unhandledrejection", message: "Script error." }),
    );
    expect(response.status).toBe(204);
    expect(client.repo.clientErrors()[0]?.stack).toBeNull();
  });

  it("refuses a body that is not an error report", async () => {
    const client = errorClient();
    for (const body of [
      {},
      { kind: "error" },
      { message: "no kind" },
      { kind: "nonsense", message: "boom" },
      { kind: "error", message: "" },
      { kind: "error", message: "   " },
      { kind: "error", message: "boom", stack: 42 },
      { kind: "error", message: "x".repeat(301) },
      { kind: "error", message: "boom", stack: "y".repeat(2001) },
    ]) {
      const response = await client.send("POST", "/api/client-error", report(body));
      expect(response.status, JSON.stringify(body)).toBe(422);
    }
    expect(client.repo.clientErrors()).toHaveLength(0);
  });

  it("is CSRF-guarded like every other unsafe method", async () => {
    // `navigator.sendBeacon` issues a POST, and Fetch sets `Origin` on every
    // non-GET request, so the real reporter passes this and a script does not.
    const client = errorClient();
    const response = await client.send("POST", "/api/client-error", {
      body: BOOM,
      headers: { origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
  });

  it("rate-limits a caller inventing a fresh stack every time", async () => {
    const client = errorClient();
    let last = new Response();
    for (let n = 0; n <= CLIENT_ERRORS_PER_BUCKET_PER_DAY; n += 1) {
      last = await client.send(
        "POST",
        "/api/client-error",
        report({ ...BOOM, stack: `at frame ${n}` }),
      );
    }
    expect(last.status).toBe(429);
    expect(last.headers.get("retry-after")).not.toBeNull();
    expect(client.repo.clientErrors()).toHaveLength(CLIENT_ERRORS_PER_BUCKET_PER_DAY);
  });

  it("counts the error bucket separately from the identity bucket", async () => {
    // Sharing one counter would let a burst of error reports lock out the new
    // players behind the same NAT — the same reasoning as ADR 0015 § 3.
    const client = errorClient();
    for (let n = 0; n <= CLIENT_ERRORS_PER_BUCKET_PER_DAY; n += 1) {
      await client.send("POST", "/api/client-error", report({ ...BOOM, stack: `at ${n}` }));
    }
    expect((await client.send("POST", "/api/games", { body: { memorizeMs: 5000 } })).status).toBe(
      201,
    );
  });

  it("drops rows past the 30-day retention on the next write", async () => {
    const client = errorClient();
    await client.send("POST", "/api/client-error", report(BOOM));
    expect(client.repo.clientErrors()).toHaveLength(1);

    client.setNow(client.now() + 31 * DAY_MS);
    await client.send("POST", "/api/client-error", report({ ...BOOM, message: "later" }));
    const stored = client.repo.clientErrors();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.message).toBe("later");
  });

  it("logs the report as an ordinary request event and nothing else", async () => {
    const client = errorClient();
    await client.send("POST", "/api/client-error", report(BOOM));
    const logs = client.logs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ event: "client_error_reported", status: 204 });
  });
});
