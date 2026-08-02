import { describe, expect, it } from "vitest";
import { createClient, jsonRecord, playGame } from "../app.fixture";
import { IDENTITY_COOKIE } from "../http/cookie";

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
    const first = createClient();
    await playGame(first, { name: "Ada" });
    const second = createClient({ repo: () => first.repo }, "b");
    await playGame(second, { name: "ada" });
    await expect(jsonRecord(await second.send("GET", "/api/me"))).resolves.toMatchObject({
      name: "ada-2",
    });
  });
});

describe("DELETE /api/me", () => {
  it("forgets the player, their games and their name", async () => {
    const client = createClient();
    await playGame(client, { name: "Ada" });
    const token = client.token();

    const response = await client.send("DELETE", "/api/me");
    expect(response.status).toBe(204);
    await expect(client.repo.findPlayerByTokenHash(`hash:${token}`)).resolves.toBeNull();
    await expect(client.repo.topPlayers(10)).resolves.toEqual([]);
  });

  it("sends a clearing cookie the browser will actually match", async () => {
    // Same Path, Secure and SameSite as the cookie was set with, or some
    // browsers treat it as a different cookie and delete nothing.
    const client = createClient();
    await playGame(client);
    const cookie = client.send("DELETE", "/api/me");
    const header = (await cookie).headers.get("set-cookie") ?? "";
    expect(header).toContain(`${IDENTITY_COOKIE}=;`);
    expect(header).toContain("Path=/");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Max-Age=0");
    expect(client.token()).toBeNull();
  });

  it("answers 204 to a caller who had nothing to forget", async () => {
    const client = createClient();
    expect((await client.send("DELETE", "/api/me")).status).toBe(204);
    expect((await client.send("DELETE", "/api/me", { cookie: "ghost" })).status).toBe(204);
  });

  it("frees the name for somebody else", async () => {
    const first = createClient();
    await playGame(first, { name: "Ada" });
    await first.send("DELETE", "/api/me");
    const second = createClient({ repo: () => first.repo }, "b");
    await expect(jsonRecord(await playGame(second, { name: "Ada" }))).resolves.toMatchObject({
      name: "Ada",
    });
  });
});
