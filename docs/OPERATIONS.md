# Operations

Running the thing: what it logs, what it counts, how it deploys, and what to do
when something is wrong. Decisions live in `adr/0014`, `adr/0017` and `adr/0018`;
this is the page you open at the time.

---

## 1. Logs

**Workers Logs *is* `console.log`.** Cloudflare parses a JSON line and indexes
its fields, so there is no library, no agent and nothing to install — see
`adr/README.md` § Already rejected before proposing one.

> **It is enabled by configuration, and it is opt-in.** `wrangler.toml`:
>
> ```toml
> [observability]
> enabled = true
> head_sampling_rate = 1
> ```
>
> Delete that block, or set `enabled = false`, and **every line below stops
> existing** — silently. The records are still built, still correct, and still
> discarded at the edge; no test fails, no deploy complains, and the first sign
> is an empty log view during an incident. `tests/wrangler-config.node.test.ts`
> fails the build if it is switched off or sampled down. This was not a Pages
> concern; it became ours with ADR 0022.

One wide event per request, emitted from `server/app.ts` and nowhere else. The
free plan allows 200,000 log events a day against a 100,000 request/day Worker
cap, which is about two lines per request. **Both are spoken for**: Workers emits
one *invocation log* per request in addition to our `console.log`, so the budget
is exactly consumed at full sampling and there is no headroom for a second line.
One wide event is the budget, not a preference.

Invocation logs are deliberately left on (`observability.logs.invocation_logs`
would turn them off). They are the only record of a request that failed *before*
`server/app.ts` could log anything — an exception at global scope, an exceeded CPU
limit — which is precisely the class of failure the wide event cannot report.

Retention is **3 days**. If you would be sad to lose it in three days, it belongs
in D1 (ADR 0014), not here.

> **Reading the past 3 days needs a scoped token; the wrangler login does not
> have it.** `npx wrangler tail` streams the log **live** — it cannot query what
> already happened, and the OAuth token `wrangler login` mints
> (`workers_tail:read`) does not authorise the Workers Observability query API
> either (it answers `10000 Authentication error`). To read the retained 3 days —
> the usual case during an incident that has already occurred — use the dashboard
> Logs view, or a Cloudflare **API token** with **Account → Workers
> Observability: Read**. It still only reaches 3 days; anything you must answer
> later than that belongs in D1, not here (ADR 0014, and the name-change audit in
> ADR 0031).

```json
{"@timestamp":"2026-08-02T13:45:01.004Z","level":"info","severity_number":9,
 "message":"POST /api/games/:gameId/result 200","service":"colors-api",
 "request_id":"00f067aa0ba902b7","trace_id":"4bf92f3577b34da6a3ce929d0e0e4736",
 "event":"score_submitted","duration_ms":4,"status":200,
 "http.request.method":"POST","url.path":"/api/games/:gameId/result",
 "player.key":"9f2c81a0b3de","user_agent.original":"Mozilla/5.0 …"}
```

`event` is one of `health_checked`, `dependencies_checked`, `identity_read`,
`game_started`, `score_submitted`, `name_claimed`, `leaderboard_read`,
`client_error_reported`, `not_routed`. They come from the route table in
`server/app.ts`, so a new endpoint cannot ship without one. (`identity_forgotten`
is gone with the self-serve delete — ADR 0025.)

`retention_swept` is the one event that is not a request: it is the daily sweep
(§ 6), emitted from `server/sweep.ts` through the same port. It carries no
`player.key`, no `url.path` and no `request_id`.

`replay_vectors_checked` is the eleventh and you will never see it in
production: it is the `DEBUG_REPLAY`-gated route, which answers 404 with that
event name attached anywhere the flag is not set. A production log line carrying
it means the flag has shipped — which `tests/debug-flag.node.test.ts` exists to
prevent, and which is worth recognising if it ever appears anyway.

An incoming W3C `traceparent` is adopted as `trace_id`; `request_id` is minted
per hop.

### What is never in a log line

Enforced, not documented — `server/log.test.ts` and `tests/logging.node.test.ts`
fail the build:

| Never | Why | Instead |
|---|---|---|
| The identity token | A session identifier under the OWASP Logging Cheat Sheet's exclusion list | `player.key`: the first 12 hex of a peppered SHA-256 |
| `CF-Connecting-IP` | ADR 0015 — it exists inside one request and becomes a mint bucket | nothing |
| `url.pathname` | The submit path contains the game id, and that id **is** the single-use submit token | the route pattern |
| A raw header dump | `console.log({headers: [...request.headers]})` puts `Cookie` in the log store | an allow-list: `user-agent`, `content-type`, `cf-ray` |

