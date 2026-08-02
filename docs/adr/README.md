# Decision log

ADRs are **immutable once merged**. To change a decision, write a new ADR that
supersedes the old one and add a superseded banner to the old one's status line.
Never edit the body of a merged ADR — the reasoning that turned out to be wrong is
the most valuable thing in here.

## Index

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-no-ui-framework.md) | No UI framework; pure TypeScript + DOM | accepted |
| [0002](0002-functional-core-imperative-shell.md) | Functional core, imperative shell; injected time and randomness | accepted |
| [0003](0003-fast-check-for-property-tests.md) | fast-check for property tests | accepted |
| [0004](0004-perceptual-scoring.md) | CIEDE2000 + stretched-exponential score curve | accepted |
| [0005](0005-picker-geometry.md) | L×C plane at constant hue + hue slider | **superseded by 0007** |
| [0006](0006-afterimage-mask.md) | Dissolve through a neutral afterimage mask | **superseded by 0008** |
| [0007](0007-picker-shows-every-hue.md) | Picker plane shows every hue; lightness on a bar | accepted |
| [0008](0008-dissolve-straight-into-the-picker.md) | Dissolve goes straight into the picker | accepted |
| [0009](0009-score-screen-in-place-reticle.md) | Score screen keeps the picker in place with a target reticle | **superseded by 0010** |
| [0010](0010-result-in-a-persistent-side-panel.md) | Result lives in a persistent side panel; nothing shifts on reveal | accepted |
| [0011](0011-identity-is-a-first-party-cookie.md) | Identity is a server-issued first-party cookie; no fingerprinting | accepted |
| [0012](0012-tab-state-is-shell-state.md) | Tab state is shell state, not game state | accepted |
| [0013](0013-the-tab-bar-only-exists-between-games.md) | The tab bar only exists between games | accepted |
| [0014](0014-telemetry-is-aggregate-counters.md) | Telemetry is aggregate counters, not events | accepted |
| [0015](0015-anti-abuse-policy-for-ranked-play.md) | Anti-abuse policy: replay flags, plausibility bounds, mint buckets | accepted |
| [0016](0016-server-side-replay-on-workers.md) | Server re-scores by replaying the pure core; Pages Functions + D1 | accepted — **platform superseded in part by 0022** |
| [0017](0017-security-headers-and-a-strict-csp.md) | Security headers on every response; a CSP with no inline escape hatch | accepted |
| [0018](0018-backups-are-drilled-in-ci.md) | Backups are a weekly off-platform export, drilled in CI | accepted |
| [0019](0019-the-runbook-is-executable.md) | The runbook is executable: a justfile that wraps npm | accepted |
| [0020](0020-devices-reach-the-stack-over-tailscale-serve.md) | Devices reach the dev stack over Tailscale Serve, HTTPS only | accepted |
| [0021](0021-one-canonical-hostname.md) | One canonical hostname, enforced by the Worker with a 308 | accepted — **premise partly obsolete after 0022** |
| [0022](0022-workers-with-static-assets.md) | A Worker with static assets, not a Pages project | accepted |
| [0023](0023-retention-is-a-daily-cron-sweep.md) | Retention is a daily cron sweep, and it does not release names | accepted |
| [0024](0024-duplicate-display-names.md) | Display names are not unique; the board is ordered by (score, name, id) | accepted |
| [0025](0025-rename-in-app-delete-by-operator.md) | Rename in the app; deletion is an operator action, not self-serve | accepted — **revises 0011** |
| [0026](0026-mobile-phase-action-bar.md) | The phone screen is status · readout · picker · action bar | accepted |

## Already rejected — do not re-propose without new evidence

Each of these looks like an obvious improvement and is not. If you are about to
suggest one, read the linked ADR first; if you still think it's right, you need an
argument that engages with the reason it was rejected.

**When a later ADR overtakes a row here, strike the row through and say so in
place — do not delete it, and do not leave it standing.** A rejection that has
since been adopted is the most dangerous line in this file: it reads as current,
and it will make an agent refuse to build something that is already shipped. This
is the same repair `research/` uses for a superseded recommendation, and it is a
rule because this table has already failed that way once (the reveal-panel row).

