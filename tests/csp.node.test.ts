import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectTsFiles, readCode } from "./source.node";

/**
 * The Content-Security-Policy is written down twice — in
 * `server/http/security.ts` for API responses and in `public/_headers` for the
 * static assets the platform serves itself — because `_headers` applies to the
 * one and not the other. Two copies of a security policy is a bug waiting to
 * happen, so this is the thing that makes "change one, change the other" true.
 *
 * The rest of the file guards the assumptions the policy rests on. `script-src
 * 'self'` with no nonce and no hash is only safe while the app has no inline
 * script; `style-src 'self'` is only workable while nothing sets a `style`
 * attribute. Both are true today. Neither is true by construction, and both fail
 * *silently in production* — the page simply stops working, and only for the
 * people who visit it.
 */

const POLICY = /Content-Security-Policy:\s*(.+)/i;

/** Every directive, normalised, so whitespace differences are not failures. */
function directives(policy: string): readonly string[] {
  return policy
    .split(";")
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter((part) => part !== "")
    .sort();
}

function policyFromHeaders(): readonly string[] {
  const match = POLICY.exec(readFileSync("public/_headers", "utf8"));
  if (match?.[1] === undefined) throw new Error("public/_headers declares no CSP");
  return directives(match[1]);
}

/**
 * The policy `server/http/security.ts` builds, read as text.
 *
 * Read rather than imported: this file is typed by `tsconfig.node.json`, and
 * importing a module written against the Workers globals to compare a string
 * would drag the whole runtime-types question into a test about punctuation.
 */
function policyFromWorker(): readonly string[] {
  const source = readFileSync("server/http/security.ts", "utf8");
  const block = /const CSP_DIRECTIVES: readonly string\[\] = \[([\s\S]*?)\];/.exec(source);
  if (block?.[1] === undefined) throw new Error("server/http/security.ts declares no directives");
  return directives([...block[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1] ?? "").join("; "));
}

describe("the two copies of the policy", () => {
  it("agree, directive for directive", () => {
    // A `connect-src` that is right for the API and wrong for the document is a
    // page whose fetches fail with nothing in any log we own.
    expect(policyFromHeaders()).toEqual(policyFromWorker());
  });

  it("still names the directives the app depends on", () => {
    const policy = policyFromWorker();
    expect(policy).toContain("default-src 'none'");
    // Gates /api/* and the error beacon. The load-bearing one.
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("script-src 'self'");
  });
});

describe("the assumptions the policy rests on", () => {
  it("has no inline script in the document", () => {
    // `script-src 'self'` carries no nonce and no hash, so an inline script —
    // including one a build tool injects — would simply not run.
    const html = readFileSync("index.html", "utf8");
    const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map((match) => match[1] ?? "");
    expect(scripts.length).toBeGreaterThan(0);
    for (const attributes of scripts) {
      expect(attributes, "an inline <script> would be blocked").toMatch(/\bsrc\s*=/);
    }
  });

  it("sets no inline style attribute anywhere", () => {
    // CSP governs the `style` *attribute* through `style-src`, but not the
    // CSSOM: `element.style.setProperty(...)` is fine and is what
    // `src/ui/swatch.ts` uses for `--fill-color`. `setAttribute("style", …)` is
    // not, and the difference is invisible until it ships.
    const offenders = ["index.html", ...collectTsFiles("src")]
      .filter((file) => !file.endsWith(".test.ts"))
      .filter((file) =>
        file.endsWith(".html")
          ? /\sstyle\s*=\s*"/.test(readFileSync(file, "utf8"))
          : /setAttribute\(\s*["']style["']/.test(readCode(file)),
      );
    expect(offenders).toEqual([]);
  });

  it("loads no font, image or stylesheet from anywhere but this origin", () => {
    // `default-src 'none'` means there is no `font-src`, so an `@font-face` or a
    // `url(https://…)` in the CSS is a request the browser will refuse.
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).not.toMatch(/@font-face/);
    expect(css).not.toMatch(/@import/);
    expect(css).not.toMatch(/url\(\s*["']?(?:https?:)?\/\//);
  });
});
