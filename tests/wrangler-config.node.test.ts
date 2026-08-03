import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Three properties of `wrangler.toml` that fail *silently in production* and
 * nowhere else, in the same spirit as `tests/csp.node.test.ts`: a comment saying
 * "must stay true" is not a guard.
 *
 * Parsed with regexes rather than a TOML library because adding a dependency to
 * read four lines is exactly what CLAUDE.md forbids, and because both properties
 * are about the literal text of the file.
 */
const CONFIG = (): string => readFileSync("wrangler.toml", "utf8");

describe("Workers Logs is switched on", () => {
  /**
   * Observability is opt-in per Worker. Without it, every structured record
   * `server/log.ts` builds — the whole of ADR 0014, and the four telemetry
   * questions in `docs/OPERATIONS.md` § 1 — is discarded at the edge, and no
   * test, no deploy and no health check notices. It is the largest gap between
   * "the code is right" and "the operator can see anything" in this repo.
   */
  it("declares [observability] enabled", () => {
    expect(CONFIG()).toMatch(/\[observability\][^[]*\benabled\s*=\s*true/);
  });

  it("samples every event", () => {
    // Anything below 1 drops request records at random, which turns "no log line
    // for that request" from a signal into noise. The free plan's budget fits
    // full sampling — see `docs/OPERATIONS.md` § 1.
    expect(CONFIG()).toMatch(/\[observability\][^[]*\bhead_sampling_rate\s*=\s*1\b/);
  });
});

describe("the retention sweep has a trigger", () => {
  /**
   * `server/index.ts` exports `scheduled`, and without a `[triggers]` block
   * nothing ever calls it. There is no error and no warning: the Worker deploys,
   * every request is served correctly, and the sweep simply never runs — which
   * is indistinguishable in the logs from a sweep that had nothing to do, since
   * both produce no `retention_swept` line. ADR 0022 moved this project off
   * Pages for this one feature; ADR 0023 is the sweep.
   */
  it("declares a cron schedule", () => {
    expect(CONFIG()).toMatch(/\[triggers\][^[]*\bcrons\s*=\s*\[\s*"[^"]+"/);
  });
});

describe("the canonical host never reaches a development surface", () => {
  /**
   * ADR 0021, and the reason it is not in an `[env.production]` block: a value
   * anywhere in this file also applies to `wrangler dev`, which would answer
   * `localhost`, the e2e proxy on `127.0.0.1:5174` and every tailnet address
   * with a 308 into production. It is set with `wrangler secret put` on the
   * deployed Worker and nowhere else.
   */
  it("never sets CANONICAL_HOST in wrangler.toml", () => {
    const code = CONFIG().replace(/#[^\n]*/g, "");
    expect(code).not.toContain("CANONICAL_HOST");
  });

  /**
   * `LOG_PEPPER` (ADR 0030) is a `wrangler secret` for the same reason: a value
   * in the config file would apply to `wrangler dev` too, and a shared pepper
   * across dev and prod is exactly the leak the secret exists to avoid.
   */
  it("never sets LOG_PEPPER in wrangler.toml", () => {
    const code = CONFIG().replace(/#[^\n]*/g, "");
    expect(code).not.toContain("LOG_PEPPER");
  });
});
