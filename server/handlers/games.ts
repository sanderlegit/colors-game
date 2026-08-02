/**
 * `POST /api/games` → 201 `{ gameId, seed, roundsTotal }`.
 *
 * Body `{ memorizeMs }`, validated by `decodeStartGame`. Mints a seed
 * (`deps.newSeed`) and a 43-character id (`deps.newToken`) and inserts an
 * `active` row. `roundsTotal` is `ROUNDS_PER_GAME`, sent rather than assumed so
 * a client built against a different round count fails visibly.
 *
 * **No cookie is required and none is minted** — see `me.ts`. A visitor who
 * starts a game and closes the tab leaves an orphan row and nothing else.
 *
 * ## The player id is attached here, when there is one
 *
 * The scaffold left `games.player_id` NULL until submission, which meant
 * `countGamesStartedSince` was blind at mint time and could not limit anything.
 * It is set here instead whenever the request already carries a valid cookie, so
 * a returning player's starts are countable the moment they happen. A first-time
 * visitor still gets NULL — requiring an identity to start would put the cookie
 * back on page load — and their ceiling is the day's mint bucket instead.
 *
 * Both limits answer 429 with `Retry-After`. The per-player one reports the full
 * window rather than the exact moment the oldest start falls out of it: the row
 * that would tell us is not one we store, and over-reporting a wait is the safe
 * direction.
 *
 * The submission half of this resource lives in `submit.ts`.
 */

import { ROUNDS_PER_GAME } from "../../src/domain/state";
import type { Handler, RequestContext } from "../context";
import type { Player } from "../db/repo";
import { decodeStartGame, readJsonBody } from "../decode";
import { jsonResponse, problem } from "../http/json";
import { currentPlayer } from "../identity";
import {
  ANON_GAMES_PER_BUCKET_PER_DAY,
  dayNumber,
  GAMES_PER_PLAYER_PER_HOUR,
  mintBucket,
  PLAYER_WINDOW_MS,
  secondsUntilNextDay,
} from "../limits";
import { gameCounter } from "../telemetry";

const SLOW_DOWN = "You have started a lot of games. Give it a few minutes.";
const TOO_MANY_HERE = "Too many games have been started from your network today.";

function rateLimited(retryAfterSeconds: number, message: string): Response {
  return problem(429, "rate_limited", message, { "retry-after": String(retryAfterSeconds) });
}

/**
 * The start limit, whichever of the two applies. `null` means "carry on".
 *
 * An identified player is counted by their own started games; an anonymous one
 * is counted against the day's bucket, which is the only handle we have on
 * somebody who has accepted nothing.
 */
async function refuseStart(
  context: RequestContext,
  player: Player | null,
  now: number,
): Promise<Response | null> {
  if (player !== null) {
    const started = await context.repo.countGamesStartedSince(player.id, now - PLAYER_WINDOW_MS);
    if (started < GAMES_PER_PLAYER_PER_HOUR) return null;
    return rateLimited(Math.round(PLAYER_WINDOW_MS / 1000), SLOW_DOWN);
  }

  const bucket = await mintBucket("game", context.request, context.deps, now);
  const started = await context.repo.bumpMintBucket(bucket, dayNumber(now));
  if (started <= ANON_GAMES_PER_BUCKET_PER_DAY) return null;
  return rateLimited(secondsUntilNextDay(now), TOO_MANY_HERE);
}

export const startGame: Handler = async (context: RequestContext): Promise<Response> => {
  const body = await readJsonBody(context.request);
  if (body === null) return problem(400, "bad_request", "That request could not be read.");

  const start = decodeStartGame(body);
  if (start === null) {
    return problem(422, "invalid_settings", "That is not one of the memorize times on offer.");
  }

  const now = context.deps.now();
  const player = await currentPlayer(context);
  const refusal = await refuseStart(context, player, now);
  if (refusal !== null) return refusal;

  // A challenge plays a seed chosen from an existing finished game (ADR 0025).
  // The seed and difficulty come off that row, never the request, so the caller
  // still cannot name the numbers it plays; it can only point at a game that was
  // already minted for someone. `memorizeMs` stays the player's own choice — it
  // is how long they study, not what they study.
  let seed = context.deps.newSeed();
  let difficulty = start.difficulty;
  let kind: "open" | "challenge" = "open";
  if (start.challengeOf !== undefined) {
    const origin = await context.repo.findGame(start.challengeOf);
    if (origin === null || origin.status !== "finished") {
      return problem(404, "no_such_game", "That challenge is no longer available.");
    }
    seed = origin.seed;
    difficulty = origin.difficulty;
    kind = "challenge";
  }

  const gameId = context.deps.newToken();
  await context.repo.insertGame({
    id: gameId,
    playerId: player === null ? null : player.id,
    seed,
    difficulty,
    memorizeMs: start.memorizeMs,
    kind,
    startedAt: now,
  });

  // The denominator of the completion rate. It counts games *minted*, which is
  // not the same as games played — `src/main.ts` issues one ahead of the click
  // — so `docs/OPERATIONS.md` reads the ratio as a lower bound. Deferred:
  // nothing in this response reads it.
  context.ctx.waitUntil(
    context.repo.recordTelemetry({
      rounds: [],
      games: [gameCounter({ difficulty, memorizeMs: start.memorizeMs }, now, "started")],
    }),
  );

  return jsonResponse(201, { gameId, seed, roundsTotal: ROUNDS_PER_GAME });
};
