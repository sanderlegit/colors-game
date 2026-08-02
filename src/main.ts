/**
 * Composition root — the one place where the pure core meets the browser.
 *
 * Everything above this file is either pure (`src/color`, `src/domain`) or a
 * component that receives what it needs. Here is where the real clock, the real
 * storage, the real seed source and the real API get chosen, and nowhere else.
 * That is what keeps the rest of the codebase testable without a browser.
 *
 * It is also the only file in `src/**` outside `src/platform/**` that may
 * `await` (ADR 0012). The UI is handed setters and handlers; it never sees a
 * promise, which is why every component test is a synchronous call with a
 * literal argument.
 *
 * Two rules the network work here obeys:
 *
 * - **Boot awaits nothing.** `api.me()` and the first ranked game are fired and
 *   their promises dropped. Identity starts `unknown` and renders nothing.
 * - **The game is fully playable with the API down.** A failed `startRanked`
 *   costs the player their place on the board for that game and nothing else —
 *   the round still plays, the personal best is still recorded, and the summary
 *   says why rather than showing a submit button that can only fail.
 */

import { oklchToSrgb } from "@/color/convert";
import { toHex } from "@/color/format";
import { clipChromaToGamut } from "@/color/gamut";
import type { Oklch } from "@/color/types";
import { generateTarget } from "@/domain/round";
import { scoreGuess } from "@/domain/scoring";
import { totalScore } from "@/domain/selectors";
import type { Event, GameState } from "@/domain/state";
import { createReducer, initialState, ROUNDS_PER_GAME } from "@/domain/state";
import type { RankedGame, Submission } from "@/platform/api";
import { createApi } from "@/platform/api";
import { createClock } from "@/platform/clock";
import { installErrorReporter } from "@/platform/errors";
import { createSeed } from "@/platform/seed";
import { browserStore, createMemoryStore, createStorage } from "@/platform/storage";
import { createPicker } from "@/ui/picker";
import { createShell } from "@/ui/shell";

/** SPEC §7 as amended by ADR 0016: an unranked game is a whole game, minus the board. */
const UNRANKED = "Played offline, so this one is not eligible for the board.";
const FORGOTTEN = "Forgotten. Your name and your scores are off the board.";

/**
 * The readout's hex value.
 *
 * Since ADR 0007 the picker's whole plane is in gamut, so the clip is a no-op for
 * anything the player can actually select. It stays because this takes an
 * arbitrary `Oklch` and the alternative failure mode is silent: clamping RGB
 * channels instead of reducing chroma shifts the hue by as much as 69°.
 */
function formatHex(color: Oklch): string {
  return toHex(oklchToSrgb(clipChromaToGamut(color)));
}

