import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectTsFiles, readCode } from "./source.node";

/**
 * `server/debug/**` ships — it is compiled into the same bundle as every other
 * route. The gate is what makes that harmless, so the gate is what gets a test.
 *
 * `DEBUG_REPLAY` is supplied by `wrangler dev --var DEBUG_REPLAY:1` in the
 * real-backend e2e run and nowhere else. The moment it appears in
 * `wrangler.toml` it becomes a deployed value, and a debug route that answers in
 * production is a debug route that ships. See `server/env.d.ts`.
 *
 * The directory sweep is the half that has actually caught something: a leftover
 * `__scratch-echo` probe that echoed request headers (history/0009). A test that
 * only checked the one route it knew about would have missed it.
 */
const FLAG = "DEBUG_REPLAY";

describe("the debug routes cannot ship enabled", () => {
  it("never sets the flag in wrangler.toml", () => {
    expect(readFileSync("wrangler.toml", "utf8")).not.toContain(FLAG);
  });

  it("gates every route under server/debug on the flag", () => {
    const files = collectTsFiles("server/debug").filter(
      (file) => !file.endsWith(".d.ts") && !file.endsWith(".test.ts"),
    );
    expect(files.length).toBeGreaterThan(0);

    const ungated = files.filter((file) => !readCode(file).includes(`env.${FLAG}`));
    expect(ungated).toEqual([]);
  });
});
