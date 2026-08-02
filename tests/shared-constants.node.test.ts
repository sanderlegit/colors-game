import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `MAX_NAME_LENGTH` is written down twice, and it has to be: the client's copy is
 * in `src/platform/api.ts`, which compiles against DOM libs, and the server's is
 * in `server/decode.ts`, which compiles under `tsconfig.server.json` with no DOM
 * at all. Neither can import the other — the purity guard forbids `server/**`
 * from reaching into `src/platform/**`, and it is right to.
 *
 * So the constant gets the treatment the CSP and the scoring core already get: a
 * test, not a comment. `server/decode.ts` carried "Must equal `MAX_NAME_LENGTH`
 * in `src/platform/api.ts`" and nothing made that true.
 *
 * This reads the source text rather than importing either module, for the same
 * reason `tests/csp.node.test.ts` does: `tests/**` compiles under
 * `tsconfig.node.json`, which has neither the `@/` alias nor DOM libs, so
 * importing the client here fails with nine unrelated errors. That trap is in
 * `docs/history/README.md` § Toolchain.
 *
 * The failure it prevents is quiet and one-directional. If the *server's* limit
 * were the larger, the server would store a name the client's decoder then
 * rejects as malformed — turning a successful claim into "the server sent
 * something this version cannot read", for that player, permanently. A collision
 * suffix (`ada` → `ada-2`) can push a name to the limit, so this is reachable
 * without anyone typing 24 characters.
 */

function declaredLength(path: string): number {
  const source = readFileSync(path, "utf8");
  const match = /export const MAX_NAME_LENGTH\s*=\s*(\d+)/.exec(source);
  if (match?.[1] === undefined) {
    throw new Error(`${path} no longer exports a literal MAX_NAME_LENGTH`);
  }
  return Number(match[1]);
}

describe("constants duplicated across the client/server boundary", () => {
  it("agree on the maximum name length", () => {
    expect(declaredLength("server/decode.ts")).toBe(declaredLength("src/platform/api.ts"));
  });
});
