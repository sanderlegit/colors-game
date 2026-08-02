# 0011 — Pages to Workers with static assets

2026-08-02. Platform migration only, no behaviour change. ADR 0022.

## What was done

`wrangler.toml` gained `main`, `[assets]`, `[observability]` and
`workers_dev = false`, and lost `pages_build_output_dir` and its
`[env.production]` block. `functions/` is gone: `functions/api/[[path]].ts`
became `server/index.ts`, `functions/env.d.ts` became `server/env.d.ts`, and
`functions/debug/replay-vectors.ts` became `server/debug/replay-vectors.ts` — a
handler in the ordinary route table, gated on `env.DEBUG_REPLAY` exactly as
before. `server/app.ts` changed by one route-table row and two comments, which
is the useful measurement: ADR 0016 § 1 was well isolated from the other three.

`npm run verify` 1143 tests, `npm run e2e` 38, `npm run e2e:backend` 2.

## The thing that was nearly missed, and was not in the brief

**Workers Logs is opt-in per Worker.** There was no `[observability]` block.
Every one of the ~1100 tests around `server/log.ts` passed, every structured
record was correct, and in production they would have gone nowhere — no test
fails, no deploy complains, and the first symptom is an empty log view during an
incident. Pages configured Functions logging elsewhere, so this became ours only
on the way across.

The wrangler 4.118 schema (`node_modules/wrangler/config-schema.json`, which is
local and authoritative — do not trust a doc page for a field name) exposes
`observability.enabled`, `observability.head_sampling_rate`, and nested
`observability.logs` with `invocation_logs`, `persist` and `destinations`.

That last one changes what `OPERATIONS.md` § 1's budget means. The free plan's
200,000 log events a day against a 100,000 request/day cap reads as "about two
lines per request" — and **both are already spoken for**: Workers emits one
invocation log per request *in addition* to our `console.log`. Full sampling
fits exactly, with no headroom. Invocation logs were left on deliberately: they
are the only record of a request that died before `app.ts` could log anything.

`tests/wrangler-config.node.test.ts` now fails the build if observability is off
or sampled down, in the same spirit as `tests/csp.node.test.ts`.

## Traps, measured rather than assumed

- **`--var KEY:VALUE`, and the wrong punctuation is silent.** `wrangler pages
  dev` took `--binding DEBUG_REPLAY=1`; `wrangler dev` takes
  `--var DEBUG_REPLAY:1`. Passing `--var DEBUG_REPLAY=1` does not error — wrangler
  prints `env.DEBUG_REPLAY=1 ("(hidden)")` in the binding table, having defined a
  variable whose *name* is `DEBUG_REPLAY=1`, and the route stays 404. Read the
  binding table wrangler prints at start-up; it is the only feedback there is.
- **`wrangler dev` rewrites the incoming `Origin` header's scheme exactly as
  `wrangler pages dev` did.** Re-measured because it was worth hoping otherwise
  (`OPERATIONS.md` § 5.1 flags the workaround). Against an `https` listener on
  `127.0.0.1:8788`, `Origin: http://127.0.0.1:8788` and
  `Origin: https://127.0.0.1:8788` both produced a **201**, while
  `https://127.0.0.1:9999` correctly produced a **403** — the same symptom
  history/0010 recorded. The skipped e2e origin assertion stays skipped, and
  `server/http/origin.test.ts` remains the only real coverage of the scheme
  comparison. The § Environment traps entry was amended in place to name both
  commands, which is the one edit this file's append-only rule permits.
- **`not_found_handling` is inert while `main` is set.** Measured: with a Worker
  configured, *every* asset miss reaches it — navigation request or not.
  `/some/deep/link` with `Accept: text/html` answered with the API's JSON 404,
  not `index.html`. `single-page-application` is declared because it is the right
  value if the Worker ever stops handling misses; it changes nothing today. Do
  not "fix" a deep-link 404 by reaching for `run_worker_first`.
- **`wrangler dev` binds `localhost`, not `127.0.0.1`, without `--ip`.** A
  `curl 127.0.0.1:8788` against a default-bound dev server can fail while
  `localhost:8788` works. `just serve` passes `--ip 127.0.0.1`;
  `playwright.backend.config.ts` uses `localhost`. Both are right, for different
  reasons, and neither is interchangeable with the other.
- **`pkill -f 'wrangler dev'` does not match the process that does the work.**
  Three processes run: `npm exec wrangler dev`, `node .../.bin/wrangler dev`, and
  `node .../wrangler-dist/cli.js dev` — only the first two contain the literal
  string. Killing them does bring down the third, and `pkill -f workerd` frees
  the port either way, so `just stop` still clears everything. Verified by
  running it and listing survivors.
- **`wrangler types` now emits `mainModule: typeof import("./index")`** into the
  generated file, so `server/worker-configuration.d.ts` has a relative import
  into `server/index.ts`. Regenerate after any `wrangler.toml` change, as before.

## What was left alone, deliberately

- **The retention sweep is still probabilistic-on-write.** Cron triggers are the
  deciding reason for the move (ADR 0022) and the trigger is the next commit, so
  that this diff reads as a platform change and nothing else.
- **`public/_headers` ships unchanged.** Workers static assets applies it
  natively; `wrangler dev` prints `Parsed 1 valid header rule` when it has. It
  still does not apply to Worker responses, which is why the policy is still
  written twice and `tests/csp.node.test.ts` still compares them.
- **`AppExecutionContext` stays `Pick<ExecutionContext, "waitUntil">`.** The
  original reason is gone — history/README § Environment traps records that a
  Pages `EventContext` does not satisfy `ExecutionContext`, and there is no
  `EventContext` any more. The narrowing is worth keeping on its own merits: it
  is what lets `app.fixture.ts` supply a context that collects and drains the
  deferred promises. That trap entry is now historical; it is left standing
  because this file is append-only and this paragraph is the correction.

## Not verified, and not verifiable here

No deploy was run and no Cloudflare credentials exist (`BACKLOG.md` § 4.5). So:
`wrangler deploy` with `workers_dev = false` and no `routes`; the
`routes`/`custom_domain` block creating a DNS record; `wrangler secret put
CANONICAL_HOST` reaching the deployed Worker and only it; and `[observability]`
producing anything in the dashboard. All four are listed in `BACKLOG.md`
§ Known gaps → Platform gaps.
