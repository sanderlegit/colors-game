/**
 * Who is asking, and when a new answer to that question is created.
 *
 * ## Reading is free; minting happens once, on the first submission
 *
 * `GET /api/me` runs on every page load, including from people who bounce and
 * from crawlers. Minting there would mean a `players` row and a cookie for every
 * one of them, and a cookie-banner conversation this game does not need to have.
 * So reading never writes: no cookie, no row, 204.
 *
 * The identity is created at the one moment there is something worth
 * remembering — a finished game — and that is the *only* place `mintPlayer` is
 * called from. If a second call site ever appears, the "a drive-by visitor gets
 * no cookie" property is gone and nothing will fail to say so.
 *
 * ## The token is never stored
 *
 * The cookie carries 32 random bytes; `players.token_hash` holds their SHA-256.
 * A database dump is therefore not a pile of live credentials, and the lookup is
 * still a single indexed read. The client cannot read the cookie either — it is
 * `HttpOnly` — which is why every identity-touching response echoes the
 * canonical `name` rather than expecting the client to know it.
 */

import type { RequestContext } from "./context";
import type { Player } from "./db/repo";
import { IDENTITY_COOKIE, readCookie, setCookie } from "./http/cookie";
import {
  dayNumber,
  IDENTITIES_PER_BUCKET_PER_DAY,
  mintBucket,
  secondsUntilNextDay,
} from "./limits";

/**
 * The player this request already belongs to, or `null`.
 *
 * Never mints, never writes, and answers `null` for a cookie naming a player who
 * has since been forgotten — which is indistinguishable from no cookie at all,
 * and deliberately so.
 */
export async function currentPlayer(context: RequestContext): Promise<Player | null> {
  const token = readCookie(context.request.headers.get("cookie"), IDENTITY_COOKIE);
  if (token === null) return null;
  const tokenHash = await context.deps.hashToken(token);
  return context.repo.findPlayerByTokenHash(tokenHash);
}

export type Minted =
  | { readonly ok: true; readonly player: Player; readonly cookie: string }
  | { readonly ok: false; readonly retryAfterSeconds: number };

/**
 * Create an identity and the cookie that carries it.
 *
 * Bounded by the day's mint bucket, because this is the step that turns traffic
 * into rows: an unbounded one is a way to fill the table and the board with a
 * script. The bucket is a hashed equivalence class of the caller's address and
 * the address itself is never stored — see `limits.ts`.
 */
export async function mintPlayer(context: RequestContext, at: number): Promise<Minted> {
  const bucket = await mintBucket("identity", context.request, context.deps, at);
  const minted = await context.repo.bumpMintBucket(bucket, dayNumber(at));
  if (minted > IDENTITIES_PER_BUCKET_PER_DAY) {
    return { ok: false, retryAfterSeconds: secondsUntilNextDay(at) };
  }

  const token = context.deps.newToken();
  const tokenHash = await context.deps.hashToken(token);
  const player = await context.repo.insertPlayer({ tokenHash, at });
  return { ok: true, player, cookie: setCookie(IDENTITY_COOKIE, token) };
}

/**
 * Where a player sits on the board, one-based.
 *
 * A player with no name is not on the board at all, so this answers where they
 * *would* sit — the client's contract has no null rank on a submission, and
 * "you would be 7th if you claimed a name" is the honest reading. The empty name
 * sorts first among equal scores, which flatters them by at most one place.
 */
export async function rankOf(
  context: RequestContext,
  bestScore: number,
  name: string | null,
): Promise<number> {
  const above = await context.repo.countPlayersAbove({ bestScore, name: name ?? "" });
  return above + 1;
}
