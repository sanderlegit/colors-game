import { describe, expect, it } from "vitest";
import { asArray, asRecord } from "../../src/shared/decode";
import { type Client, createClient, jsonRecord, playGame } from "../app.fixture";
import type { BoardRow, Repo } from "../db/repo";
import { BOARD_SIZE } from "./leaderboard";

/** A named player with a score, which is what it takes to reach the board. */
async function contender(shared: Client, prefix: string, name: string): Promise<Client> {
  const client = createClient({ repo: (): Repo => shared.repo }, prefix);
  client.setNow(shared.now());
  await playGame(client, { name });
  return client;
}

function entries(body: Record<string, unknown>): readonly Record<string, unknown>[] {
  const rows = asArray(body.entries) ?? [];
  return rows
    .map((row) => asRecord(row))
    .filter((row): row is Record<string, unknown> => row !== null);
}

async function board(client: Client, cookie?: null): Promise<readonly Record<string, unknown>[]> {
  const response = await client.send(
    "GET",
    "/api/leaderboard",
    cookie === null ? { cookie: null } : {},
  );
  expect(response.status).toBe(200);
  return entries(await jsonRecord(response));
}

describe("GET /api/leaderboard", () => {
  it("is empty before anybody has played", async () => {
    await expect(board(createClient())).resolves.toEqual([]);
  });

  it("ranks by the row order, one-based", async () => {
    const host = createClient();
    await playGame(host, { name: "Ada" });
    await contender(host, "b", "Grace");
    expect((await board(host)).map((row) => row.rank)).toEqual([1, 2]);
  });

  it("marks the caller's own row and nobody else's", async () => {
    const host = createClient();
    await playGame(host, { name: "Ada" });
    const other = await contender(host, "b", "Grace");
    const mine = (await board(host)).filter((row) => row.isYou === true);
    const theirs = (await board(other)).filter((row) => row.isYou === true);
    expect(mine.map((row) => row.name)).toEqual(["Ada"]);
    expect(theirs.map((row) => row.name)).toEqual(["Grace"]);
  });

  it("shows a visitor the same rows with nothing marked", async () => {
    const host = createClient();
    await playGame(host, { name: "Ada" });
    expect((await board(host, null)).map((row) => row.isYou)).toEqual([false]);
  });

  it("leaves off players with no name and players with no score", async () => {
    const host = createClient();
    await playGame(host, { name: "Ada" });
    const nameless = createClient({ repo: (): Repo => host.repo }, "b");
    nameless.setNow(host.now());
    await playGame(nameless);
    expect(await board(host)).toHaveLength(1);
  });

  it("carries the game id but no player id into the response", async () => {
    // `topPlayers` returns the player id so the handler can set `isYou`. It is a
    // stable identifier for somebody who has given us only a name, and stays
    // server-side. `gameId` does go out — a row expands into that game's attempt
    // (ADR 0024) — but the raw seed never does (`server/hygiene.test.ts`).
    const host = createClient();
    await playGame(host, { name: "Ada" });
    for (const row of await board(host)) {
      expect(Object.keys(row).sort()).toEqual(["gameId", "isYou", "name", "rank", "score"]);
    }
  });

  it("asks for a bounded number of rows, since the client cannot say", async () => {
    // There is no `limit` parameter on purpose: a caller-chosen one is a way to
    // ask for the whole table.
    let asked = -1;
    const inner = createClient().repo;
    const counting: Repo = {
      ...inner,
      topPlayers: (limit: number): Promise<readonly BoardRow[]> => {
        asked = limit;
        return inner.topPlayers(limit);
      },
    };
    await createClient({ repo: (): Repo => counting }).send("GET", "/api/leaderboard");
    expect(asked).toBe(BOARD_SIZE);
  });

  describe("?forGame — one seed's board (ADR 0024)", () => {
    async function seedBoard(
      client: Client,
      forGame: string,
    ): Promise<readonly Record<string, unknown>[]> {
      const response = await client.send("GET", `/api/leaderboard?forGame=${forGame}`);
      expect(response.status).toBe(200);
      return entries(await jsonRecord(response));
    }

    it("shows everyone who shares the seed of the named game", async () => {
      // Every fixture game is issued the same seed, so two players' ordinary
      // games already share one — which is the challenge case.
      const host = createClient();
      await playGame(host, { name: "Ada" });
      await contender(host, "b", "Grace");
      const anchor = (await board(host))[0]?.gameId;
      expect(typeof anchor).toBe("string");
      const names = (await seedBoard(host, String(anchor))).map((row) => row.name).sort();
      expect(names).toEqual(["Ada", "Grace"]);
    });

    it("is an empty board for a game that does not exist", async () => {
      const host = createClient();
      await playGame(host, { name: "Ada" });
      await expect(seedBoard(host, "nope")).resolves.toEqual([]);
    });

    it("marks the caller's own row on a filtered board too", async () => {
      const host = createClient();
      await playGame(host, { name: "Ada" });
      const anchor = String((await board(host))[0]?.gameId);
      const mine = (await seedBoard(host, anchor)).filter((row) => row.isYou === true);
      expect(mine.map((row) => row.name)).toEqual(["Ada"]);
    });
  });
});
