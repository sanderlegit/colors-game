/**
 * The identity endpoints.
 *
 * ## `GET /api/me`
 *
 * 200 `{ name, bestScore, gamesPlayed, rank }` when the request carries a cookie
 * naming a known player, 204 otherwise. `rank` is null until they have a name
 * and a score; `name` is null until they claim one.
 *
 * **It must never mint a cookie.** This runs on every page load, including from
 * people who bounce, and an identity minted on arrival is a row for every
 * crawler plus a cookie banner conversation we do not need to have. The identity
 * is created on first *submission*, which is the first moment there is anything
 * to remember. A 204 here is the normal answer, not an error.
 *
 * The one write it does is `touchPlayer`, deferred with `waitUntil`: nothing in
 * this response reads `last_seen_at`, so making the player wait for it would buy
 * nothing. It is what `players_idle` is for.
 *
 * There is no delete endpoint. A player renames in the app (`POST /api/name`)
 * but cannot delete themselves; deletion is an operator action run out of band
 * (`just delete-player`, ADR 0025). So identity here is read-only apart from the
 * `waitUntil` touch — the only writes are the name set and the score submission.
 */

import type { Handler, RequestContext } from "../context";
import { jsonResponse, noContent } from "../http/json";
import { currentPlayer, rankOf } from "../identity";

/** On the board only with a name and a score, which is the partial index's rule. */
async function rankFor(
  context: RequestContext,
  player: { readonly id: number; readonly name: string | null; readonly bestScore: number },
): Promise<number | null> {
  if (player.name === null || player.bestScore <= 0) return null;
  return rankOf(context, player.bestScore, player.name, player.id);
}

export const getMe: Handler = async (context: RequestContext): Promise<Response> => {
  const player = await currentPlayer(context);
  if (player === null) return noContent();

  const rank = await rankFor(context, player);
  context.ctx.waitUntil(context.repo.touchPlayer(player.id, context.deps.now()));

  return jsonResponse(200, {
    name: player.name,
    bestScore: player.bestScore,
    gamesPlayed: player.gamesPlayed,
    rank,
  });
};
