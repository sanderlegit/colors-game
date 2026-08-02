import { describe, expect, it } from "vitest";
import { collectTsFiles, readCode } from "./source.node";

/**
 * The guard for the failure that actually happens.
 *
 * Nobody sets out to log a session token. What happens is that somebody is
 * debugging a 403 at speed, writes `console.log({ headers: [...request.headers] })`
 * to see what arrived, finds the bug, and ships. The `Cookie` header — and
 * therefore the identity token, which is a session identifier on OWASP's logging
 * exclusion list — is now in a log store that is replicated, indexed, and
 * searchable by anybody with dashboard access.
 *
 * `server/log.ts` allow-lists the headers it records, but an allow-list only
 * protects the code that goes through it. This is the part that makes the rule
 * hold everywhere: a dump anywhere in `server/**` fails the build, exactly as
 * `purity.node.test.ts` does for ADR 0002. A documented convention decays; a red
 * build does not.
 *
 * Patterns are matched against source with comments and string literals
 * stripped, so the prose in `server/log.ts` describing this very mistake does
 * not trip it.
 */

const SERVER_FILES = collectTsFiles("server").filter(
  (file) => !file.endsWith(".test.ts") && !file.endsWith(".d.ts") && !file.endsWith(".fixture.ts"),
);

/**
 * Every spelling of "turn a Headers object into data".
 *
 * `Headers` is iterable, so the dangerous forms are the ones that enumerate it
 * rather than the ones that name a header: `headers.get("user-agent")` is fine
 * and is how the allow-list works.
 */
const HEADER_DUMPS: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  {
    pattern: /\.\.\.\s*(?:\w+\.)*headers\b/i,
    why: "spreading a Headers object dumps Cookie with it",
  },
  {
    pattern: /\bheaders\s*\.\s*(?:entries|keys|values|forEach)\s*\(/i,
    why: "enumerating headers dumps Cookie with them",
  },
  {
    pattern: /\bof\s+(?:\w+\.)*headers\s*\)/i,
    why: "iterating headers dumps Cookie with them",
  },
  {
    pattern: /\bObject\s*\.\s*fromEntries\s*\(/,
    why: "the only reason to reach for this in the backend is to dump a Headers object",
  },
  {
    pattern: /\bJSON\s*\.\s*stringify\s*\(\s*(?:\w+\.)*headers\b/i,
    why: "serialising headers dumps Cookie with them",
  },
];

/**
 * Where a `console` call is allowed to live.
 *
 * Exactly one: `productionDeps.emit` in `server/context.ts`, which is the port
 * `app.ts` writes its one wide event through. Everything else — a stray
 * debugging line, a `console.error` in a catch — is either exhaust nobody reads
 * or a second, unreviewed path into the log store, and the budget (about two log
 * events per request on the free plan) does not have room for it either.
 */
const CONSOLE_ALLOWED = "server/context.ts";

describe("nothing in the backend dumps request headers", () => {
  it("scans the backend", () => {
    expect(SERVER_FILES.length).toBeGreaterThan(0);
  });

  for (const file of SERVER_FILES) {
    it(`${file} names the headers it reads`, () => {
      const code = readCode(file);
      const violations = HEADER_DUMPS.filter(({ pattern }) => pattern.test(code)).map(
        ({ pattern, why }) => `${String(pattern)} — ${why}`,
      );
      expect(violations, `${file} dumps request headers into somewhere`).toEqual([]);
    });
  }

  it("catches the dump it exists for", () => {
    // The guard's own guard: a pattern that matches nothing is not a guard.
    // These are the four spellings of the mistake, verbatim.
    const planted = [
      "console.log({ headers: [...request.headers] });",
      "const all = Object.fromEntries(request.headers.entries());",
      "for (const [name, value] of request.headers) { record[name] = value; }",
      "log(JSON.stringify(request.headers));",
    ];
    for (const line of planted) {
      expect(
        HEADER_DUMPS.some(({ pattern }) => pattern.test(line)),
        `the guard would not catch: ${line}`,
      ).toBe(true);
    }
  });

  it("does not object to naming one header", () => {
    // `server/log.ts`'s allow-list and every CSRF/cookie read look like this.
    const fine = [
      'request.headers.get("user-agent");',
      'const origin = request.headers.get("origin");',
      'headers.set("cache-control", "no-store");',
      "new Headers(response.headers);",
    ];
    for (const line of fine) {
      expect(
        HEADER_DUMPS.some(({ pattern }) => pattern.test(line)),
        `the guard falsely rejects: ${line}`,
      ).toBe(false);
    }
  });
});

describe("all backend logging goes through the one wide event", () => {
  for (const file of SERVER_FILES) {
    if (file.replace(/\\/g, "/") === CONSOLE_ALLOWED) continue;
    it(`${file} calls no console method`, () => {
      expect(/\bconsole\s*\./.test(readCode(file)), `${file} logs outside app.ts`).toBe(false);
    });
  }

  it("still has the one emit it is allowed", () => {
    // If this ever fails, the rule above is guarding nothing.
    expect(/\bconsole\s*\.\s*log\s*\(/.test(readCode(CONSOLE_ALLOWED))).toBe(true);
  });
});
