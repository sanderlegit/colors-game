/**
 * `POST /api/name` → 200 `{ name }`.
 *
 * Body `{ name }`, validated and folded by `decodeName`, which returns both the
 * display form (the player's own casing) and the folded `key` the row is marked
 * named by. Names are not unique (ADR 0024), so the set always lands and the
 * response echoes the same name back — the client keeps its own casing, and
 * there is no suffix to discover.
 *
 * Requires an identity. A player who has not submitted a game has no row to
 * attach a name to, so this answers 401 rather than minting one; the name is
 * set with the submission (`submit.ts`) or after it.
 *
 * **And it requires a game played**, which is what makes squatting expensive: an
 * empty identity cannot hold a name, so reserving one costs a full ~28-second
 * playthrough rather than an HTTP request. That is a 403 rather than a 401 — the
 * caller is authenticated, and is being told what to do about it.
 *
 * `players.name_changes` and `name_changed_at` exist so a rename can be rate
 * limited. Nothing enforces a limit yet — that is a product decision, and this
 * comment is the note to make it deliberately rather than by omission.
 */

import type { Handler, RequestContext } from "../context";
import { decodeName, MAX_NAME_LENGTH, readJsonBody } from "../decode";
import { jsonResponse, problem } from "../http/json";
import { currentPlayer } from "../identity";
import { setPlayerName } from "../names";

const PLAY_FIRST = "Play a game before choosing a name.";

export const setUsername: Handler = async (context: RequestContext): Promise<Response> => {
  const body = await readJsonBody(context.request);
  if (body === null) return problem(400, "bad_request", "That request could not be read.");

  const named = decodeName(body);
  if (named === null) {
    return problem(
      422,
      "invalid_name",
      `A name has to be 1 to ${MAX_NAME_LENGTH} visible characters.`,
    );
  }

  const player = await currentPlayer(context);
  if (player === null) return problem(401, "no_identity", PLAY_FIRST);
  if (player.gamesPlayed < 1) return problem(403, "no_games_played", PLAY_FIRST);

  const landed = await setPlayerName(context.repo, player.id, named.name, context.deps.now());
  return jsonResponse(200, { name: landed });
};
