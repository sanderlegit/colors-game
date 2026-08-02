/**
 * The data-retention sweep, run by the Cron Trigger in `wrangler.toml`.
 *
 * ADR 0022 moved this project off Pages specifically so a scheduled handler was
 * available — Pages Functions have no cron triggers and Cloudflare documents no
 * plan to add them. This is the follow-up commit that ADR named.
 *
 * ## Why a schedule and not a pass on write
 *
 * The alternative that was proposed during scaffolding, and never written, was a
 * probabilistic purge on submission: a small chance per request of also deleting
 * expired rows. It fails in the one case that matters — it does no work when
 * nobody is playing, which is exactly when rows sit around unread — and it puts
 * the cost on a player's request.
 *
 * ## Four passes, each bounded, none able to abort the others
 *
 * Every pass is wrapped: a thrown pass is recorded and the next one still runs,
 * and nothing escapes the handler. A `scheduled` that throws is a retry the
 * platform decides about, and one broken statement must not take the other three
 * with it.
 *
 * Every pass is also bounded by `SWEEP_BATCH_LIMIT` and reports its row count.
 * These tables have been growing unattended since the schema was written, and an
 * unbounded `DELETE` on the first run after a long backlog is how a scheduled
 * job takes out a database. A pass that hits its ceiling says so in the log and
 * the next run continues — see `docs/OPERATIONS.md` § 6.
 *
 * ## What is deliberately not swept
 *
 * ADR 0011 asks for two things. `games_played = 0` after 7 days is here. The
 * **release of names idle over 12 months is not**, and that is a decision rather
 * than an omission — ADR 0023 has it in full. The short version: `last_seen_at`
 * is advanced by `touchPlayer`, which runs inside `waitUntil` on `GET /api/me`
 * and has never been proven to write against a real D1 (`docs/BACKLOG.md` § 4.2
 * — a SQL error there is swallowed by the runtime and every test stays green).
 * If it silently fails, every `last_seen_at` is frozen at `created_at` and a
 * 12-month release would release every name in the database in one run. Deleting
 * a real player's name is not recoverable, and nothing can be 12 months idle
 * before 2027-08-01, so there is nothing to buy by guessing now.
 */

import { type AppDeps, productionDeps } from "./context";
import type { Repo } from "./db/repo";
import {
  CLIENT_ERROR_RETENTION_DAYS,
  DAY_MS,
  dayNumber,
  GAME_TTL_MS,
  ORPHAN_PLAYER_MAX_AGE_MS,
} from "./limits";
import { sweepRecord } from "./log";
import { dayKey } from "./telemetry";

/**
 * Rows one pass may remove in one run.
 *
 * Sized for the shape of the problem rather than for a throughput target: this
 * is a hobby-scale game, so a day's accumulation is tens of rows in every table,
 * and 500 is two orders of magnitude of headroom. It is small enough that the
 * worst case — four passes, all capped — is 2,000 row writes against D1's free
 * daily allowance, and it is the number that makes the *first* run after a
 * backlog survivable rather than the one that clears it fastest.
 */
export const SWEEP_BATCH_LIMIT = 500;

/**
 * One pass. `field` is both the log field's suffix and the pass's name in
 * `sweep.failed`, so there is one spelling of each pass in the whole system.
 */
type Pass = {
  readonly field: string;
  readonly run: (repo: Repo, now: number) => Promise<number>;
};

