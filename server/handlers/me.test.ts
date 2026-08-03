import { describe, expect, it } from "vitest";
import { createClient, jsonRecord, playGame } from "../app.fixture";

describe("GET /api/me", () => {
  it("answers 204 to a browser that has never played", async () => {
    // The normal answer, not an error. This runs on every page load.
    const client = createClient();
    const response = await client.send("GET", "/api/me");
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("mints nothing — no cookie, no row", async () => {
    const client = createClient();
    await client.send("GET", "/api/me");
    await client.send("GET", "/api/me");
    expect(client.token()).toBeNull();
    await expect(client.repo.findPlayerByTokenHash("hash:tok-1")).resolves.toBeNull();
  });

  it("answers 204 for a cookie naming nobody", async () => {
    // Indistinguishable from having no cookie, deliberately: a caller must not
    // be able to ask which tokens exist.
    const client = createClient();
    const response = await client.send("GET", "/api/me", { cookie: "not-a-real-token" });
    expect(response.status).toBe(204);
  });

  it("reports the identity once there is one", async () => {
    const client = createClient();
    await playGame(client, { name: "Ada" });
    const response = await client.send("GET", "/api/me");
    expect(response.status).toBe(200);
    const body = await jsonRecord(response);
    expect(body).toMatchObject({ name: "Ada", gamesPlayed: 1, rank: 1 });
    expect(body.bestScore).toBeGreaterThan(0);
  });

  it("has no rank until there is a name to put on the board", async () => {
    const client = createClient();
    await playGame(client);
    await expect(jsonRecord(await client.send("GET", "/api/me"))).resolves.toMatchObject({
      name: null,
      rank: null,
      gamesPlayed: 1,
    });
  });

  it("echoes the canonical name, because the client cannot read the cookie", async () => {
    // The stored, trimmed form is echoed back — and it may equal another
    // player's name, since names are not unique (ADR 0024).
    const first = createClient();
    await playGame(first, { name: "ada" });
    const second = createClient({ repo: () => first.repo }, "b");
    await playGame(second, { name: "  ada  " });
    await expect(jsonRecord(await second.send("GET", "/api/me"))).resolves.toMatchObject({
      name: "ada",
    });
  });
});

describe("no self-serve delete (ADR 0025)", () => {
  it("has no DELETE /api/me — deletion is an operator action", async () => {
    const client = createClient();
    await playGame(client, { name: "Ada" });
    // The route is gone; the router answers 405 for a method it does not have.
    const response = await client.send("DELETE", "/api/me");
    expect(response.status).toBe(405);
    // The player and their board row are untouched.
    await expect(client.repo.topPlayers(10, "best")).resolves.toMatchObject([{ name: "Ada" }]);
  });
});