function main(): void {
  // First, and before anything that can throw: the whole game runs on one rAF
  // loop, and a throw inside it leaves a page that renders nothing and says
  // nothing. This is the only channel that would carry it.
  installErrorReporter();

  const root = document.querySelector<HTMLElement>("#app");
  if (root === null) throw new Error("#app is missing from index.html");

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const storage = createStorage(browserStore() ?? createMemoryStore());
  const api = createApi();

  const reduce = createReducer({ score: scoreGuess, target: generateTarget });

  let state: GameState = initialState(storage.readSettings());
  let stats = storage.readStats();

  /** Issued ahead of the click, because `nextSeed` is synchronous by contract. */
  let prepared: RankedGame | null = null;
  /** The row the game on screen belongs to, or null when it is being played unranked. */
  let playing: RankedGame | null = null;
  let submitted: Submission | null = null;
  let boardPending = false;

  function nextSeed(): number {
    playing = prepared;
    prepared = null;
    return playing?.seed ?? createSeed();
  }

  const shell = createShell(root, {
    game: {
      dispatch: (event: Event) => dispatch(event),
      createPicker,
      nextSeed,
      reducedMotion,
      formatHex,
      bestScore: stats.bestScore,
    },
    leaderboard: { onRetry: () => void loadBoard() },
    identity: {
      onClaim: (name: string) => void claimName(name),
      onForget: () => void forget(),
    },
    onTabSelect: (tab) => {
      if (tab === "leaderboard") void loadBoard();
    },
  });

  async function loadIdentity(): Promise<void> {
    const res = await api.me();
    // A failure leaves identity `unknown`, which renders nothing at all. There is
    // no honest thing to say about a question the server did not answer.
    if (!res.ok) return;
    if (res.value === null) shell.setIdentity({ status: "unknown" });
    else if (res.value.name === null) shell.setIdentity({ status: "anonymous" });
    else shell.setIdentity({ status: "named", name: res.value.name });
  }

  /**
   * Mint the next ranked game *before* it is needed. The Play button dispatches
   * `START` synchronously with whatever `nextSeed()` returns, so a request fired
   * at the click would land after the round it was for.
   *
   * A `roundsTotal` we do not play is dropped rather than adapted: the server
   * replays the seed for the count in its own row, so a mismatch would score a
   * game the player never played.
   */
  async function prepareRanked(memorizeMs: number): Promise<void> {
    const res = await api.startRanked(memorizeMs);
    prepared = res.ok && res.value.roundsTotal === ROUNDS_PER_GAME ? res.value : null;
  }

  async function submitGame(finished: GameState): Promise<void> {
    const game = playing;
    playing = null;
    if (game === null) {
      shell.setSubmission({ status: "unavailable", message: UNRANKED });
      return;
    }

    shell.setSubmission({ status: "sending" });
    const res = await api.submit({
      gameId: game.gameId,
      guesses: finished.results.map((round) => round.guess),
    });

    if (!res.ok) {
      shell.setSubmission({ status: "failed", message: res.error.message });
    } else {
      submitted = res.value;
      // Submitting is what mints the identity (ADR 0011), so this is the first
      // moment the claim form is honest.
      shell.setIdentity(
        res.value.name === null
          ? { status: "anonymous" }
          : { status: "named", name: res.value.name },
      );
      shell.setSubmission({
        status: "done",
        name: res.value.name,
        rank: res.value.rank,
      });
    }

    // The next game needs its own row, and a fresh one restarts the server's
    // 30-minute submission window.
    void prepareRanked(finished.settings.memorizeMs);
  }

  async function claimName(name: string): Promise<void> {
    shell.setSubmission({ status: "sending" });
    const res = await api.claimName(name);
    if (!res.ok) {
      // The identity is still anonymous, so the form comes back and the server's
      // verdict is rendered above it, verbatim.
      shell.setSubmission({ status: "failed", message: res.error.message });
      return;
    }
    shell.setIdentity({ status: "named", name: res.value.name });
    shell.setSubmission({
      status: "done",
      name: res.value.name,
      rank: submitted?.rank ?? 0,
    });
  }

  async function forget(): Promise<void> {
    const res = await api.forget();
    if (!res.ok) {
      shell.setSubmission({ status: "failed", message: res.error.message });
      return;
    }
    // The delete cascades, so the game this summary describes is gone with it —
    // there is nothing left to submit or claim against.
    submitted = null;
    playing = null;
    shell.setIdentity({ status: "unknown" });
    shell.setSubmission({ status: "unavailable", message: FORGOTTEN });
  }

  async function loadBoard(): Promise<void> {
    if (boardPending) return;
    boardPending = true;
    shell.setLeaderboard({ status: "loading" });
    const res = await api.leaderboard();
    boardPending = false;
    shell.setLeaderboard(
      res.ok
        ? { status: "ready", entries: res.value.entries }
        : { status: "error", message: res.error.message },
    );
  }

  function dispatch(event: Event): void {
    const next = reduce(state, event);
    // The reducer returns the same reference for a no-op, which skips both the
    // render and the persistence check on the majority of frames.
    if (next === state) return;

    const justFinished = next.phase === "summary" && state.phase !== "summary";
    state = next;
    shell.update(state);

    if (!justFinished) return;

    const total = Math.round(totalScore(state));
    stats = {
      bestScore: Math.max(stats.bestScore, total),
      gamesPlayed: stats.gamesPlayed + 1,
    };
    shell.setBestScore(stats.bestScore);
    storage.writeStats(stats);
    void submitGame(state);
  }

  shell.update(state);
  void loadIdentity();
  void prepareRanked(state.settings.memorizeMs);
  createClock((ms) => dispatch({ type: "TICK", at: ms })).start();
}

main();
