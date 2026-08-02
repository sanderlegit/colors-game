/**
 * A `GameApi` that never touches the network.
 *
 * Every method resolves to a literal, immediately. That is the whole point: a
 * test double built on a fake `fetch` still exercises the decoders, the status
 * mapping and the timeout — which is `api.test.ts`'s job, not the job of a UI
 * test that only needs a leaderboard to render. Wiring tests get their answer
 * with no promise scheduling to reason about beyond a single microtask.
 *
 * `calls` is the other half. The interesting assertion about a UI that talks to
 * a server is usually *what it sent and when* — that `submit` fired once, not
 * twice on a double tap — and that is invisible unless the double records it.
 *
 * Overriding a single response is deliberate: pass only the failure you are
 * testing and every other method keeps returning something plausible, so a test
 * about an offline `submit` does not have to invent an identity as well.
 */

import { oklch } from "@/color/types";
import type {
  Attempt,
  GameApi,
  Identity,
  LeaderboardEntry,
  RankedGame,
  Result,
  Submission,
  SubmitRequest,
} from "@/platform/api";

export type ApiCall =
  | { readonly method: "me" }
  | { readonly method: "startRanked"; readonly memorizeMs: number; readonly challengeOf?: string }
  | { readonly method: "submit"; readonly request: SubmitRequest }
  | { readonly method: "claimName"; readonly name: string }
  | { readonly method: "leaderboard"; readonly forGame?: string }
  | { readonly method: "attempt"; readonly gameId: string };

export type CannedApi = {
  readonly me?: Result<Identity | null>;
  readonly startRanked?: Result<RankedGame>;
  readonly submit?: Result<Submission>;
  readonly claimName?: Result<{ readonly name: string }>;
  readonly leaderboard?: Result<{ readonly entries: readonly LeaderboardEntry[] }>;
  readonly attempt?: Result<Attempt>;
};

export type FakeApi = GameApi & {
  /** Live view of what has been called, in order. */
  readonly calls: readonly ApiCall[];
};

const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const FIXTURE_IDENTITY: Identity = {
  name: "ada",
  bestScore: 412,
  gamesPlayed: 9,
  rank: 3,
};

export const FIXTURE_RANKED_GAME: RankedGame = {
  gameId: "g_01H8XK",
  seed: 20260801,
  roundsTotal: 5,
};

export const FIXTURE_SUBMISSION: Submission = {
  totalScore: 412,
  rounds: [
    { deltaE: 1.2, score: 96 },
    { deltaE: 4.8, score: 81 },
    { deltaE: 11.3, score: 55 },
    { deltaE: 2.6, score: 90 },
    { deltaE: 7.4, score: 90 },
  ],
  rank: 3,
  isPersonalBest: true,
  name: "ada",
  claimed: true,
};

export const FIXTURE_LEADERBOARD: readonly LeaderboardEntry[] = [
  { rank: 1, name: "grace", score: 468, isYou: false, gameId: "g_grace" },
  { rank: 2, name: "alan", score: 431, isYou: false, gameId: "g_alan" },
  { rank: 3, name: "ada", score: 412, isYou: true, gameId: "g_ada" },
];

export const FIXTURE_ATTEMPT: Attempt = {
  totalScore: 412,
  rounds: [
    { deltaE: 1.2, score: 96, target: oklch(0.6, 0.12, 30), guess: oklch(0.61, 0.11, 33) },
    { deltaE: 4.8, score: 81, target: oklch(0.5, 0.1, 210), guess: oklch(0.52, 0.09, 205) },
    { deltaE: 11.3, score: 55, target: oklch(0.7, 0.14, 90), guess: oklch(0.66, 0.1, 110) },
    { deltaE: 2.6, score: 90, target: oklch(0.45, 0.08, 300), guess: oklch(0.46, 0.08, 297) },
    { deltaE: 7.4, score: 90, target: oklch(0.55, 0.16, 150), guess: oklch(0.57, 0.13, 158) },
  ],
};

export function createFakeApi(canned: CannedApi = {}): FakeApi {
  const calls: ApiCall[] = [];

  function record<T>(call: ApiCall, response: Result<T>): Promise<Result<T>> {
    calls.push(call);
    return Promise.resolve(response);
  }

  return {
    calls,
    me: () => record({ method: "me" }, canned.me ?? ok(FIXTURE_IDENTITY)),
    startRanked: (memorizeMs: number, challengeOf?: string) =>
      record(
        challengeOf === undefined
          ? { method: "startRanked", memorizeMs }
          : { method: "startRanked", memorizeMs, challengeOf },
        canned.startRanked ?? ok(FIXTURE_RANKED_GAME),
      ),
    submit: (request: SubmitRequest) =>
      record({ method: "submit", request }, canned.submit ?? ok(FIXTURE_SUBMISSION)),
    claimName: (name: string) =>
      record({ method: "claimName", name }, canned.claimName ?? ok({ name })),
    leaderboard: (forGame?: string) =>
      record(
        forGame === undefined ? { method: "leaderboard" } : { method: "leaderboard", forGame },
        canned.leaderboard ?? ok({ entries: FIXTURE_LEADERBOARD }),
      ),
    attempt: (gameId: string) =>
      record({ method: "attempt", gameId }, canned.attempt ?? ok(FIXTURE_ATTEMPT)),
  };
}
