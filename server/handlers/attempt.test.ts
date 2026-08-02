import { describe, expect, it } from "vitest";
import { generateTarget } from "../../src/domain/round";
import { ROUNDS_PER_GAME } from "../../src/domain/state";
import { asArray, asFiniteNumber, asRecord } from "../../src/shared/decode";
import {
  type Client,
  createClient,
  FIXTURE_SEED,
  GUESSES,
  jsonRecord,
  startGame,
} from "../app.fixture";
import { minimumElapsedMs } from "../limits";

/** Play one game to completion and answer with its id. */
async function finish(client: Client, name?: string): Promise<string> {
  const { gameId } = await startGame(client);
  client.setNow(client.now() + minimumElapsedMs(5000, ROUNDS_PER_GAME));
  await client.send("POST", `/api/games/${gameId}/result`, {
    body: { guesses: GUESSES, ...(name === undefined ? {} : { name }) },
  });
  return gameId;
}

function rounds(body: Record<string, unknown>): readonly Record<string, unknown>[] {
  const items = asArray(body.rounds) ?? [];
  return items.map((item) => asRecord(item) ?? {});
}

function coord(round: Record<string, unknown>, key: "target" | "guess", axis: string): number {
  const record = asRecord(round[key]);
  return record === null ? Number.NaN : (asFiniteNumber(record[axis]) ?? Number.NaN);
}

describe("GET /api/games/:gameId/attempt", () => {
  it("replays a finished game round by round, with the colours", async () => {
    const client = createClient();
    const gameId = await finish(client, "Ada");

    const body = await jsonRecord(await client.send("GET", `/api/games/${gameId}/attempt`));
    expect(body.totalScore).toEqual(expect.any(Number));
    const rows = rounds(body);
    expect(rows).toHaveLength(ROUNDS_PER_GAME);

    // The guess is the one that was submitted, round-tripped through JSON.
    expect(coord(rows[0] ?? {}, "guess", "L")).toBeCloseTo(GUESSES[0]?.L ?? 0, 6);
    // The target is what `generateTarget` produces for that seed and round — the
    // replay derives it, it is not stored.
    const target = generateTarget(FIXTURE_SEED, 0, "normal");
    expect(coord(rows[0] ?? {}, "target", "h")).toBeCloseTo(target.h, 6);
  });

  it("never carries the seed", async () => {
    const client = createClient();
    const gameId = await finish(client, "Ada");
    const text = await (await client.send("GET", `/api/games/${gameId}/attempt`)).text();
    expect(text).not.toContain("seed");
    expect(text).not.toContain(String(FIXTURE_SEED));
  });

  it("is a 404 for a game that does not exist", async () => {
    const client = createClient();
    const response = await client.send("GET", "/api/games/nope/attempt");
    expect(response.status).toBe(404);
  });

  it("is a 404 for a game that is not finished", async () => {
    const client = createClient();
    const { gameId } = await startGame(client);
    const response = await client.send("GET", `/api/games/${gameId}/attempt`);
    expect(response.status).toBe(404);
  });

  it("is a 404 for a flagged game, which the board never links to anyway", async () => {
    const client = createClient();
    const player = await client.repo.insertPlayer({ tokenHash: "hx", at: client.now() });
    await client.repo.insertGame({
      id: "flagged",
      playerId: player.id,
      seed: FIXTURE_SEED,
      difficulty: "normal",
      memorizeMs: 5000,
      kind: "open",
      startedAt: client.now(),
    });
    await client.repo.finishGame({
      gameId: "flagged",
      playerId: player.id,
      totalScore: 500,
      guessesJson: JSON.stringify(GUESSES),
      flags: 2,
      finishedAt: client.now(),
      name: null,
      nameKey: null,
    });
    const response = await client.send("GET", "/api/games/flagged/attempt");
    expect(response.status).toBe(404);
  });
});
