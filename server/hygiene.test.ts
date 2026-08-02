import { describe, expect, it } from "vitest";
import { createClient, GUESSES, playGame, startGame } from "./app.fixture";

/**
 * What must never leave the server, asserted across every endpoint at once
 * rather than one response shape at a time.
 *
 * The one that would really hurt is `seed`. The client is *given* a seed when a
 * game is issued — that is the contract, and the whole replay design rests on
 * it — but a seed in any *other* response hands a caller the ability to derive
 * targets for a game they have not been issued, or to precompute an answer
 * before submitting. `token` and `token_hash` are the identity's credential;
 * `player_id` is a stable identifier for somebody who gave us only a name;
 * `guesses_json` is the raw column, and a column name in a response body means
 * a row was passed through untranslated, which is how the other four escape.
 */

const FORBIDDEN: readonly string[] = ["seed", "token", "token_hash", "player_id", "guesses_json"];

/** Every key in the body, however deeply nested, with the path that reached it. */
function walk(value: unknown, path: string, found: string[]): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) walk(item, `${path}[${index}]`, found);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN.includes(key)) found.push(`${path}.${key}`);
    walk(nested, `${path}.${key}`, found);
  }
}

async function leaks(label: string, response: Response): Promise<readonly string[]> {
  const text = await response.text();
  if (text === "") return [];
  const found: string[] = [];
  walk(JSON.parse(text), label, found);
  return found;
}

describe("response hygiene", () => {
  it("leaks nothing from any endpoint a player can reach", async () => {
    const client = createClient();
    const played = await playGame(client, { name: "Ada" });

    const { gameId } = await startGame(client);
    const responses: readonly (readonly [string, Response])[] = [
      ["health", await client.send("GET", "/api/health")],
      ["me", await client.send("GET", "/api/me")],
      ["result", played],
      ["leaderboard", await client.send("GET", "/api/leaderboard")],
      ["name", await client.send("POST", "/api/name", { body: { name: "Grace" } })],
      // Every refusal, too: an error body is a response body.
      [
        "too-fast",
        await client.send("POST", `/api/games/${gameId}/result`, {
          body: { guesses: GUESSES },
        }),
      ],
      ["missing", await client.send("POST", "/api/games/nope/result", { body: { guesses: [] } })],
    ];

    for (const [label, response] of responses) {
      await expect(leaks(label, response)).resolves.toEqual([]);
    }
  });

  it("gives the seed to the one response whose contract is the seed", async () => {
    // The counterweight: the walker above must be failing for a reason, so this
    // pins the single deliberate exception.
    const client = createClient();
    const response = await client.send("POST", "/api/games", { body: { memorizeMs: 5000 } });
    await expect(leaks("games", response)).resolves.toEqual(["games.seed"]);
  });
});