`player.key`'s pepper is per isolate, so it groups a player's requests within one
isolate and means nothing outside the log store — the same trade ADR 0015 records
for the mint salt, with the same consequence: grouping is not global.

### Client errors

`POST /api/client-error` (`src/platform/errors.ts` → `server/handlers/clientError.ts`)
is where browser exceptions land, because a throw inside the rAF loop leaves a
page that renders nothing and generates no server log line at all. Reports are
deduplicated by `hash(message + stack)` per day, rate-limited per mint bucket,
and kept **30 days** — enforced twice, on write and by the daily sweep (§ 6).
The write-side purge is what keeps the promise true between sweeps; it cannot
keep it true once reports stop arriving, which is the healthy state.

```sql
-- What is breaking, worst first.
SELECT day, n, message, substr(stack, 1, 120) AS frame
  FROM client_errors
 WHERE day >= date('now', '-7 day')
 ORDER BY n DESC
 LIMIT 20;
```

---

## 2. Telemetry — the four questions

Counters only: `round_stats` and `game_stats` (migration `0002_telemetry.sql`,
ADR 0014). No per-round rows, no per-player rows, nothing to subject-access or
delete. Written from the submit handler behind `waitUntil`.

Two conventions the queries below rely on:

- **`delta_e_bucket` is the floor of ΔE00**, 1-unit steps, capped at 40.
- **Percentiles, never means.** SPEC §6 established this for the UI — the
  random-guess distribution is heavily right-skewed and a mean misleads. The
  identical reasoning applies here, and a mean ΔE would be actively wrong about
  difficulty.

The percentile idiom throughout is a running sum over the histogram: take the
first bucket whose cumulative count reaches half (or a tenth, or nine tenths) of
the total.

### 2.1 Is it too hard?

SPEC §6 puts chance level near **ΔE 11** and "trivial" under **ΔE 2**. So a p50
at or above 11 means players are not beating chance and the game is broken
whatever the scores read; a p50 under 2 means it is not a game.

```sql
WITH totals AS (
  SELECT SUM(n) AS all_rounds FROM round_stats WHERE day >= date('now', '-28 day')
),
histogram AS (
  SELECT delta_e_bucket,
         SUM(n) AS n,
         SUM(SUM(n)) OVER (ORDER BY delta_e_bucket) AS running
    FROM round_stats
   WHERE day >= date('now', '-28 day')
   GROUP BY delta_e_bucket
)
SELECT
  MIN(CASE WHEN running >= all_rounds * 0.10 THEN delta_e_bucket END) AS p10,
  MIN(CASE WHEN running >= all_rounds * 0.50 THEN delta_e_bucket END) AS p50,
  MIN(CASE WHEN running >= all_rounds * 0.90 THEN delta_e_bucket END) AS p90
FROM histogram, totals;
```

The knob is `SCORE_SCALE`, which `TUNING.md` already names first.

### 2.2 Which tier is miscalibrated?

Same percentile, grouped. v1 only ever issues `difficulty = 'normal'` (ADR 0015
§ 5), so today this reads as a per-tier check that will start saying something
the moment the other tiers are wired up — and, in the meantime, as a per-round
one, which is the version that is actually informative now: round 5 should not be
markedly worse than round 1, and if it is, the game is tiring people out rather
than testing them.

```sql
WITH totals AS (
  SELECT difficulty, round_index, SUM(n) AS all_rounds
    FROM round_stats
   WHERE day >= date('now', '-28 day')
   GROUP BY difficulty, round_index
),
histogram AS (
  SELECT difficulty, round_index, delta_e_bucket,
         SUM(n) AS n,
         SUM(SUM(n)) OVER (
           PARTITION BY difficulty, round_index ORDER BY delta_e_bucket
         ) AS running
    FROM round_stats
   WHERE day >= date('now', '-28 day')
   GROUP BY difficulty, round_index, delta_e_bucket
)
SELECT h.difficulty, h.round_index, t.all_rounds,
       MIN(CASE WHEN h.running >= t.all_rounds * 0.50 THEN h.delta_e_bucket END) AS p50
  FROM histogram h
  JOIN totals t ON t.difficulty = h.difficulty AND t.round_index = h.round_index
 WHERE t.all_rounds >= 20                          -- ADR 0014: suppress thin buckets
 GROUP BY h.difficulty, h.round_index
 ORDER BY h.difficulty, h.round_index;
```

### 2.3 The hue skew — the one this table exists for

