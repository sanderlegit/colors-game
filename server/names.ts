/**
 * Setting a player's display name.
 *
 * Names are not unique (ADR 0024): two players wanting to be `ada` both get to
 * be `ada`. So there is no collision to resolve and no suffix ladder — setting a
 * name is a plain write. The board stays coherent because its order carries a
 * final `id` tiebreak (`Repo.countPlayersAbove`), not because the names differ.
 *
 * This is the one place a display name is turned into the folded `key` the row
 * is marked named by, so both the `POST /api/name` handler and the name-with-
 * submission path fold identically. The name reaching here has already been
 * through `decodeName`, so its key is non-empty and within bounds.
 */

import type { Repo } from "./db/repo";
import { nameKey } from "./decode";

/** Set `name` for `playerId` and echo it back — what actually landed on the row. */
export async function setPlayerName(
  repo: Repo,
  playerId: number,
  name: string,
  at: number,
): Promise<string> {
  await repo.setName({ playerId, name, key: nameKey(name), at });
  return name;
}
