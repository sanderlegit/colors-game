/**
 * `GET /api/games/:gameId/attempt` → 200 `{ totalScore, rounds[] }`.
 *
 * The breakdown a leaderboard row expands into (ADR 0025): for a finished game,
 * every round replayed into `{ deltaE, score, target, guess }`. It is the same
 * data the summary screen shows for the game you just played, for a game you did
 * not — so the colours are computed by replaying the pure core, never read from
 * a seed the client is handed.
 *
 * Public and identity-free by design: the board is public, so the attempts it
 * links to are too. It is reached only through a `gameId` the board already
 * handed out, and it serves exactly the games the board can reference —
 * `finished` and unflagged. Anything else answers 404 rather than distinguishing
 * "no such game" from "not viewable": the caller cannot act on the difference,
 * and the distinction would confirm a flagged game exists.
 *
 * **No seed leaves here.** The response carries the replayed colours, not the
 * seed that generated them, so the one-response seed rule (`hygiene.test.ts`,
 * ADR 0025) holds. Nor does it carry a name — the row the panel opened from
 * already shows it.
 */

import type { Handler, RequestContext } from "../context";
import { jsonResponse, problem } from "../http/json";
import { replayRounds } from "../replay";
import { storedGuesses } from "../stored";

export const getAttempt: Handler = async (
  context: RequestContext,
  params: Readonly<Record<string, string>>,
): Promise<Response> => {
  const game = await context.repo.findGame(params.gameId ?? "");
  if (game === null || game.status !== "finished" || game.flags !== 0) {
    return problem(404, "no_such_attempt", "No such attempt.");
  }

  const rounds = replayRounds(game.seed, game.difficulty, storedGuesses(game));
  return jsonResponse(200, {
    totalScore: game.totalScore,
    rounds: rounds.map((round) => ({
      deltaE: round.deltaE,
      score: round.score,
      target: round.target,
      guess: round.guess,
    })),
  });
};
