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

  it("carries no player id into the response", async () => {
    // `topPlayers` returns one so the handler can set `isYou`. It is a stable
    // identifier for somebody who has given us only a name, and the client has
    // no use for it.
    const host = createClient();
    await playGame(host, { name: "Ada" });
    for (const row of await board(host)) {
      expect(Object.keys(row).sort()).toEqual(["isYou", "name", "rank", "score"]);
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
});
