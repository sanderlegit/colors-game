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

  it("lets a player recase their own name", async () => {
    const client = createClient();
    await playGame(client);
    await claim(client, "ada");
    await expect(jsonRecord(await claim(client, "Ada"))).resolves.toEqual({ name: "Ada" });
  });

  it("lets a name somebody else already holds be set as-is (ADR 0024)", async () => {
    // No suffix, no refusal: names are not unique, so the second `Ada` is `Ada`.
    const first = createClient();
    await playGame(first, { name: "Ada" });
    const second = createClient({ repo: () => first.repo }, "b");
    await playGame(second);
    await expect(jsonRecord(await claim(second, "Ada"))).resolves.toEqual({ name: "Ada" });
  });
});
