/**
 * `GET /api/leaderboard` → 200 `{ entries[] }`.
 *
 * Each entry is `{ rank, name, score, isYou }`. `Repo.topPlayers` returns the
 * rows in the board's order and carries `playerId` for exactly one purpose:
 * setting `isYou` against the caller's own id. The id must not reach the
 * response — it is a stable identifier for a person who has given us nothing but
 * a name, and the client has no use for it.
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
import { jsonResponse } from "../http/json";
import { currentPlayer } from "../identity";

/**
 * Long enough that a regular player can find themselves on it, short enough that
 * the whole board is one response. There is no pagination and no `limit`
 * parameter: `src/platform/api.ts` sends neither, and a caller-chosen one is a
 * way to ask for the entire table.
 */
export const BOARD_SIZE = 50;

export const getLeaderboard: Handler = async (context: RequestContext): Promise<Response> => {
  const [rows, player] = await Promise.all([
    context.repo.topPlayers(BOARD_SIZE),
    currentPlayer(context),
  ]);

  return jsonResponse(200, {
    entries: rows.map((row, index) => ({
      rank: index + 1,
      name: row.name,
      score: row.bestScore,
      isYou: player !== null && row.playerId === player.id,
    })),
  });
};