const PASSES: readonly Pass[] = [
  {
    // The `expired` status has been unreachable since the schema was written:
    // `games_sweep` indexes stale active games and nothing has ever read it, so
    // a game past its TTL stays `active` forever. The submit path refuses it
    // from `started_at` either way — this is about the row, not the rule.
    field: "games_expired",
    run: (repo, now) =>
      repo.expireStaleGames({ startedBefore: now - GAME_TTL_MS, limit: SWEEP_BATCH_LIMIT }),
  },
  {
    // The privacy pass. `mint_buckets` rows are SHA-256(kind ‖ IP ‖ salt-of-the-
    // day) and they are the *only* per-IP-derived rows in the system; ADR 0015
    // justifies holding them at all partly on their being short-lived. The salt
    // rotates daily and `bumpMintBucket` only ever touches today's day, so a row
    // for a past day cannot be read again by anything — it is retained data with
    // no remaining purpose, which is the definition of what should not be there.
    field: "mint_buckets_deleted",
    run: (repo, now) =>
      repo.deleteMintBucketsBefore({ beforeDay: dayNumber(now), limit: SWEEP_BATCH_LIMIT }),
  },
  {
    // `Repo.recordClientError` already purges older days on every write, and
    // that is genuinely enforced — but only while reports are arriving. Once the
    // last browser stops throwing, the last 30 days of rows stay forever. The
    // healthy state is the one the write-side purge cannot cover.
    field: "client_errors_deleted",
    run: (repo, now) =>
      repo.deleteClientErrorsBefore({
        beforeDay: dayKey(now - CLIENT_ERROR_RETENTION_DAYS * DAY_MS),
        limit: SWEEP_BATCH_LIMIT,
      }),
  },
  {
    // ADR 0011. Narrow on purpose: `games_played = 0` only, which is a row whose
    // request died between `insertPlayer` and `recordFinishedGame`. Such a player
    // holds no name (`handlers/name.ts` refuses under one game played) and no
    // board position, so nothing is lost; their next submission mints a fresh
    // identity, which is what a cleared cookie already does.
    field: "orphan_players_deleted",
    run: (repo, now) =>
      repo.deleteOrphanedPlayers({
        createdBefore: now - ORPHAN_PLAYER_MAX_AGE_MS,
        limit: SWEEP_BATCH_LIMIT,
      }),
  },
];

export type SweepOutcome = {
  /** Rows removed per pass, keyed by `Pass.field`. A failed pass reports 0. */
  readonly counts: Readonly<Record<string, number>>;
  readonly failed: readonly string[];
  readonly capped: readonly string[];
  /** The first failure's message, or `null`. */
  readonly error: string | null;
};

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

/**
 * Run every pass. Never throws.
 *
 * Exported without the logging or the Worker around it so a test can assert on
 * what was removed rather than on a parsed log line.
 */
export async function sweep(repo: Repo, now: number): Promise<SweepOutcome> {
  const counts: Record<string, number> = {};
  const failed: string[] = [];
  const capped: string[] = [];
  let error: string | null = null;

  for (const pass of PASSES) {
    try {
      const removed = await pass.run(repo, now);
      counts[pass.field] = removed;
      if (removed >= SWEEP_BATCH_LIMIT) capped.push(pass.field);
    } catch (thrown) {
      // Zero rather than absent: "this pass removed nothing" and "this pass is
      // not in the log" are different facts, and only one of them is a fault.
      counts[pass.field] = 0;
      failed.push(pass.field);
      error ??= messageOf(thrown);
    }
  }

  return { counts, failed, capped, error };
}

export type Sweeper = (controller: ScheduledController, env: Env) => Promise<void>;

/**
 * Every pass reported as failed, for the case where no pass could be attempted.
 *
 * Built with a loop rather than `Object.fromEntries` because
 * `tests/logging.node.test.ts` bans that call anywhere in `server/**` — the only
 * reason to reach for it in a backend is to turn a `Headers` object into data.
 */
function allFailed(error: string): SweepOutcome {
  const counts: Record<string, number> = {};
  for (const pass of PASSES) counts[pass.field] = 0;
  return { counts, failed: PASSES.map((pass) => pass.field), capped: [], error };
}

/**
 * The scheduled handler, minus Cloudflare.
 *
 * Takes its dependencies for the same reason `createApp` does: a test hands it
 * `memoryRepo()`, a frozen clock and a capturing `emit` and drives the whole
 * thing, with no Worker and no D1.
 *
 * The clock is `deps.now()` rather than `controller.scheduledTime`. They differ
 * when the platform runs a trigger late, and every cutoff here is "older than N
 * from the moment we are actually looking" — a sweep that ran an hour late and
 * used the scheduled instant would leave an hour of rows behind on every run.
 */
export function createSweep(deps: AppDeps = productionDeps): Sweeper {
  return async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const startedAt = deps.now();
    let outcome: SweepOutcome;
    try {
      // `deps.repo(env)` is inside the boundary: a D1 binding that was never
      // configured throws here, before any pass has run, and that has to be a
      // log line rather than an unhandled rejection.
      outcome = await sweep(deps.repo(env), startedAt);
    } catch (thrown) {
      outcome = allFailed(messageOf(thrown));
    }

    try {
      deps.emit(
        JSON.stringify(
          sweepRecord({
            at: deps.now(),
            cron: controller.cron,
            durationMs: deps.now() - startedAt,
            ...outcome,
          }),
        ),
      );
    } catch {
      // Same trade as `app.ts`: losing the log line is acceptable, throwing out
      // of the handler is not. There is no response here to protect, but a throw
      // is a platform retry of work that has already been done.
    }
  };
}
