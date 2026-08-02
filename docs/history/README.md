# History

Append-only record of what actually happened, session by session. ADRs say what
was decided and why; history says what was *tried*, what broke, and what the
environment did to us. Neither is reconstructable from the code.

**Write a new entry when a session produces reversals, non-obvious bugs, or
tooling surprises.** Do not rewrite old entries — if something recorded here later
turned out to be wrong, say so in the newer entry.

## Index

| # | Session | What came out of it |
|---|---------|---------------------|
| [0001](0001-initial-build.md) | 2026-08-01 — initial build | Whole game from empty directory. Two design reversals after playtest, three layout bugs only visible at phone viewport. |
| [0002](0002-reveal-reticle.md) | 2026-08-02 — reveal reticle | Score screen keeps the picker in place with a target reticle (ADR 0009). Phone bottom-sheet vs centred board; stale dev-server reuse trap. |
| [0003](0003-reveal-side-panel.md) | 2026-08-02 — reveal side panel | Result merged into a persistent side panel so nothing shifts on reveal (ADR 0010, supersedes 0009). Corrects 0002's "reserving height doesn't fit a phone". |
| [0004](0004-backend-scaffold.md) | 2026-08-02 — backend scaffold | `server/` skeleton on Pages Functions + D1 (ADR 0016). Handlers still stubs. Wrangler/D1 typing traps; two schema tensions recorded rather than fixed. |
| [0005](0005-backend-handlers.md) | 2026-08-02 — the seven handlers | All endpoints implemented; anti-abuse policy (ADR 0015). A property test caught a hue "normalisation" that perturbed values already in range. |
| [0006](0006-client-wired-to-the-api.md) | 2026-08-02 — the client meets the board | Tabs, board, name claim, and the orchestrators in `main.ts`. A synchronous `nextSeed` forces the ranked game to be minted before the click; moving focus on tab select fights roving tabindex. |
| [0007](0007-operations.md) | 2026-08-02 — making it operable | Logging, ADR 0014's counters, security headers (ADR 0017), deploy, and a drilled restore (ADR 0018). An echoing hash stub in the fixture made three tests pass for the wrong reason; a no-op `waitUntil` made deferred writes invisible. |
| [0008](0008-e2e-for-the-board-and-the-replay-gate.md) | 2026-08-02 — e2e for the board and the replay gate | Tab bar / board / name claim in e2e (ADR 0013's tripwire exists now), a second Playwright config against a real Worker + D1, and ADR 0016's four engines actually checked. Two configs sharing `testDir` need `testIgnore` on the first. |
| [0009](0009-cold-docs-audit.md) | 2026-08-02 — cold docs audit | Agents numbering against a stale index produced two ADR 0010s, two history 0003s, and silently overwrote committed rows. A *rejected* idea that had since been adopted was the most dangerous artefact. Player-facing copy asserted the opposite of ADR 0016. |
| [0010](0010-a-justfile-and-a-tailnet.md) | 2026-08-02 — a justfile, and the stack on a tailnet | `just` wraps the runbook (ADR 0019); a phone reaches the real stack over Tailscale Serve (ADR 0020). The `Secure` cookie is what rules out a LAN address. `wrangler pages dev` rewrites the `Origin` header's scheme, so the origin guard cannot be tested through it. |
| [0011](0011-pages-to-workers.md) | 2026-08-02 — Pages to Workers | Platform migration only (ADR 0022). Workers Logs is **opt-in** and was off — every log line would have gone nowhere in production. `--var KEY:VALUE` fails silently with `=`. `not_found_handling` is inert while `main` is set. |
| [0012](0012-the-retention-sweep.md) | 2026-08-02 — the retention sweep | The cron ADR 0022 moved the platform for (ADR 0023). **The probabilistic sweep it claimed to replace never existed** — an ADR described unwritten code as current and it was carried forward as fact twice. ADR 0011's name release is deliberately not built: `last_seen_at` moves only inside a `waitUntil` nobody has proven writes. |
| [0013](0013-leaderboard-attempts-and-challenges.md) | 2026-08-02 — leaderboard attempts and challenges | Board rows expand into a replayed attempt; seeds become challenge boards (ADR 0024). The seed-hygiene test forced the server to echo *colours*, not the seed, and the filter to key on an opaque `gameId`. Anti-farming is a `games.kind` column, not a check. A `limit: 0` regression the memory double caught; a name-cell button changed an accessible name; the slide animates with one `offsetHeight` reflow and no `transitionend`. |

## Auditing the docs

When the documentation set changes shape, hand a **fresh agent with no session
context** four or five questions whose answers live in different corners, and tell
it to record every file it opens and to be blunt about what broke. Session 0001
did this and it found a superseded research section that would have led an agent
to rebuild two reverted designs.

Two rules: route it through the real entry point (`CLAUDE.md` → `docs/README.md`)
rather than pointing it at answers, and **re-verify every finding against the
files before acting** — that audit included one confident claim that was false.

Session 0009 did it again after the backend landed, and found that routing was
fine while *truth* was not: a rejected-ideas row that had since been adopted,
player-facing copy contradicting ADR 0016, and a duplicated ADR number that had
silently overwritten a committed index row. **Run this after any stretch where
several agents edited the docs, not only when the shape changes.**

## Documentation traps

Not environment; process. Each of these has actually happened here.

- **Agents number ADRs and history entries against a stale read.** An agent lists
  `docs/adr/` at spawn time, works for twenty minutes, and takes "the next free
  number" — which is no longer free. This produced two ADR 0010s and two history
  0003s in one day, and the loser's index row *overwrote* the winner's, reverting
  a `superseded by` banner to `accepted`. **Re-read the index immediately before
  writing the file.** (history/0009)
- **A rejected idea that has since been adopted is the most dangerous line in the
  repo.** It reads as current and it makes an agent refuse to build something
  already shipped. `adr/README.md` § Already rejected now carries the rule: strike
  the row through in place, never delete it and never leave it standing. The same
  failure had already occurred once in `research/`, where banners were
  institutionalised — but only for research files. (history/0009)
- **Player-facing copy drifts hardest**, because no test reads it and nobody
  re-reads it. `player-guide.md` spent a session telling players the server hands
  out the colours — the exact misconception ADR 0016 exists to prevent.
  (history/0009)
- **A comment saying "must equal X" is not a guard.** This repo tests its
  duplicated CSP and its duplicated scoring core; `MAX_NAME_LENGTH` was duplicated
  with only a comment until `tests/shared-constants.node.test.ts`. (history/0009)
- **An ADR describing the current state of code it is not changing is an
  unverified claim.** ADR 0022 said the retention sweep "exists today as a
  probabilistic pass on write". It did not exist at all — it was proposed during
  scaffolding and never written — and `BACKLOG.md` carried the sentence forward as
  a live gap. Prose *next to* a decision is trusted as hard as the decision.
  Check it against the code before repeating it. (history/0012)

## Environment traps

Discovered the hard way. Each one cost real time; none is guessable from the code.

### Toolchain

- **TypeScript 7 removed `baseUrl`.** Path aliases in `tsconfig.json` must be
  relative: `"@/*": ["./src/*"]`. The alias must be kept in sync across
  `tsconfig.json`, `vite.config.ts` and `vitest.config.ts`.
- **Two TypeScript projects, deliberately.** `tsconfig.json` covers browser code
  with DOM libs; `tsconfig.node.json` covers config files and `*.node.test.ts`
  with Node types. Mixing them makes `setTimeout` return `NodeJS.Timeout` in
  browser code. `npm run typecheck` runs both. A test that reads the filesystem
  belongs in the node project — name it `*.node.test.ts`.
- **`exactOptionalPropertyTypes` rejects `{ foo: undefined }`.** To pass an
  optional prop through, omit the key entirely:
  `deps.formatHex === undefined ? {} : { formatHex: deps.formatHex }`.
- **Playwright's `iPhone 14` descriptor defaults to WebKit.** Pinned to
  `browserName: "chromium"` so CI only installs one browser. You get the viewport,
  DPR, touch and UA — not true iOS Safari fidelity. For that, drop the override
  and add webkit to the CI install step.
- **Three TypeScript projects now.** `tsconfig.server.json` covers `server/**`,
  a *second* compile of the pure core with `"lib": ["ES2022"]`
  and `"types": []` — no DOM, no Node. That second compile is the point: it makes
  "the core runs unmodified under Workers" a compile error when it stops being
  true. `npm run typecheck` runs all three.
- **`npx wrangler types --path server/worker-configuration.d.ts` fails if
  `server/` does not exist.** The error names the config, not the output path.
  `mkdir -p server` first. The generated file is committed, which is why
  `@cloudflare/workers-types` is not a dependency; regenerate it after any
  `wrangler.toml` change and exclude it from Biome (it is 14k lines).
- **A Pages `EventContext` does not satisfy `ExecutionContext`** — the generated
  types give the latter `exports`, `props` and `tracing`. Narrow the app's
  parameter to `Pick<ExecutionContext, "waitUntil">` rather than casting.
  *(Historical since ADR 0022: there is no `EventContext` any more and
  `server/index.ts` is handed a real `ExecutionContext`. The narrowing stays,
  for the test fixture's sake — see history/0011.)*
- **D1's `first()` and `all()` already return `Record<string, unknown>`.**
  `first<MyRow>()` compiles and asserts a shape nobody checked. Call them bare and
  narrow per column.
- **Biome's `complexity/noImportantStyles` is disabled repo-wide** for one reason:
  the `prefers-reduced-motion` block legitimately needs `!important` to beat the
  inline `--dissolve-duration` the swatch writes.
- **The Workers runtime forbids randomness, timers and I/O at global scope.**
  `productionDeps` in `server/context.ts` is a module-scope object literal, so
  anything it *calls* runs at global scope: an eager `crypto.getRandomValues`
  there is `Uncaught Error: Disallowed operation called within global scope` and
  the Worker does not boot. `makeDailySalt` and `makeLogPepper` are both lazy for
  this reason. **No test in this repo can catch it** — vitest runs on Node and
  `npm run e2e` runs against `vite dev`, which never loads the Worker. Only
  `npx wrangler dev` does. (history/0007)
- **`vite dev` applies none of `public/_headers`,** so the e2e suite proves
  nothing about the CSP. To exercise the real stack — Functions, local D1 and the
  headers — run `npm run build && npx wrangler dev --port 8788` and point a
  throwaway Playwright config at it (`use.baseURL`, no `webServer`). Worth doing
  for any change to `server/index.ts`, `wrangler.toml`, `public/_headers` or
  `productionDeps`. (history/0007, command updated by history/0011)
- **Playwright reuses a stale `vite dev` server.** `reuseExistingServer` is on
  when not CI, so if a dev server is already listening on port 5173 — even one
  from a *different checkout* — the whole e2e suite runs against its code, not
  yours. The symptom is "element(s) not found" for a node that plainly exists in
  your source and build. From a worktree, run against a server on another port
  (a throwaway config with a different `PORT` and `reuseExistingServer: true`),
  or stop the stale one. Do not assume a green/red e2e reflects your tree until
  you know which server answered. (history/0002) `playwright.backend.config.ts`
  sidesteps this entirely: its own ports (5174, 8788) and
  `reuseExistingServer: false` on both, because there a stale server also means a
  database that was never wiped. (history/0008)
- **Two Playwright configs sharing a `testDir` collect each other's specs.**
  `testMatch` on the second config protects the second config and nothing else;
  the first one still finds every `*.spec.ts` under `./e2e` and runs it, once per
  project, against a server that cannot serve it. The first config needs
  `testIgnore`. Symptom: `ECONNREFUSED` from the specs you just added, in the run
  you did not add them to. (history/0008)
- **`wrangler d1 migrations apply --local` is additive, not a reset.**
  `.wrangler/state/v3/d1` survives between runs, so `players`, `games` and
  `mint_buckets` accumulate and anything asserting on a unique name or a rank
  starts failing on the *second* run. `npm run d1:reset` removes the directory
  first. (history/0008)
- **A Vite `/api` proxy to wrangler's dev server must use `changeOrigin: false`.**
  With `true` the `Host` header is rewritten to the target, workerd builds
  `request.url` from it, and `server/http/origin.ts` compares the browser's
  `Origin` against a different origin — every POST and DELETE 403s. The identity
  cookie is `SameSite=Strict` and host-only, so two visible origins break it the
  same way. The browser must see exactly one origin. (history/0008)
- **wrangler's dev server rewrites the incoming `Origin` header's scheme** to
  whatever its own listener speaks. Send `Origin: https://host:1234` to an
  `http` listener and the Worker is handed `Origin: http://host:1234`. So a
  plain-HTTP wrangler behind an HTTPS proxy passes `isSameOrigin` *by accident*,
  and — the part that matters — **the origin guard's scheme handling cannot be
  tested through wrangler's dev server at all**. It is scheme-sensitive in
  isolation and `server/http/origin.test.ts` is the only place that is real.
  Symptom: an origin probe where both `http://` and `https://` spellings of the
  right host pass while wrong hosts and ports are correctly refused.
  **True of `wrangler pages dev` (history/0010) and re-measured as still true of
  `wrangler dev` (history/0011).**
- **A `Secure` cookie is silently discarded on a LAN address.**
  `http://localhost` is a secure context; `http://192.168.1.20:5173` is not. The
  page loads, the game plays, the score posts, and the identity cookie never
  arrives — with no error in the console or the log. Any device testing that is
  not over HTTPS or localhost is testing a different application. (history/0010)
- **`server.host: true` is not enough to reach Vite by hostname.** Vite answers
  `Blocked request. This host (…) is not allowed.` for anything that is not
  localhost or a bare IP, and there is no CLI flag — it wants
  `server.allowedHosts`. Deliberately not set here; the tailnet path serves the
  built bundle through wrangler instead, which also gets you the real
  `public/_headers`. (history/0010, ADR 0020)
- **`tailscale serve --https` cannot be reached by IP.** An IP literal carries no
  SNI, so the TLS terminator has no name with which to pick a certificate and
  *aborts the handshake* — `tlsv1 alert internal error`, not a warning anything
  can tap through. This matters because **MagicDNS is unreliable on iOS**, which
  makes the IP the only address that works there. The fix is a raw TCP forward
  (`serve --tcp`), which terminates no TLS: the phone then meets wrangler's
  self-signed certificate and taps through once. `just tailnet` publishes both.
  (history/0010, ADR 0020)
- **HSTS is not port-scoped, and it removes the click-through.** Once a browser
  has loaded the app from `<host>:7443`, the self-signed certificate on
  `<host>:7444` cannot be accepted at all. Use the *IP* on the TCP-forward port:
  RFC 6797 § 8.1.1 requires an HSTS header to be ignored for an IP literal.
  (history/0010)
- **`workerd` outlives `pkill -f "wrangler dev"`.** It is a child process and it
  keeps the port, so the next start fails with `Address already in use` and
  nothing naming the culprit. `just stop` kills both. Note also that only two of
  the three wrangler processes contain the literal string `wrangler dev` — the
  innermost is `.../wrangler-dist/cli.js dev` — but killing the parents brings it
  down. (history/0010, re-verified history/0011)
- **`wrangler dev --var KEY=VALUE` is accepted and does the wrong thing.**
  `wrangler pages dev` took `--binding KEY=VALUE`; `wrangler dev` wants
  `--var KEY:VALUE`, with a colon. The `=` form defines a variable whose *name*
  is `KEY=VALUE` and whose value is empty — no error, and the feature it was
  meant to enable simply stays off. Read the binding table wrangler prints on
  start-up: it shows `env.KEY=VALUE ("(hidden)")` when you have got it wrong.
  (history/0011)
- **Workers Logs is opt-in per Worker.** No `[observability]` block means
  `console.log` output is discarded at the edge. Nothing fails, nothing warns,
  and the whole of ADR 0014 silently produces no data. `wrangler` also emits one
  *invocation log* per request on top of yours, so the free plan's "two events
  per request" budget is fully consumed at `head_sampling_rate = 1`.
  `tests/wrangler-config.node.test.ts` guards it. (history/0011)
- **`[assets] not_found_handling` is inert while `main` is set.** With a Worker
  configured, every asset miss reaches the Worker regardless of the setting or
  the `Accept` header — a deep link answers with whatever the Worker says, not
  `index.html`. Do not reach for `run_worker_first` to "fix" it; that bills an
  invocation for every static file. (history/0011)
- **`wrangler dev` binds `localhost`, not `127.0.0.1`, unless given `--ip`.**
  A `curl` at the dotted address can fail against a dev server that is plainly
  up. (history/0011)
- **`wrangler dev` fires no cron on the clock, ever.** Two hand-invocations, both
  printed at start-up once `[triggers]` exists: `--test-scheduled` adds
  `/__scheduled?cron=…` (→ `Ran scheduled event`), and `/cdn-cgi/local/scheduled`
  needs no flag (→ `ok`) but passes **no cron expression**, so `controller.cron`
  is `""`. There is no equivalent against a *deployed* Worker: nothing triggers a
  production cron on demand, so the only confirmation it ran is the log line it
  emits. (history/0012)
- **`UPDATE … LIMIT` needs a SQLite compile-time option**
  (`SQLITE_ENABLE_UPDATE_DELETE_LIMIT`) and there is no way to ask D1 whether it
  has it. Bound with `WHERE id IN (SELECT … LIMIT ?)` instead. And a `WITHOUT
  ROWID` table — `mint_buckets`, `client_errors` — has no `rowid` to bound a
  `DELETE` by at all; use SQLite's row-value form on the primary key,
  `WHERE (a, b) IN (SELECT a, b FROM t WHERE … LIMIT ?)`. (history/0012)
- **A column written only inside `waitUntil` has no proven freshness.** Nothing
  reads the result, so a failing write is swallowed by the runtime and every test
  stays green. Before building anything that *deletes* on such a timestamp, check
  what writes it and whether anything has ever observed it change — ADR 0011's
  12-month name release is unbuilt for exactly this reason. (history/0012)
- **The wrangler config schema is committed locally** at
  `node_modules/wrangler/config-schema.json`, and it is authoritative for the
  installed version. Read it rather than a documentation page when a field name
  matters. (history/0011)
- **`just --list` shows only the last line of a multi-line comment**, turning a
  paragraph into a fragment in the recipe list. Use an explicit `[doc("…")]`
  attribute when the explanation needs more than one line — and note that `{{ }}`
  interpolation does *not* happen inside it. `just` also parses `base="x" + var:`
  as *two* parameters; an expression default needs parentheses. (history/0010)

### Testing

- **happy-dom's CSS parser silently drops `oklch()`** from `background` and
  `background-color`. Assigning `el.style.background = "oklch(...)"` leaves `""`,
  so every component test would assert on an empty string. **All colour rendering
  goes through the `--fill-color` custom property** via `setFillColor` in
  `src/ui/swatch.ts`; custom properties round-trip raw. This is why the pattern
  exists — do not "simplify" it back to `style.background`.
- **`console.log` inside vitest is swallowed** in this setup. To surface a value
  while debugging, assert on it rather than logging it.
- **happy-dom has no layout and no canvas rendering.** Geometry and pixels cannot
  be tested there. `src/ui/picker.ts` is therefore split: pure exported coordinate
  maths (fully tested, property-based) plus a thin DOM wrapper that takes
  `measure` and `getContext` injections. Keep that split.
- **happy-dom fires no `transitionend` and runs no CSS transitions.** A component
  that deferred DOM state to a `transitionend` handler would leave that state
  unset in every unit test. The board's expandable rows animate open with a
  CSS-only `grid-template-rows` transition and snap closed by toggling the
  `hidden` attribute synchronously — no timer, no `transitionend`, so the open/
  closed state is deterministic under happy-dom and real in the browser
  (`src/ui/leaderboard.ts`, ADR 0024).
- **Vitest is split into two projects** (`app` on happy-dom, `server` on node).
  A backend test that passes only because happy-dom supplied a `window` is a test
  that lies about the Worker. Node 26 provides `Request`, `Response` and
  `crypto.subtle` globally, so nothing there needs a polyfill. Both projects need
  the `@/` alias — `server/**` uses relative imports, but the core's own imports
  do not.
- **Literal control characters in a source file make `grep` treat it as binary**,
  so it silently reports no matches in the file you just wrote. Write character
  classes with `\uXXXX` escapes — and note this is not only about regexes: a NUL
  written straight into a template literal does it too. (history/0004)
- **Biome reads an identifier named `fit` as a focused test**
  (`lint/suspicious/noFocusedTests`), in any file, and offers to rename it to
  `it`. Do not name anything `fit`, `fdescribe` or `xit`. (history/0004)
- **A "normalisation" that is not the identity on already-normal values is a
  silent perturbation.** `((h % 360) + 360) % 360` changes a small hue in its low
  bits, which is enough to make the server's ΔE differ from the client's in the
  last place. Guard the in-range case. Property tests find this; example tests do
  not. (history/0004)
- **SQLite's default TEXT collation is BINARY, which is code point order;
  JavaScript's `<` is UTF-16 code unit order.** They disagree above the BMP, so
  one emoji in a name orders the in-memory board differently from D1. See
  `compareText` in `server/db/memory.ts`.
- **Layout bugs are invisible to unit tests and to desktop.** Three separate ones
  in this repo only appeared at the iPhone 14 viewport. Assert geometry in
  `e2e/game.spec.ts`.
- **`app.fixture.ts`'s `hashToken` stub echoes its input** (`hash:${token}`). It is
  a fine stand-in for a lookup key and a trap for anything whose behaviour *is* a
  property of the hash: a "no token in the logs" assertion fails against it, and a
  fingerprint sliced to 32 characters collides for every input sharing a prefix.
  Inject the real `sha256Hex` in those tests. (history/0007)
- **A no-op `waitUntil` in a test fixture hides every deferred write.** "The
  handler forgot to write" and "the handler correctly deferred" then look
  identical and both pass. The fixture collects the promises and `send()` drains
  them. (history/0007)
- **A source-scanning guard needs tests for what it must *not* match.** The
  header-dump guard's first pattern, `of\s+[\w.]*headers`, matched
  `for (const … of LOGGED_HEADERS)` in the file defining the allow-list — an
  underscore is a word character, so there is no `\b` before `HEADERS`. Require
  the token to start after a dot or a space. (history/0007)
- **Writing a NUL into a source file makes `grep` treat it as binary**, and
  agents' file-writing tools will happily write a real NUL where the escape `\u0000` was
  intended. `file <path>` reporting `data` rather than `Unicode text` is the tell.
  This is the trap history/0004 already recorded, hit again twice. Prefer
  `JSON.stringify([a, b])` over a NUL-separated concatenation when the separator
  is incidental. (history/0007)

### Colour science

Full detail in `../research/color-science.md`. The three that bite hardest:

- **CSS `lab()` is D50. We use D65 with no chromatic adaptation.** Mixing them
  puts sRGB blue at L\* 29.57 instead of 32.30 — a large, silent divergence. A
  test asserts the D65 value *and* that it is not the D50 one, so a switch fails
  the build.
- **The two sRGB transfer-function thresholds are different numbers**
  (0.04045 decode, 0.0031308 encode). One shared constant is a bug. Continuity at
  the encode breakpoint is only ~2.9e-8, not exact — that step is real.
- **CIEDE2000 is full of traps** — signed ΔC′/ΔH′, a four-case mean hue, the R_T
  rotation term. Naive implementations pass the CIE's own worked examples while
  being wrong. This is why `src/color/deltaE.test.ts` runs all 34 Sharma/Wu/Dalal
  pairs; keep them.
