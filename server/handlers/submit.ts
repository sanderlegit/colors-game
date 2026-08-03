/**
 * `POST /api/games/:gameId/result` → 200
 * `{ totalScore, rounds[], rank, isPersonalBest, name, claimed }`.
 *
 * This is the whole point of the backend, and the order matters:
 *
 * 1. Load the game. Anything not `active` goes down the resubmit path below.
 * 2. Check that the elapsed time could have been a game, on our clock, against
 *    the `memorize_ms` on the row. **Never the one in the body** — the client
 *    chose the window when it started, and a body that could restate it would
 *    let a caller claim 3000 for a game issued at 8000.
 * 3. Mint the identity if the cookie names nobody. This is the first moment
 *    there is something worth remembering, and the only place it happens.
 * 4. **Replay.** `replayGame` calls the same `generateTarget` and `scoreGuess`
 *    the client ran, from the row's own `seed` and `difficulty`. The client's
 *    own numbers are never read; only its guesses are.
 * 5. `Repo.finishGame` — the conditional update whose `false` means "already
 *    submitted". Nothing is written before it.
 * 6. `Repo.recordFinishedGame`, the optional name claim, then the rank.
 *
 * ## The resubmit path
 *
 * A dropped response is indistinguishable from a lost request, so a client that
 * retries must not be punished for it. If the game is already finished and it
 * belongs to the caller, the stored result is replayed from `seed` and
 * `guesses_json` and answered 200 — the same body, and `games_played` is not
 * counted twice, because `finishGame` already refused. If it belongs to somebody
 * else, that is a stolen id: 409.
 *
 * ## What is not said
 *
 * A flagged game (`replay.ts`) gets the ordinary response. It is excluded from
 * `players.best_score` and therefore from the board, and the player is not told,
 * because telling a cheat which heuristic caught them is handing them the test
 * suite for their next attempt.
 */

import { ROUNDS_PER_GAME } from "../../src/domain/state";
import type { Handler, RequestContext } from "../context";
import type { Game, Player } from "../db/repo";
import { decodeSubmit, nameKey, readJsonBody, type SubmitBody } from "../decode";
import { jsonResponse, problem } from "../http/json";
import { currentPlayer, mintPlayer, rankForGame } from "../identity";
import { GAME_TTL_MS, minimumElapsedMs } from "../limits";
import { setPlayerName } from "../names";
import { placeholderName } from "../placeholder";
import { replayGame } from "../replay";
import { storedGuesses } from "../stored";
import { submissionCounters } from "../telemetry";

const TOO_FAST = "That game came back faster than it can be played.";
const EXPIRED = "That game is too old to submit. Start a new one.";
const NOT_YOURS = "That game has already been submitted.";
const BUSY = "Too many new players from your network today. Try again tomorrow.";

/** `exactOptionalPropertyTypes`: an absent header is an absent key, not undefined. */
function headers(cookie: string | undefined): Readonly<Record<string, string>> {
  return cookie === undefined ? {} : { "set-cookie": cookie };
}

/**
 * Answer a game that is already finished.
 *
 * The rank is recomputed rather than stored, so a retry a minute later reports
 * where the player stands now — every other field comes from the row and is
 * therefore identical. `claimed` reads the outcome rather than repeating the
 * attempt: re-claiming would bump `name_changes` for a request that changed
 * nothing.
 */
async function replayStored(
  context: RequestContext,
  game: Game,
  submitted: SubmitBody,
  player: Player | null,
  cookie: string | undefined,
): Promise<Response> {
  if (game.status !== "finished" || player === null || game.playerId !== player.id) {
    return problem(409, "already_submitted", NOT_YOURS, headers(cookie));
  }

  const scored = replayGame(game.seed, game.difficulty, storedGuesses(game));
  // Every game is its own board row (ADR 0033), so a resubmit reports this
  // game's own position — its stored score, the name it was played under, its id.
  const rank = await rankForGame(context, game.nameKey ?? "", {
    bestScore: game.totalScore,
    name: game.name ?? "",
    gameId: game.id,
  });

  return jsonResponse(
    200,
    {
      // The row's own total, not the replay's: it is what the board orders on,
      // and it stays right even if the scoring curve is retuned underneath it.
      totalScore: game.totalScore,
      rounds: scored.rounds,
      rank,
      isPersonalBest: player.bestGameId === game.id,
      name: player.name,
      claimed: submitted.name !== undefined && player.name !== null,
    },
    headers(cookie),
  );
}

