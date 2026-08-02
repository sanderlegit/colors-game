import { describe, expect, it } from "vitest";
import { type Client, createClient, jsonRecord, playGame } from "../app.fixture";
import { MAX_NAME_LENGTH } from "../decode";

const claim = (client: Client, name: unknown): Promise<Response> =>
  client.send("POST", "/api/name", { body: { name } });

describe("POST /api/name", () => {
  it("claims a name for a player who has played", async () => {
    const client = createClient();
    await playGame(client);
    const response = await claim(client, "  Ada Lovelace  ");
    expect(response.status).toBe(200);
    // Trimmed and collapsed, but their own casing.
    await expect(jsonRecord(response)).resolves.toEqual({ name: "Ada Lovelace" });
  });

  it("refuses a caller with no identity, rather than minting one", async () => {
    const client = createClient();
    const response = await claim(client, "Ada");
    expect(response.status).toBe(401);
    expect(client.token()).toBeNull();
  });

  it("refuses an identity that has not finished a game", async () => {
    // What makes bulk squatting cost a playthrough each rather than a request.
    const client = createClient();
    await playGame(client);
    await client.repo.deletePlayer(1);
    const player = await client.repo.insertPlayer({ tokenHash: `hash:${client.token()}`, at: 0 });
    expect(player.gamesPlayed).toBe(0);
    expect((await claim(client, "Ada")).status).toBe(403);
  });

  it("refuses a name that is not a name", async () => {
    const client = createClient();
    await playGame(client);
    for (const name of ["", "   ", 42, "a".repeat(MAX_NAME_LENGTH + 1), "ad\u200ba"]) {
      expect((await claim(client, name)).status).toBe(422);
    }
  });

  it("refuses a body it cannot read", async () => {
    const client = createClient();
    await playGame(client);
    const response = await client.send("POST", "/api/name", {
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(400);
  });

  it("lets a player recase their own name without colliding with themselves", async () => {
    const client = createClient();
    await playGame(client);
    await claim(client, "ada");
    await expect(jsonRecord(await claim(client, "Ada"))).resolves.toEqual({ name: "Ada" });
  });

  it("suffixes around a taken name and answers with what landed", async () => {
    const first = createClient();
    await playGame(first, { name: "Ada" });
    const second = createClient({ repo: () => first.repo }, "b");
    await playGame(second);
    await expect(jsonRecord(await claim(second, "Ada"))).resolves.toEqual({ name: "Ada-2" });
  });

  it("walks the numbered ladder, then falls back to something random", async () => {
    // Bounded on purpose: a squatter holding every numbered variant must not be
    // able to make each later claim cost an unbounded number of writes.
    const host = createClient();
    await playGame(host, { name: "Ada" });
    for (let n = 2; n <= 8; n += 1) {
      const holder = createClient({ repo: () => host.repo }, `h${n}`);
      await playGame(holder);
      await expect(jsonRecord(await claim(holder, "Ada"))).resolves.toEqual({ name: `Ada-${n}` });
    }

    const last = createClient({ repo: () => host.repo }, "last");
    await playGame(last);
    const body = await jsonRecord(await claim(last, "Ada"));
    expect(String(body.name)).toMatch(/^Ada-[2-9b-z]{4}$/);
  });

  it("keeps a suffixed name inside the length a board row can show", async () => {
    // `src/platform/api.ts` refuses a name past the bound, so an overlong
    // suffixed name would make the whole response unreadable to the client.
    const full = "a".repeat(MAX_NAME_LENGTH);
    const first = createClient();
    await playGame(first, { name: full });
    const second = createClient({ repo: () => first.repo }, "b");
    await playGame(second);
    const body = await jsonRecord(await claim(second, full));
    expect([...String(body.name)].length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    expect(String(body.name).endsWith("-2")).toBe(true);
  });
});