ADR 0008 knowingly accepted an unmitigated afterimage bias and said that if
scores ever show a systematic **hue-opponent** skew, ADR 0006 is the first place
to look. `round_stats.hue_bucket` is the instrument that makes it detectable, and
until migration 0002 it did not exist.

Twelve 30° buckets, so the opponent axes are pairs **six apart**: bucket 0 (reds)
against bucket 6 (cyans), bucket 3 (yellow-greens) against bucket 9 (blues).

```sql
WITH totals AS (
  SELECT hue_bucket, SUM(n) AS all_rounds
    FROM round_stats
   WHERE day >= date('now', '-28 day')
   GROUP BY hue_bucket
),
histogram AS (
  SELECT hue_bucket, delta_e_bucket,
         SUM(SUM(n)) OVER (PARTITION BY hue_bucket ORDER BY delta_e_bucket) AS running
    FROM round_stats
   WHERE day >= date('now', '-28 day')
   GROUP BY hue_bucket, delta_e_bucket
),
p50 AS (
  SELECT h.hue_bucket, t.all_rounds,
         MIN(CASE WHEN h.running >= t.all_rounds * 0.50 THEN h.delta_e_bucket END) AS p50
    FROM histogram h JOIN totals t ON t.hue_bucket = h.hue_bucket
   WHERE t.all_rounds >= 20
   GROUP BY h.hue_bucket
)
SELECT a.hue_bucket        AS hue,
       a.hue_bucket * 30   AS degrees,
       a.p50               AS p50,
       b.p50               AS opponent_p50,
       a.p50 - b.p50       AS skew
  FROM p50 a
  JOIN p50 b ON b.hue_bucket = (a.hue_bucket + 6) % 12
 WHERE a.hue_bucket < 6
 ORDER BY ABS(a.p50 - b.p50) DESC;
```

**How to read it.** Expect `skew` near zero. A consistent non-zero `skew` on one
axis, holding over weeks and over enough rounds, is the afterimage bias made
visible — go to ADR 0006 and ADR 0008. A single week of noise on one pair is
noise; ADR 0014 says suppress anything under 20 and that floor is in the query.

### 2.4 Does the memorize setting change anything?

`memorize_ms` is in the primary key for exactly this. SPEC §8 offers 3s/5s/8s and
it is the *only* difficulty knob v1 exposes, so a distribution without it could
not answer this at all.

```sql
WITH totals AS (
  SELECT memorize_ms, SUM(n) AS all_rounds
    FROM round_stats WHERE day >= date('now', '-28 day') GROUP BY memorize_ms
),
histogram AS (
  SELECT memorize_ms, delta_e_bucket,
         SUM(SUM(n)) OVER (PARTITION BY memorize_ms ORDER BY delta_e_bucket) AS running
    FROM round_stats
   WHERE day >= date('now', '-28 day')
   GROUP BY memorize_ms, delta_e_bucket
)
SELECT h.memorize_ms, t.all_rounds,
       MIN(CASE WHEN h.running >= t.all_rounds * 0.50 THEN h.delta_e_bucket END) AS p50
  FROM histogram h JOIN totals t ON t.memorize_ms = h.memorize_ms
 WHERE t.all_rounds >= 20
 GROUP BY h.memorize_ms
 ORDER BY h.memorize_ms;
```

A flat p50 across 3s, 5s and 8s means the setting is decoration and the
memorize phase is not where the difficulty lives.

### 2.5 Completion rate, and the caveat on it

```sql
SELECT day, memorize_ms,
       SUM(CASE WHEN event = 'started'   THEN n ELSE 0 END) AS minted,
       SUM(CASE WHEN event = 'completed' THEN n ELSE 0 END) AS completed,
       SUM(CASE WHEN event = 'flagged'   THEN n ELSE 0 END) AS flagged
  FROM game_stats
 WHERE day >= date('now', '-28 day')
 GROUP BY day, memorize_ms
 ORDER BY day DESC;
```

**`started` counts mints, not plays.** `src/main.ts` issues a ranked game *ahead*
of the Play click and again after every submission, so a visitor who never plays
still increments it and every session mints one game it never uses.
`completed / minted` is therefore a **lower bound** on the completion rate,
understated by roughly one game per session. Read the trend, not the level.

`flagged` is the ADR 0015 check — expect approximately zero. A rate above a
fraction of a percent means a heuristic is catching players rather than cheats.

---

## 3. Deploying

