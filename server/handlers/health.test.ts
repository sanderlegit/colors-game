import { describe, expect, it } from "vitest";
import { createClient } from "../app.fixture";
import { memoryRepo } from "../db/memory";
import type { Repo } from "../db/repo";

/**
 * There are two health checks and the difference between them is the point.
 *
 * `/api/health` is liveness and must not touch D1. If it did, one D1 blip would
 * make every edge location report unhealthy at the same moment, and whatever is
 * watching would take out a Worker that is running perfectly well. The remedies
 * for "the Worker is down" and "the database is down" are different, so a probe
 * that cannot tell them apart sends you to the wrong one.
 *
 * `/api/health/deep` is the one you call by hand when something looks wrong.
 */

function repoWith(over: Partial<Repo>): () => Repo {
  const base = memoryRepo();
  const repo: Repo = { ...base, ...over };
  return (): Repo => repo;
}

describe("GET /api/health", () => {
  it("answers without asking the database anything", async () => {
    const client = createClient({
      repo: repoWith({
        ping: (): Promise<boolean> => {
          throw new Error("liveness must not reach the database");
        },
      }),
    });
    const response = await client.send("GET", "/api/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});

describe("GET /api/health/deep", () => {
  it("reports a reachable database", async () => {
    const client = createClient();
    const response = await client.send("GET", "/api/health/deep");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, database: true });
  });

  it("answers 503 when the database does not, and explains nothing", async () => {
    const client = createClient({
      repo: repoWith({ ping: (): Promise<boolean> => Promise.resolve(false) }),
    });
    const response = await client.send("GET", "/api/health/deep");
    expect(response.status).toBe(503);
    const body: unknown = await response.json();
    expect(body).toEqual({ ok: false, database: false });
    // The failure boundary's rule applies here too: no schema, no driver text.
    expect(JSON.stringify(body)).not.toContain("D1");
  });

  it("is a separate path, so nothing polling liveness picks it up by accident", async () => {
    const client = createClient();
    expect((await client.send("GET", "/api/health")).status).toBe(200);
    expect(client.logs().map((line) => line.event)).toEqual(["health_checked"]);

    await client.send("GET", "/api/health/deep");
    expect(client.logs()[1]?.event).toBe("dependencies_checked");
  });
});
