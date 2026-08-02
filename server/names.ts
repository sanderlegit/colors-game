/**
 * Landing a name on a board where somebody else may be landing the same one.
 *
 * ## The unique index is the arbiter, never a lookup
 *
 * The obvious shape — "is this name free? then take it" — is two statements with
 * a race between them, and the race is trivially winnable by anyone who wants
 * two accounts called `ada`. So there is no check: the claim is attempted, and
 * `Repo.claimName` reports contention as `{ ok: false, reason: "taken" }`
 * because the partial unique index on `name_key` refused it. Losing is an
 * ordinary outcome, and the answer to it is another attempt, not an error.
 *
 * ## Why suffixes rather than an error
 *
 * The player has just finished a game. Handing them "that name is taken, try
 * again" at that moment costs them the moment; handing them `ada-2` costs them
 * a suffix. The response echoes what actually landed — the client cannot know it
 * otherwise, and inventing the name locally is how the leaderboard ends up
 * disagreeing with the row it is drawn from.
 *
 * The ladder is bounded. An attacker who takes `ada`, `ada-2` … can otherwise
 * make every subsequent claim cost an unbounded number of writes, so after the
 * numbered variants there is exactly one random attempt and then a refusal.
 */

import type { Repo } from "./db/repo";
import { MAX_NAME_LENGTH, nameKey } from "./decode";
import { randomSuffix } from "./ids";

/** `name`, then `name-2` … `name-8`. */
const LAST_NUMBERED_SUFFIX = 8;

/**
 * Truncate by code points so `base` plus `suffix` still fits the display bound.
 *
 * Not cosmetic: `src/platform/api.ts` refuses a name longer than
 * `MAX_NAME_LENGTH`, so a 24-character name suffixed to 26 would make the whole
 * response unreadable to the client that asked for it — the submission would
 * look like a server fault.
 */
function trimToFit(base: string, suffix: string): string {
  const room = MAX_NAME_LENGTH - suffix.length;
  const points = [...base];
  const kept = points.length <= room ? base : points.slice(0, room).join("");
  return kept.trimEnd();
}

function candidates(name: string): readonly string[] {
  const numbered: string[] = [name];
  for (let n = 2; n <= LAST_NUMBERED_SUFFIX; n += 1) {
    const suffix = `-${n}`;
    numbered.push(`${trimToFit(name, suffix)}${suffix}`);
  }
  const random = `-${randomSuffix()}`;
  numbered.push(`${trimToFit(name, random)}${random}`);
  return numbered;
}

/**
 * Claim `name` for `playerId`, suffixing around collisions. Returns the name
 * that actually landed, or `null` if even the random variant was taken — which
 * takes a determined squatter and is the point at which they are told no.
 */
export async function claimAvailableName(
  repo: Repo,
  playerId: number,
  name: string,
  at: number,
): Promise<string | null> {
  for (const candidate of candidates(name)) {
    const key = nameKey(candidate);
    // A truncated base can fold to nothing (a name of nothing but combining
    // marks); the index would take it, but the board cannot show it.
    if (key === "") continue;
    const claim = await repo.claimName({ playerId, name: candidate, key, at });
    if (claim.ok) return candidate;
  }
  return null;
}