`.github/workflows/ci.yml`. The deploy job runs only on a push to `main`, only
after `verify`, `e2e`, `e2e-backend` and the restore drill pass, and in the
`production` GitHub environment so a required reviewer can be added without
editing the workflow.

Order, and it matters:

1. `npm ci --ignore-scripts` → `npm run build`
2. **`npx wrangler d1 migrations apply colors --remote`** — its own gated step
3. `npx wrangler deploy`
4. `curl /api/health` until it answers

> **D1 migrations are not applied by a deploy.** `wrangler deploy` ships the
> Worker and touches the database not at all. A schema change that is not applied
> in step 2 is a new Worker talking to the old schema — the classic D1 outage, and
> entirely self-inflicted.

**Migrations must be expand-only.** Step 2 runs before step 3, so the *old*
Worker meets the *new* schema for the length of a deploy — and indefinitely if
the deploy is rolled back. Adding tables or nullable columns is safe. Dropping or
narrowing anything has to be split across two deploys: expand, migrate the data,
deploy the code that stops using the old shape, then contract in a later
migration.

Locally: `npm run migrate:local` (miniflare's SQLite, no credentials).

### Running the real stack locally

`npm run dev` is Vite, which serves neither the Worker nor `public/_headers`.
Neither does `npm run e2e`. For anything touching the Worker, the headers or
`productionDeps`:

```sh
just serve            # = build, migrate the local D1, wrangler dev over HTTPS
just health           # 200 from /api/health and /api/health/deep
just smoke            # and it is actually usable: same-origin POST 201, cross-origin 403
```

`just` is a wrapper, never a second implementation — `npm run *` stays canonical
and CI never calls it (ADR 0019). `just` on its own lists every recipe.

That is the Worker + its `[assets]` + a local D1 + the static headers. It is the
only thing that catches a Worker which will not boot — the runtime forbids
randomness, timers and I/O at **global scope**, and every unit test passes anyway
because vitest runs on Node. See `history/README.md` § Environment traps.

`wrangler dev` logs `Parsed 1 valid header rule` on start-up when it has read
`dist/_headers`. That line is the only confirmation there is that the static
headers are being applied; its absence means `npm run build` has not run.

**Automated, and in CI:** `npm run e2e:backend`. It does the three commands above
for you — with a `d1:reset` that wipes `.wrangler/state/v3/d1` first, because
`migrations apply --local` is additive and a `players` table carried over from the
last run breaks the name claim — then starts Vite on 5174 proxying `/api` to it
and drives a real browser through start → submit → claim → board. That is the
only automated coverage `server/db/d1.ts` has, and the only place the identity
cookie is exercised end to end. No Cloudflare credentials, so it runs on every
pull request (`ci.yml` § `e2e-backend`).

> **The proxy uses `changeOrigin: false`, and that is load-bearing.** It leaves
> the `Host` header naming the Vite origin, so the Worker builds `request.url`
> from it and `isSameOrigin` compares the browser's `Origin` against the same
> value. Two origins instead and the host-only `SameSite=Strict` cookie stops
> being sent and every POST 403s — dev diverging from production precisely where
> it matters.

`e2e/replay-workerd.spec.ts` rides along on the same server to close ADR 0016's
fourth engine. It calls `/debug/replay-vectors`, which is inert unless
`DEBUG_REPLAY` is `"1"` — a value supplied by that Playwright config's
`wrangler dev --var DEBUG_REPLAY:1` and by nothing else. `wrangler.toml` must
never set it; `tests/debug-flag.node.test.ts` fails the build if it does.

> **`--var KEY:VALUE`, with a colon.** `wrangler pages dev` took
> `--binding KEY=VALUE`; `wrangler dev` does not, and it does not complain
> either — `--var DEBUG_REPLAY=1` defines a variable *named* `DEBUG_REPLAY=1`
> with an empty value, and the route it was meant to enable stays 404. Measured,
> not guessed.

### First-time setup — going live, start to finish

Nothing has ever run against a **remote** D1 (`BACKLOG.md` § 4.5) — the local one
is exercised on every push by `npm run e2e:backend`, which needs no credentials.

Ordered so that each step is verifiable before the next depends on it. Steps 1–3
need a human; the rest are commands.

**1. Accounts and the domain.** Register the domain, create a Cloudflare account,
and move the zone onto Cloudflare's nameservers. On Workers this is **required**,
not merely convenient: a Worker custom domain has to be a hostname in a zone on
your account. (Pages allowed third-party DNS via a CNAME; ADR 0022 gave that up
knowingly. The zone is already on Cloudflare, so it costs nothing here.)

**2. Grant the GitHub token the `workflow` scope.**

```sh
gh auth status                  # 'repo' alone is not enough
gh auth refresh -s workflow
```

Without it, the push that first creates `.github/workflows/*` is **rejected by
the server**, not by git — a confusing failure at the worst moment.

**3. Log wrangler in.**

```sh
npx wrangler login && npx wrangler whoami
```

**4. Create the database and record its id.**

```sh
npx wrangler d1 create colors   # paste database_id into wrangler.toml, and commit it
```

**5. Push the repo.** There is no remote until you make one.

```sh
gh repo create colors-game --private --source=. --remote=origin --push
```

**6. Repository `production` environment:** secrets `CLOUDFLARE_API_TOKEN`
(scopes: *Workers Scripts: Edit* and *D1: Edit*) and `CLOUDFLARE_ACCOUNT_ID`,
plus the `DEPLOY_URL` variable for the smoke step.

**7. Attach the custom domain.** Add the `routes` block to `wrangler.toml` — the
commented-out one at the top of the file — and deploy. Wrangler creates the
proxied DNS record in your zone and points it at this Worker.

```toml
routes = [
  { pattern = "colors.aaadataplumbing.com", custom_domain = true }
]
```

Doing it in the config file rather than the dashboard is the ADR 0019 argument
again: it is in the diff, and a redeploy cannot silently disagree with it.

Depth is not a problem. `colors.aaadataplumbing.com` is a **first-level
subdomain**, which free Universal SSL covers outright. (An earlier draft of this
page called it "four labels" — that was carried over from a different candidate
hostname, `colour.games.relativ.ist`, and was simply wrong here.)

> Note that the Pages-era reasoning printed here previously — that the certificate
> comes from Cloudflare for SaaS and so has no depth limit — **no longer applies**.
> A Workers custom domain is an ordinary proxied hostname in your zone and does
> use Universal SSL. The conclusion is unchanged for *this* hostname; a genuinely
> deeper name like `a.b.example.com` would now need Advanced Certificate Manager,
> where under Pages it would not have.

- Any **CAA records** on the zone must permit Cloudflare's CAs, or issuance fails
  silently and the domain never verifies.
- Nothing may block `/.well-known/acme-challenge/*`.

**8. Set `CANONICAL_HOST` on the deployed Worker** — **not in `wrangler.toml`**
(ADR 0021 and ADR 0022; a value there would also apply to `wrangler dev` and
redirect localhost into production).

```sh
npx wrangler secret put CANONICAL_HOST     # then type the hostname
npx wrangler secret list                   # confirm it is there
```

A "secret" for a public hostname is the mechanism, not a claim about the value:
it is the only store that lives on the deployed Worker, survives deploys, and is
invisible to `wrangler dev`. `tests/wrangler-config.node.test.ts` fails the build
if the name ever appears in the config file. Note that secrets are **not** applied
by `wrangler deploy` — set it once, after the first deploy, and it persists.

**9. Verify against the real thing**, not the dashboard:

```sh
curl -si https://colors.aaadataplumbing.com/api/health | head -1
curl -si https://colors.aaadataplumbing.com/ | grep -i strict-transport-security
```

There is no longer a second hostname to check the 308 against: `workers_dev =
false` means `colors-game.<subdomain>.workers.dev` does not answer at all
(ADR 0022), which is the point. The redirect is pinned by
`server/http/canonical.test.ts` and would fire the moment a second route is
added — which is now the only way to reach it.

Then play a full game and claim a name. `server/db/d1.ts` has only ever run
against a *local* D1; step 9 is the first time its SQL meets the real one.

**On HSTS:** the app sends its own header. Do **not** switch on zone-wide HSTS
with `includeSubDomains` at `aaadataplumbing.com` unless you mean it — it commits every
name under the zone, including unrelated siblings, to HTTPS-only, and it is
slow to undo.

---

## 4. Backups and restoring

ADR 0018. Time Travel is not a backup: 7 days on the free plan, restores
overwrite in place, and it lives in the account it protects.

- **Weekly** — `.github/workflows/backup.yml` writes a manifest from the live
  database, exports, restores the export into a scratch D1 and compares. Dump and
  manifest are kept 90 days as a private artifact.
- **Every push** — `npm run drill` runs the same script against
  `scripts/backup.fixture.sql`, with no Cloudflare credentials, so the drill
  cannot rot unnoticed.

### Restoring for real

```sh
# 1. Get the artifact from the backup workflow run you want.
# 2. Prove it before touching anything live — this is the same command CI runs.
node scripts/restore-drill.mjs --dump backup-2026-08-02.sql \
                              --manifest backup-2026-08-02.manifest.json

# 3. Only then, and only deliberately:
npx wrangler d1 execute colors --remote --file backup-2026-08-02.sql
```

Step 3 is destructive and there is no confirmation worth trusting: take a fresh
export first, or use Time Travel if the damage is under 7 days old, which is the
tool for that case.

The dump contains `players.token_hash` — hashes, not tokens (ADR 0016), so not a
pile of working logins, but keep the artifact private. The manifest holds only
counts and the public leaderboard, which is why it is a separate file.

### Health checks

- `GET /api/health` — **liveness only, never queries D1.** A probe that touched
  the database would make one D1 blip look like every edge location failing at
  once. This is what the deploy smokes and what an uptime monitor should poll.
- `GET /api/health/deep` — queries D1, answers 503 when it cannot. Hand-called.
  Do not point a monitor at it.

`just health [origin]` calls both; `just smoke [origin]` also proves the stack is
*usable* from that origin, which is a different question — see § 5.3.

---

## 5. Playing it on a real phone, over your tailnet

`BACKLOG.md` § 3.4 wants a physical device on the real backend: the loupe and the
take-off selection cannot be judged in an emulated viewport. The decision and the
rejected alternatives are ADR 0020; this is how you do it.

```sh
just serve            # terminal 1: the real stack, HTTPS, loopback only
just tailnet          # terminal 2: publish it — prints both URLs
just smoke "$(just tailnet-ip)"
just tailnet-off      # when you are done
```

`just watch` in a third terminal rebuilds `dist/` on save (~50ms); the phone only
has to reload. There is no HMR on this path, deliberately — it serves the built
bundle through wrangler, so `public/_headers` and the CSP are the real ones.

### 5.0 Two ways in, and which one to type into the phone

`just tailnet` publishes both, on two ports, against the same loopback wrangler.

| | `just tailnet-url` — by name | `just tailnet-ip` — by IP |
|---|---|---|
| Address | `https://<machine>.<tailnet>.ts.net:7443` | `https://100.x.y.z:7444` |
| Tailscale mode | `serve --https` (terminates TLS) | `serve --tcp` (forwards bytes) |
| Certificate | Tailscale's, trusted, no warning | wrangler's self-signed — **one tap-through** |
| Needs MagicDNS | **Yes** | No |
| Use it on | a laptop, or anything that resolves the name | **iOS**, where MagicDNS is unreliable |

**On iPhone, use the IP.** That is not a preference; the name-based path stops at
DNS on a device that will not resolve it, and the obvious repair — putting the IP
into the HTTPS entry — cannot work. An IP literal carries no SNI, Tailscale has
no name with which to pick a certificate, and the handshake is *aborted*
(`tlsv1 alert internal error`) rather than downgraded to a warning. The TCP
forward sidesteps the question by terminating no TLS at all.

Safari will say "This Connection Is Not Private": **Show Details → visit this
website**. Expected, once per device.

> **Use the IP on port 7444, never the name.** HSTS is not port-scoped, so a
> browser that has already loaded the app on `<name>:7443` will refuse the
> self-signed certificate on `<name>:7444` **with no way to click through** —
> removing that escape hatch is what HSTS is for. An HSTS header is ignored for
> an IP literal (RFC 6797 § 8.1.1), which is why the address keeps working.

### 5.1 Why HTTPS is not optional here

Two things fail *silently* over a plain-HTTP origin, and both of them look like
product bugs:

| What breaks | Why | Symptom |
|---|---|---|
| The identity cookie | It is `Secure` (`server/http/cookie.ts`). A browser treats `http://localhost` as a secure context and `http://192.168.1.20:5173` as an insecure one, so it discards the `Set-Cookie` | The game plays, the score posts, the name claim never sticks, no error anywhere |
| Every POST, PUT, DELETE | `isSameOrigin` compares `Origin` against `new URL(request.url).origin`, which is built from `Host`. Any hop with an opinion about `Host` breaks it | 403 `forbidden` on start, submit and claim |

So `just serve` runs wrangler with `--local-protocol https` and `just tailnet`
proxies to it with `https+insecure://`. Tailscale terminates TLS with a real
certificate for your MagicDNS name; wrangler's self-signed one is never seen by a
browser and never has to be trusted.

> **`wrangler dev` rewrites the incoming `Origin` header's scheme** to whatever
> its own listener speaks, so a plain-HTTP backend behind an HTTPS proxy passes
> the origin check *by accident*. `wrangler pages dev` did this too; ADR 0022
> re-measured it on `wrangler dev` and it is unchanged. Do not rely on it —
> `history/README.md` § Environment traps has both measurements.

### 5.2 Never `tailscale funnel`

Funnel is one word different from serve and publishes to the public internet.
What you would be publishing: a local D1 with real cookies in it, `/debug/*`
gated only by a binding, and no rate limiting worth the name. Serve reaches
devices already on your tailnet, which is exactly the right audience.

### 5.3 Checking it, and what a health check does not tell you

`just smoke <origin>` makes four assertions, and the last two are the ones worth
having:

| Assertion | What it catches |
|---|---|
| `GET /api/health` → 200 | The Worker booted |
| `GET /` → 200 | The `[assets]` binding is serving `dist/` |
| `POST /api/games` with a matching `Origin` → **201** | The origin check accepts the new hostname. This is what a new host breaks |
| `POST /api/games` with a foreign `Origin` → **403** | …and it is still actually checking |

A stack can pass liveness and still refuse to start a single game. That is the
whole reason this recipe exists.

### 5.4 What it costs you

- **HSTS follows the hostname, for two years.** `public/_headers` sends
  `Strict-Transport-Security: max-age=63072000; includeSubDomains`, and it is now
  coming from your own machine's tailnet name. HSTS is **not port-scoped**: any
  *other* service you serve from that same name over plain HTTP stops working in
  the browser you tested with. Symptom to recognise — a TLS failure in one
  browser while `curl` and other machines are fine. Remedy —
  `chrome://net-internals/#hsts`, Delete domain security policies. Avoidance —
  run the game from a machine whose tailnet name serves nothing else over HTTP.
  ADR 0020 records this as knowingly accepted.
- **The database is your laptop's local D1, and nothing wipes it.** Do not point
  `e2e/backend.spec.ts` at a long-lived `just serve`: it is written against a
  freshly reset database and will find two `Ada Lovelace` rows and fail on the
  ambiguity rather than on a defect. `npm run e2e:backend` brings up its own
  server for exactly this reason — and will fail to bind if `just serve` is
  already holding port 8788.
- **Two tailnet ports are consumed while serving** (`tailnet_port` 7443 and
  `tailnet_tcp_port` 7444). They cannot be merged: one terminates TLS and one
  does not. `just tailnet-status` lists what a node already serves; a collision
  otherwise presents as the wrong app answering.
- **`workerd` outlives its parent.** Closing the terminal running `just serve`,
  or killing wrangler by name, leaves the child holding port 8788 — and the next
  `just serve` fails with `Address already in use` and nothing pointing at the
  culprit. `just stop` clears it.

---

## 6. The retention sweep

ADR 0023. A Cron Trigger runs `server/sweep.ts` once a day; `wrangler.toml`:

```toml
[triggers]
crons = ["17 4 * * *"]
```

> **Delete that block and nothing fails.** The Worker deploys, every request is
> served correctly, and the sweep never runs — and the absence of a log line is
> indistinguishable from a sweep that had nothing to do. This is the same class
> of silent failure as `[observability]`, and it is guarded the same way:
> `tests/wrangler-config.node.test.ts` fails the build.

Daily is the right frequency, not a compromise: three of the four windows are
measured in days, so a more frequent run could not delete anything sooner. `04:17`
rather than `04:00` because cron schedules cluster on the hour and Cloudflare runs
triggers best-effort.

### 6.1 What it deletes

| Pass | Removes | Window | Why it is not somebody else's job |
|---|---|---|---|
| `games_expired` | `games` still `active` → `expired` | `GAME_TTL_MS`, 30 min | `games_sweep` indexed these from day one and nothing read it, so `expired` was an unreachable status |
| `mint_buckets_deleted` | `mint_buckets` rows for past days | previous day | **Privacy, not disk.** These are the only per-IP-derived rows in the system, and ADR 0015 justifies them partly on being short-lived |
| `client_errors_deleted` | `client_errors` past retention | 30 days | The write-side purge bounds new rows only; once reports stop, old ones stay forever |
| `orphan_players_deleted` | `players` with `games_played = 0` **and `name_key IS NULL`**, and their games | 7 days | ADR 0011. Such a player holds no name and no board position — so the `name_key` guard is what makes that true |
| `name_changes_deleted` | `name_changes_audit` rows past retention | 90 days | ADR 0031. The one swept table with a *subject* (`player_id`), so unlike the ADR 0014 counters it cannot be kept forever. Deleting a row loses forensic history only — never a name or a score |

Every pass is bounded by `SWEEP_BATCH_LIMIT` (500), takes the oldest rows first,
and reports its count. A capped pass is continued by the next run.

> **The orphan pass and a leaderboard reset interact.** The pass reaps
> `games_played = 0` rows, and its safety rests on those rows being nameless. A
> bulk `UPDATE players SET games_played = 0` — which the score-retune reset does
> (`migrations/0005`) — zeroes that column for *named* players too. The
> `name_key IS NULL` guard on the predicate is what stops the next sweep deleting
> them; do not remove it, and never write a reset that clears `games_played`
> without checking this pass still excludes the rows it clears.

**It does not release names.** ADR 0011 also asks for names idle over 12 months
to be freed; that is deliberately not built, and ADR 0023 § Why the name release
is not here has the reasoning and the precondition for changing it. Do not add it
without reading that section — the short version is that `last_seen_at` has never
been proven to move, and if it does not, the first run releases every name.

### 6.2 How to tell it ran

One wide event per run, `event: "retention_swept"`, and **it is emitted even when
nothing was deleted** — that is the whole point, since a stopped cron and an idle
one otherwise look identical.

```json
{"@timestamp":"2026-08-02T04:17:02.872Z","level":"info","severity_number":9,
 "message":"sweep removed 7 rows, 0 passes failed","service":"colors-api",
 "event":"retention_swept","duration_ms":9,"sweep.cron":"17 4 * * *",
 "sweep.rows":7,"sweep.games_expired":3,"sweep.mint_buckets_deleted":2,
 "sweep.client_errors_deleted":1,"sweep.orphan_players_deleted":1,
 "sweep.name_changes_deleted":0}
```

| Field | Read it as |
|---|---|
| no line at all in 24h | **The cron is not firing.** Check `[triggers]` survived the last deploy, and the Worker's Triggers tab |
| `sweep.rows: 0` every day | Normal for a quiet site. It ran; there was nothing to do |
| `sweep.capped` present | A pass hit its 500-row ceiling. Fine once (a backlog); on consecutive days raise `SWEEP_BATCH_LIMIT` |
| `level: "error"`, `sweep.failed` | Named passes threw; the others still ran. `sweep.error` carries the first message, truncated |
| `sweep.failed` naming all four | The D1 binding could not be built at all |

Retention on the log itself is **3 days** (ADR 0014), so this is a "did it run
lately" instrument, not a history. If a long-run record of what was deleted ever
matters, it belongs in a counter table, not here.

### 6.3 Running it by hand

`wrangler dev` never fires a schedule on the clock, however long you leave it.
There are two ways to invoke the handler, and it prints both on start-up now that
`[triggers]` exists:

```sh
npm run build && npm run d1:reset

npx wrangler dev --port 8790 --test-scheduled
curl "http://localhost:8790/__scheduled?cron=17+4+*+*+*"   # → "Ran scheduled event"

# or, with no flag at all:
npx wrangler dev --port 8790
curl "http://localhost:8790/cdn-cgi/local/scheduled"       # → "ok"
```

The `retention_swept` line appears in wrangler's output either way. **The second
form passes no cron**, so `sweep.cron` in the log line is the empty string —
recognise it as "invoked by hand" rather than as a bug.

Against the **deployed** Worker there is no equivalent: nothing triggers a
production cron on demand. The confirmation it ran is the log line, or the
Worker's Triggers tab.

### 6.4 Deleting one player by hand

The sweep only touches rows nobody wants (stale games, orphan identities). A
*named* player with scores it will never remove — that is deliberate (§ 6.1). So
when a specific name has to come off the board (a takedown, an abuse report, a
deletion request), that is a manual action. **There is no self-serve delete in
the app** (ADR 0025); this is the only path.

```sh
just delete-player           # the local database
just delete-player remote    # production — asks you to re-type the id first
```

It lists every player, hands the list to `fzf` to search and pick, and then
deletes the chosen player **and their games** — the same two-statement delete
`Repo.deletePlayer` does. `fzf` is the one prerequisite (`brew install fzf`);
`scripts/players-table.mjs` formats the rows.

It is a thin wrapper over what you could run yourself, which is the fallback if
`fzf` is not to hand — find the id, then:

```sh
npx wrangler d1 execute colors --remote --command \
  "DELETE FROM games WHERE player_id = <id>; DELETE FROM players WHERE id = <id>"
```

Deletion is not recoverable except from a backup (§ 4). Confirm the id against the
`name` and `best_score` the picker shows before you type it back.
