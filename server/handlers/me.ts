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
 * ## `DELETE /api/me`
 *
 * 204 always, whether or not the cookie named anyone: telling an unauthenticated
 * caller which tokens exist is an oracle. Deletes the player and their games
 * (`Repo.deletePlayer`) and returns the clearing cookie from `http/cookie.ts`,
 * whose attributes must match the ones the cookie was set with or the browser
 * keeps it.
 */

import type { Handler, RequestContext } from "../context";
import { clearCookie, IDENTITY_COOKIE } from "../http/cookie";
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

export const forgetMe: Handler = async (context: RequestContext): Promise<Response> => {
  const player = await currentPlayer(context);
  if (player !== null) await context.repo.deletePlayer(player.id);
  // The clearing cookie goes out either way: a browser holding a token for a
  // player who is already gone should still drop it.
  return noContent({ "set-cookie": clearCookie(IDENTITY_COOKIE) });
};