| Idea | Why not | Where |
|------|---------|-------|
| Add React/Vue/Svelte/Lit | ~10 components, no lists, the one hard component is a canvas driven imperatively anyway | 0001 |
| Re-implement scoring or target generation on the server | Two implementations of CIEDE2000 will not agree to the last decimal, and the player sees the disagreement. The server replays the *same* pure functions | 0016 |
| A `rounds` table | Under seed replay every round's target, ΔE and score is derived. Only the guesses are irreducible | 0016 |
| An HTTP framework for the nine API routes | One `:param` segment and nine routes; `server/router.ts` is ~40 lines and zero dependencies | 0001, 0016 |
| Any runtime dependency | Bundle is ours. Zero runtime deps is a standing constraint; even a dev dep needs an ADR | 0001, CLAUDE.md |
| Browser fingerprinting to remember a player | 81.5% collision rate on a general-audience mobile population, 45.5% of fingerprints change within a day, and it is the *only* component that would need a consent banner. It fails hardest in exactly the cases the cookie already covers | 0011 |
| A recovery code, email, or passkeys for identity | Designed and cut. Losing a name is a shrug in a casual game; an email would make us a GDPR controller, and Windows synced passkeys are still "planned" | 0011 |
| Put the active tab in `GameState` (phase, field, or event) | A leaderboard is async and impure; it adds a row to the phase × event totality matrix in every phase for zero behaviour, and must opt out of the same-reference no-op contract | 0012 |
| Fetch targets from the server per round | Buys no anti-cheat — a bot echoes each target either way — and costs offline play plus 4× the D1 write volume | 0016 |
| Block the first frame on an identity or session request | Boot must await nothing. Identity starts unknown and renders nothing | 0011, 0012 |
| `window.confirm` for "forget me" | Blocks the rAF loop, is unstyleable, and is an ambient global the UI layer has no business touching. Two-click confirm instead | 0011 |
| Mirror the server's username rules on the client | The two drift, and the client starts rejecting names the server would accept. Client validates non-empty and max length; everything else is echoed back verbatim | 0011 |
| Make display names unique again (or keep the suffix ladder) | Uniqueness bought nothing here — a name is not a credential and the row is keyed by a cookie hash — and `ada-2` reads as the game overruling the player. Duplicates are fine; the board stays coherent because its order ends in `id`. Re-adding it means re-deriving that total order | 0024 |
| A "Forget me" / self-serve delete button in the app | It existed only as the erasure path and became the accidental rename tool — a player hit it to change their name and lost their scores. Renaming is now in-app and non-destructive; deletion is the rare operator action `just delete-player`. Bring self-serve delete back only as its own labelled action, never folded into rename | 0025 |
| A persistent tab bar visible during play | Mis-tap abandons a round the player has spent five seconds memorising, and nothing on the board is actionable mid-round. Note the *layout* argument for this is false — there is ~100px of slack | 0013 |
| A logging library (pino/winston) | Workers Logs already indexes `JSON.stringify` output; the library would wrap indexing the platform does | 0014 |
| Several log lines per request | The free plan gives ~2 log events per request against the Worker cap. One wide event is the budget, not a style choice — and `tests/logging.node.test.ts` allows `console` in exactly one file | 0014, `../OPERATIONS.md` |
| Logging the request path, or the headers, while debugging | The submit path contains the game id, which *is* the submit token; a header dump puts `Cookie` in the log store. Route pattern and an allow-list, both guarded by tests | 0014, 0017 |
| `X-XSS-Protection`, or `preload` on HSTS | The first is deprecated and its filter has itself been a vulnerability; the second takes months to get *out* of and reaches users on their own schedule | 0017 |
| Pointing an uptime monitor at a health check that queries D1 | One D1 blip then makes every edge location report unhealthy at once, and something takes out a Worker that is running fine. `/api/health` is liveness; `/api/health/deep` is hand-called | 0018 |
| Leaving a second free hostname live alongside the custom domain | It is not a second address, it is a second *site*: the identity cookie is host-only and the CSRF guard compares against the request's own URL, so visitors there get their own player rows and cannot claim the name they already own. On Pages this could not be switched off and needed the 308; on Workers `workers_dev = false` removes it, and the 308 stays as the guard for any *future* second hostname | 0021, 0022 |
| A Bulk Redirect rule instead of the canonical-host check | A dashboard setting is one somebody has to remember, does not appear in a diff, and cannot be tested. The property should travel with the thing it protects | 0021 |
| Buying Advanced Certificate Manager for a multi-level subdomain | `colors.aaadataplumbing.com` is a first-level subdomain, which free Universal SSL covers outright. (The Pages-era reasoning — that a Pages custom domain goes through Cloudflare for SaaS and gets a per-hostname certificate — no longer applies: a **Workers** custom domain is an ordinary proxied record in the zone and does use Universal SSL. The conclusion is unchanged for this hostname; a genuinely deeper name like `a.b.example.com` would now need ACM) | 0021, 0022, `../OPERATIONS.md` |
| Treating D1 Time Travel as the backup | 7 days on the free plan, restores overwrite in place, and it lives in the account it is protecting | 0018 |
| A quarterly manual restore drill | It will not happen. The SRE book's own words: it "becomes an unwelcome bit of drudgery that isn't performed either deeply or frequently enough to deserve your confidence" | 0018 |
| `zod` for request validation | Hand-rolled `unknown` narrowing already exists in `src/shared/decode.ts` and is shared by client and server | 0001, 0016 |
| Per-event telemetry rows keyed by player | Creates a subject-access and deletion obligation, and a table that grows with player count, to answer questions aggregates answer | 0014 |
| Rejecting a flagged submission, or telling the player it was flagged | It hands a cheat the test suite for their next attempt, and a false positive would be an accusation. Flagged games answer 200 and are simply excluded from `best_score` | 0015 |
| Trusting `memorizeMs` (or any elapsed time) from the submit body | It is the threshold the minimum-playtime check is built on: a body that could restate it cuts the required playtime from 43s to 18s. Both timestamps and the window come from the row | 0015 |
| `setTimeout` for the 5s memorize timer | Timer is domain logic; it lives in `reduce` and is tested with two timestamps | 0002 |
| CIE94 for scoring | Asymmetric: ΔE(a,b) ≠ ΔE(b,a). Neither colour is a "reference" in a game | 0004 |
| CAM16-UCS | Needs viewing-condition parameters a web page cannot know | 0004 |
| OKLab ΔE as a cheaper ΔE00 | No single scaling constant — the ratio swings 2.7× across the gamut | 0004 |
| OKHSV / OKHSL picker | Does not fix what it looks like it fixes: dead-axis area gets *worse* (HSV 24% → OKHSV 26% → OKHSL 29%), because the problem is topological, not colorimetric. (On the other measured column, unfairness ratio, OKHSL does beat HSV 3.5× vs 4.0× — the rejection rests on dead-axis area and, decisively, on 0007's searchability argument.) | 0005 → 0007 |
| L×C plane at constant hue | Flattest fairness, but the player cannot *find* the colour — hue is invisible | 0005 → 0007 |
| Neutral mask in the dissolve | Perceptually justified, but reads as a hitch at the moment that must feel continuous | 0006 → 0008 |
| Clamping RGB channels to fix out-of-gamut | Shifts hue by up to 69°. Reduce chroma at constant L and h instead | 0004, `src/color/gamut.ts` |
| ~~Reserving the reveal panel's height in the grid~~ **— REVERSED, this is now what we do.** | history/0001 rejected it (~300px does not fit on a 664px phone) and ADR 0010 **adopted** it: the result sits in slots "laid out all along", toggled with `visibility`. The original measurement assumed a separate preview *and* reveal; merging them removed the cost. The floating card, its `position: fixed` and `.game-result` are gone from `src/`. | 0010, history/0003 |
| Pixel-diff visual regression on the picker | GPU and font differences make it flaky across machines for no real defect signal | SPEC §9.5 |
| A LAN address (`http://192.168.x.y:5173`) for the real-device pass | The identity cookie is `Secure`, so a browser silently discards it on a non-localhost HTTP origin. The game plays, the name claim never sticks, and nothing reports an error — a defect manufactured by the harness | 0020 |
| `tailscale funnel`, ngrok or `cloudflared` for the same | All three work, and all three put a local D1, a binding-gated debug route and no real rate limiting on the public internet | 0020 |
| Serving the tailnet **IP** over `tailscale serve --https` | An IP literal carries no SNI, so the TLS terminator cannot pick a certificate and aborts the handshake. Not a warning you can tap through. A raw `serve --tcp` forward is what reaches an iPhone that will not resolve MagicDNS | 0020 |
| Binding wrangler to the tailnet IP so a phone can reach it directly | Moves the exposure decision out of one explicit command and into a `--ip` flag, and breaks `just health` and the name-based path, which both go via loopback | 0020 |
| Adding the tailnet hostname to Vite's `server.allowedHosts` | Puts one machine's hostname in a committed config, and buys HMR at the cost of the `_headers`/CSP fidelity that is the reason to test on the real stack at all | 0020 |
| Making `just` the entry point CI uses | A recipe would become the only way to run something, and a broken justfile could break a deploy. npm scripts stay canonical; recipes forward to them | 0019 |
| `run_worker_first = true` to restore the Pages routing order | Assets are matched before the Worker on Workers, which is already correct here — `/api/*` and `/debug/*` are not files in `dist/` and fall through. Setting it bills a Worker invocation for every image and stylesheet to reproduce behaviour we already have | 0022 |
| `[env.production]` for `CANONICAL_HOST` | Workers environments do not inherit non-inheritable keys: the block would have to redeclare every `[[d1_databases]]` entry or production deploys with **no D1 binding**, and `--env production` renames the Worker unless `name` is redeclared too. `wrangler secret put` has neither failure mode | 0022, 0021 |
| A second Worker beside the Pages project, just for the cron | Two deploy artefacts for one application, two D1 bindings, and one copy of `server/db/d1.ts` per artefact that a schema change has to land in twice | 0022 |
| A probabilistic retention purge on write (a small chance per submission of also deleting expired rows) | Proposed during scaffolding and never written. It does no work when nobody is playing, which is exactly when rows accumulate unread, and its cost lands on a player's request. The cron is the whole reason ADR 0022 exists | 0022, 0023 |
| Releasing player names idle over 12 months, now | ADR 0011 asks for it and it is **deliberately not built**. `last_seen_at` moves only via `touchPlayer`, which runs inside `waitUntil` and has never been proven to write against a real D1 — if it silently fails, every name in the database is released on the first run. Deleting a real player's name is not recoverable. The `games_played = 0` half *is* built | 0023, 0011 |
| An unbounded `DELETE` in a scheduled job | The tables have grown unattended for months; the first run after a backlog is the one that takes out the database. Every pass carries a `LIMIT`, takes the oldest rows first, and reports its count | 0023 |

## Open tensions we are knowingly carrying

- **The afterimage bias is real and unmitigated** (0006 → 0008). Five seconds of
  fixation biases the guess away from the target hue, invisibly. If scores ever
  show a systematic hue-opponent skew, 0006 is the first place to look.
  ADR 0014 specified the instrument and **it now exists**: `round_stats.hue_bucket`
  is written from the submit handler, and the query that reads it — opponent hues
  are bucket pairs six apart — is `../OPERATIONS.md` § 2.3. Nothing has been
  measured yet; there is simply now something to measure.
- **Hue precision is now bounded by plane width** (0007). Fine on desktop and a
  modern phone; would degrade on a very narrow viewport.
- **Repaint budget is missed** — 11ms against a 4ms target, on lightness change
  only. See `../BACKLOG.md`.
