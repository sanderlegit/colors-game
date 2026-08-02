/**
 * `GET /api/leaderboard` → 200 `{ entries[] }`, optionally `?forGame=<gameId>`
 * for one seed's board (ADR 0026).
 *
 * Each entry is `{ rank, name, score, isYou, gameId }`. `Repo.topPlayers`
 * returns the rows in the board's order and carries `playerId` for exactly one
 * purpose: setting `isYou` against the caller's own id. The id must not reach
 * the response — it is a stable identifier for a person who has given us nothing
 * but a name, and the client has no use for it. `gameId` *does* go out: it is
 * how a row expands into its attempt and how the seed filter and share link
 * reference a game, and it is already public — `POST /games` hands one back.
 *
 * ## The seed filter
 *
 * `?forGame` names a game whose *seed* defines the board to show. The seed is
 * resolved from the row server-side and never appears in the query or the
 * response: the client works entirely in terms of the opaque `gameId`, so the
 * one-response seed rule (`hygiene.test.ts`) is untouched. An unknown or
 * unfinished game yields an empty board — a filter on a game that cannot anchor
 * one is a successful "nobody here", not an error.
 *
 * `isYou` is what makes this response identity-bearing, which is why
 * `http/json.ts` puts `Cache-Control: no-store` on everything: a shared cache
 * serving one player's board to another is the failure mode that only appears in
 * production, behind a CDN, and looks like a scoring bug.
 *
 * Ranks come from the row order, not from a per-row `countPlayersAbove` call —
 * the two agree by construction only because both use `best_score DESC, name
 * ASC`. See the note on `Repo.countPlayersAbove`.
 *
 * Reading the board never mints an identity: a visitor who has not played sees
 * the same rows with every `isYou` false.
 */

import type { Handler, RequestContext } from "../context";
import type { BoardRow } from "../db/repo";
import { jsonResponse } from "../http/json";
import { currentPlayer } from "../identity";

/**
 * Long enough that a regular player can find themselves on it, short enough that
 * the whole board is one response. There is no pagination and no `limit`
 * parameter: `src/platform/api.ts` sends neither, and a caller-chosen one is a
 * way to ask for the entire table.
 */
export const BOARD_SIZE = 50;

/**
 * The rows for a `?forGame` filter: the seed's board, or empty when the
 * referenced game does not exist. Resolving the seed is one extra read that the
 * global board does not pay.
 */
async function seedRows(context: RequestContext, forGame: string): Promise<readonly BoardRow[]> {
  const game = await context.repo.findGame(forGame);
  return game === null ? [] : context.repo.topPlayersBySeed(game.seed, BOARD_SIZE);
}

export const getLeaderboard: Handler = async (context: RequestContext): Promise<Response> => {
  const forGame = context.url.searchParams.get("forGame");
  const [rows, player] = await Promise.all([
    forGame === null ? context.repo.topPlayers(BOARD_SIZE) : seedRows(context, forGame),
    currentPlayer(context),
  ]);

  return jsonResponse(200, {
    entries: rows.map((row, index) => ({
      rank: index + 1,
      name: row.name,
      score: row.bestScore,
      isYou: player !== null && row.playerId === player.id,
      gameId: row.gameId,
    })),
  });
};
