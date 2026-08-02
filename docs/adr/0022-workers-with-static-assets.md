# 0022 — A Worker with static assets, not a Pages project

Date: 2026-08-02 · Status: accepted · Supersedes ADR 0016 § Decision 1 only

## Context

ADR 0016 put the API on **Cloudflare Pages Functions** and the bundle on Pages.
Everything it said about *why* still holds: same origin, so the identity cookie
can be `SameSite=Strict` and there is no CORS surface; D1 is SQLite, so the
schema is ordinary SQL; one `wrangler` away from running locally. None of that is
what changed.

What changed is the work queued behind it. `BACKLOG.md` has wanted a sweep of
stale `active` games since the schema was written, and ADR 0016 § What this does
not decide names it. The sweep exists today as a **probabilistic pass on write** —
a small chance, per submission, of also deleting expired rows. That is a real
technique and it is also an apology: it does no work when nobody is playing,
which is exactly when the rows accumulate, and its cost lands on a player's
request.

The fix is a scheduled handler. **Pages Functions have no cron triggers, and
Cloudflare documents no plan to add them.** A Pages project that needs one has to
grow a second Worker beside it, with its own deploy, its own D1 binding, and its
own copy of `server/db/d1.ts` — two deploy artefacts for one application, and a
schema change that has to land in both.

Two smaller things pointed the same way. `wrangler pages deploy` had drifted from
being the documented default for new projects, and — the one that costs nothing
and is worth having — a Pages project answers on `<project>.pages.dev` forever,
which is the entire reason ADR 0021 exists.

## Decision

**Deploy as a Worker with static assets.** `wrangler.toml` gains `main`,
`[assets]` and `workers_dev = false`, and loses `pages_build_output_dir`.
`functions/` is deleted: `server/index.ts` is a five-line `fetch` handler onto the
same `createApp()`, and the debug route folds into the route table as an ordinary
gated route.

**The cron trigger is not in this change.** It is the next commit, deliberately,
so the platform diff is readable on its own.

Three supporting decisions:

1. **`CANONICAL_HOST` is a secret (`wrangler secret put`), not an `[env]` var.**
   The `[env.production]` block ADR 0021 relied on is a trap on Workers that it
   was not on Pages. Environments do **not** inherit non-inheritable keys, so
   `[env.production]` would have to redeclare every `[[d1_databases]]` entry or
   the production deploy ships with **no D1 binding** — a silent break that
   surfaces only as 500s in production. `--env production` also appends the
   environment name to the Worker name unless `name` is redeclared inside the
   block, which creates a *second* Worker. A secret has neither failure mode: it
   lives on the deployed Worker, survives deploys, is absent from the config file,
   and never reaches `wrangler dev`. It is not secret in the cryptographic sense —
   it is a hostname — but "a value that exists only on the deployed Worker" is
   precisely the property ADR 0021 asked for, and this is the mechanism that has
   it. `tests/wrangler-config.node.test.ts` fails the build if it appears in
   `wrangler.toml`.
2. **`run_worker_first` is not set.** Assets are matched before the Worker — the
   inverse of Pages, where a Function claimed its path first. `/api/*` and
   `/debug/*` are not files in `dist/`, so they miss and fall through; everything
   else is served without an invocation. `run_worker_first = true` would restore
   the Pages ordering and bill a Worker invocation for every image and every
   stylesheet, to reproduce behaviour that is already correct.
3. **`[observability] enabled = true`.** Workers Logs is opt-in per Worker, and
   ADR 0014's entire design is `console.log`. Without the block, every structured
   record `server/log.ts` builds is discarded at the edge and nothing says so.
   This was not a Pages concern and is one of the two things this migration could
   have got silently wrong.

## Consequences

- **Cron triggers are available.** That is the point, and it is the next commit.
- **`workers_dev = false` makes ADR 0021's premise partly obsolete.** The
  `*.pages.dev` hostname that could not be switched off is gone; the free
  `*.workers.dev` one can be, and is. `server/http/canonical.ts` stays as it is —
  the property it enforces is about *any* second hostname, and a staging domain
  or a second custom domain reintroduces it exactly — but it is now a guard
  against a future mistake rather than a fix for a live one. ADR 0021's status
  line is marked accordingly.
- **Custom domains must be in a Cloudflare zone.** A Pages custom domain can be
  attached with third-party DNS via a CNAME; a Worker custom domain requires the
  zone to be on Cloudflare. `colors.aaadataplumbing.com` already is, so this costs
  nothing today and would cost a nameserver migration if the zone ever moved.
- **Per-environment bindings are given up**, by choice. One Worker, one set of
  bindings, and anything that must differ between local and deployed goes through
  `wrangler secret put` or `.dev.vars`. The alternative is the redeclaration trap
  in Decision 1, and this project has one environment.
- **Early Hints are given up.** Pages sends `103 Early Hints` for `_headers`
  `Link:` entries; Workers static assets do not. Nothing here uses them — there is
  one stylesheet and one script, both discovered in the first few hundred bytes of
  a 0.89 kB document — but a future preload strategy has one fewer tool.
- **`not_found_handling` is inert while a Worker is configured.** Measured, not
  assumed: with `main` set, *every* asset miss reaches the Worker, navigation
  request or not, and `/some/deep/link` answers with the API's JSON 404. The
  setting is declared because it is the right value if that ever stops being
  true; it changes nothing today.
- **The four-engine replay gate is unchanged**, and still runs in the bundle that
  deploys — `server/debug/replay-vectors.ts` is now compiled into the same module
  graph as every other route rather than into a sibling Pages Function, which is
  if anything a closer match to "the thing proved is the thing deployed".
- **`wrangler dev` rewrites the incoming `Origin` header's scheme exactly as
  `wrangler pages dev` did.** Re-measured on the way in, because it was worth
  hoping otherwise. The e2e origin-check assertion stays skipped and
  `server/http/origin.test.ts` remains the only real coverage of the scheme
  comparison. `history/README.md` § Environment traps is amended in place to name
  both commands.
- One flag spelling changes and it fails silently: `wrangler pages dev --binding
  KEY=VALUE` becomes `wrangler dev --var KEY:VALUE`. Passing `--var KEY=VALUE`
  does not error — it defines a variable *named* `KEY=VALUE`, and the route it
  was meant to enable stays 404. Verified.

## What this does not change

The replay design, the `Repo` port, the schema, `tsconfig.server.json`'s second
compile of the pure core, the zero-runtime-dependency rule, and every one of
ADR 0016's other three supporting decisions. `server/app.ts` is untouched but for
one route-table row. That is the test of whether ADR 0016 § 1 was well isolated,
and it was.
