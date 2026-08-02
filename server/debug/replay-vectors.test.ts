import { describe, expect, it } from "vitest";
import { createClient } from "../app.fixture";

/**
 * The gate, not the vectors. Whether workerd agrees about the vectors is
 * `e2e/replay-workerd.spec.ts`'s job and needs a real Worker; whether the route
 * is inert without `DEBUG_REPLAY` is a property of the shipped route table, and
 * that is what must hold in production.
 *
 * `app.fixture.ts` builds an `Env` with no `DEBUG_REPLAY` in it — which is
 * exactly the deployed `Env`, because `wrangler.toml` never sets it
 * (`tests/debug-flag.node.test.ts`).
 */
describe("the workerd replay route", () => {
  it("is a plain 404 without the flag, indistinguishable from an unrouted path", async () => {
    const client = createClient();

    const gated = await client.send("GET", "/debug/replay-vectors");
    const unrouted = await client.send("GET", "/debug/no-such-thing");

    expect(gated.status).toBe(404);
    expect(await gated.json()).toEqual(await unrouted.json());
  });
});