export const submitResult: Handler = async (
  context: RequestContext,
  params: Readonly<Record<string, string>>,
): Promise<Response> => {
  const body = await readJsonBody(context.request);
  if (body === null) return problem(400, "bad_request", "That request could not be read.");

  const submitted = decodeSubmit(body);
  if (submitted === null) {
    return problem(422, "invalid_guesses", `A game is ${ROUNDS_PER_GAME} guesses, all in range.`);
  }

  const game = await context.repo.findGame(params.gameId ?? "");
  if (game === null) return problem(404, "no_such_game", "No such game.");

  const existing = await currentPlayer(context);
  if (game.status !== "active") {
    return replayStored(context, game, submitted, existing, undefined);
  }

  const now = context.deps.now();
  const age = now - game.startedAt;
  if (age > GAME_TTL_MS) return problem(410, "game_expired", EXPIRED);
  if (age < minimumElapsedMs(game.memorizeMs, ROUNDS_PER_GAME)) {
    return problem(422, "too_fast", TOO_FAST);
  }

  let cookie: string | undefined;
  let player = existing;
  if (player === null) {
    const minted = await mintPlayer(context, now);
    if (!minted.ok) {
      return problem(429, "rate_limited", BUSY, {
        "retry-after": String(minted.retryAfterSeconds),
      });
    }
    player = minted.player;
    cookie = minted.cookie;
  }

  const scored = replayGame(game.seed, game.difficulty, submitted.guesses);
  // The name the game is submitted under, snapshotted onto the row (ADR 0029,
  // 0032): the name in this submission if it carries one, else the identity's
  // current name, else a stable placeholder handle so a player who finishes
  // without naming still lands on the board. A later `setName` claims it back.
  const submittedName = submitted.name;
  const gameName = submittedName ?? player.name ?? placeholderName(player.id);
  const gameNameKey = nameKey(gameName);
  const finished = await context.repo.finishGame({
    gameId: game.id,
    playerId: player.id,
    totalScore: scored.totalScore,
    guessesJson: JSON.stringify(submitted.guesses),
    flags: scored.flags,
    finishedAt: now,
    name: gameName,
    nameKey: gameNameKey,
  });
  if (!finished) {
    // Somebody finished it between the read and the write. Re-read and answer
    // from the row that won, which is either this player's retry or a 409.
    const current = await context.repo.findGame(game.id);
    if (current === null) return problem(404, "no_such_game", "No such game.");
    return replayStored(context, current, submitted, player, cookie);
  }

  // ADR 0014's counters, written from the one place that has every round's ΔE
  // and every target — and only on the path where `finishGame` actually changed
  // the row, so a retried submission cannot count a game twice. Deferred,
  // because nothing in this response reads them.
  context.ctx.waitUntil(
    context.repo.recordTelemetry(
      submissionCounters({
        at: now,
        difficulty: game.difficulty,
        memorizeMs: game.memorizeMs,
        deltaEs: scored.rounds.map((round) => round.deltaE),
        targetHues: scored.targetHues,
        flags: scored.flags,
      }),
    ),
  );

  const aggregate = await context.repo.recordFinishedGame({
    playerId: player.id,
    gameId: game.id,
    totalScore: scored.totalScore,
    // A challenge game is never ranked on the *global* board however clean it is:
    // its seed was chosen, and a chosen seed the player could pick for being easy
    // must not raise `best_score` (ADR 0026, upholding ADR 0015). It still counts
    // as played and still ranks on its own seed's board.
    ranked: scored.flags === 0 && game.kind === "open",
    at: now,
  });

  const landed =
    submitted.name === undefined
      ? null
      : await setPlayerName(context.repo, player.id, submitted.name, now);
  const name = landed ?? player.name;
  // Rank tracks the default best-per-name board (ADR 0033): the rank of the name
  // this game was submitted under. `gameName`/`gameNameKey` are what the game was
  // stamped with; the fallback covers a flagged or zero game whose name has no
  // board row of its own.
  const rank = await rankForGame(context, gameNameKey, {
    bestScore: scored.totalScore,
    name: gameName,
    gameId: game.id,
  });

  return jsonResponse(
    200,
    {
      totalScore: scored.totalScore,
      rounds: scored.rounds,
      rank,
      isPersonalBest: aggregate.isPersonalBest,
      name,
      claimed: landed !== null,
    },
    headers(cookie),
  );
};
