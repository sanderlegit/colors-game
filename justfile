# The runbook, executable. `just` with no arguments lists everything.
#
# **`npm run *` stays canonical.** CI calls npm and never this file, so a recipe
# cannot drift into being the only way to run something (ADR 0019). Anything here
# that is not a one-line forward is a sequence a `package.json` script cannot
# express: bring the stack up, put it on the tailnet, take it down again.
#
#   just check      typecheck → lint → unit tests → build. Nothing is done until this passes.
#   just serve      the real stack: the Worker + a local D1 + the static headers
#   just tailnet    publish that stack to your tailnet, over HTTPS, for a phone
#
# Prose: docs/OPERATIONS.md § 3 (locally) and § 5 (on your tailnet).
#
# Recipes whose one-line summary would be a lie carry a `[doc(…)]` for the list
# and keep the reasoning in the comment above them.

# `wrangler dev` listens here, on loopback only. Nothing reaches it from another
# machine until `just tailnet` says so.
api_port := "8788"

# The tailnet HTTPS port, reached by MagicDNS name with a real certificate.
# Yours may already be serving something on it — `just tailnet-status` lists what
# is taken.
tailnet_port := "7443"

# The second way in: a raw TCP forward, reachable by tailnet *IP*, because
# MagicDNS resolution is unreliable on iOS. It cannot share a port with the above
# — one terminates TLS and one does not (ADR 0020).
tailnet_tcp_port := "7444"

_default:
    @just --list --unsorted

# ─────────────────────────────────────────────────────────────── verifying ────

# The one command: typecheck → lint → unit tests → build.
check:
    npm run verify

# Unit tests. `just test --watch`, `just test src/color` — arguments reach vitest.
test *args:
    npx vitest run {{ args }}

# Coverage, with the 90% floor on src/color/** and src/domain/** enforced.
cov:
    npm run test:cov

# Biome, in check mode.
lint:
    npm run lint

# Biome owns formatting. Never hand-format.
fix:
    npm run lint:fix

# Playwright, Desktop Chrome + iPhone 14, with /api stubbed in the browser.
e2e *args:
    npm run e2e -- {{ args }}

# Playwright against a real Worker and a real local D1. It resets the database
# before migrating — deliberately, because `migrations apply --local` is additive
# and a `players` row carried over from the last run breaks the name claim.
[doc("Playwright against a real Worker and a real local D1. Wipes the local database.")]
e2e-backend *args:
    npm run e2e:backend -- {{ args }}

# The restore drill against the committed fixture. No Cloudflare credentials.
drill:
    npm run drill

# ─────────────────────────────────────────────────────────────── the stack ────

# Typecheck and bundle into dist/.
build:
    npm run build

# Pair with `just serve` in another terminal. The build is ~50ms and wrangler
# serves dist/ as it finds it, so a phone only has to reload — this is the
# substitute for the HMR the tailnet path gives up.
[doc("Rebuild dist/ on every save.")]
watch:
    npx vite build --watch

# Vite alone: LAN-visible, fast, and serving neither the Worker nor
# public/_headers, so /api goes nowhere. The loop for pure UI work.
[doc("Vite alone, no backend. The fast loop for pure UI work.")]
dev:
    npm run dev

# Apply pending migrations to the local D1. Additive — it never drops anything.
migrate:
    npm run migrate:local

# A clean slate when a local run has left rows that confuse the next one.
[doc("Wipe the local D1 and re-migrate it.")]
reset:
    npm run d1:reset

# The one way a player comes off the board: there is no self-serve delete in the
# app (ADR 0025), so removing a name is an operator action. Lists players,
# fzf-picks one, and deletes them and their games from D1 — the same two-statement
# shape `Repo.deletePlayer` uses. Defaults to the local database; pass `remote`
# for production, which still makes you re-type the id first.
[doc("fzf-pick a player and delete them (and their games) from D1. Pass `remote` for production.")]
delete-player env="local":
    #!/usr/bin/env bash
    set -euo pipefail
    command -v fzf >/dev/null || { echo "fzf is not installed (e.g. brew install fzf)"; exit 1; }

    rows="$(npx wrangler d1 execute colors --{{ env }} --json --command \
      'SELECT id, name, best_score, games_played, created_at FROM players ORDER BY id')"

    pick="$(printf '%s' "$rows" | node scripts/players-table.mjs \
      | fzf --prompt='delete > ' \
            --header=$'    id  score games  created     name\n(enter to select, esc to cancel)')" \
      || { echo "cancelled"; exit 0; }

    id="$(printf '%s' "$pick" | awk '{print $1}')"
    [[ "$id" =~ ^[0-9]+$ ]] || { echo "could not read an id from the selection"; exit 1; }

    printf 'About to delete player %s and all their games from the %s database.\n' "$id" "{{ env }}"
    read -r -p "Re-type the id to confirm: " confirm
    [ "$confirm" = "$id" ] || { echo "id did not match; nothing deleted"; exit 1; }

    npx wrangler d1 execute colors --{{ env }} --command \
      "DELETE FROM games WHERE player_id = $id; DELETE FROM players WHERE id = $id"
    echo "deleted player $id"

# HTTPS on loopback, because `just tailnet` needs it and a dev/tailnet split in
# the one place origins matter is something you find out about too late
# (ADR 0020). wrangler generates its own self-signed certificate: nothing to
# install and nothing to trust, since the browser only ever sees Tailscale's.
[doc("The real stack: the Worker, its static assets, a local D1 and public/_headers, over HTTPS.")]
serve: build migrate
    npx wrangler dev --port {{ api_port }} --ip 127.0.0.1 --local-protocol https

# ────────────────────────────────────────────────────────────── the tailnet ────

# Publishes **two** ways in, because MagicDNS is unreliable on iOS and the
# name-based one is useless on a device that cannot resolve the name:
#
#   :7443  HTTPS, by MagicDNS name. Tailscale terminates TLS with a real
#          certificate — no warnings, and the address bar is readable.
#   :7444  a raw TCP forward, by tailnet IP. Tailscale cannot select a
#          certificate for an IP (no SNI), so it does not try: the TLS the phone
#          sees is wrangler's own self-signed certificate, which means one
#          tap-through warning and no dependence on DNS at all.
#
# Both proxy to the same loopback wrangler, so nothing is bound to a network
# interface and this outlives `just serve` — the proxy is attached to the port,
# not to the process. Idempotent.
[doc("Publish the running stack to your tailnet, by name and by IP.")]
tailnet:
    #!/usr/bin/env bash
    set -euo pipefail
    ip_url="$(node scripts/tailnet-url.mjs --ip --port {{ tailnet_tcp_port }})"
    tailscale serve --bg --tcp={{ tailnet_tcp_port }} tcp://127.0.0.1:{{ api_port }} >/dev/null

    # The name half is best-effort: a node without MagicDNS still gets the IP.
    if name_url="$(node scripts/tailnet-url.mjs --port {{ tailnet_port }} 2>/dev/null)"; then
      tailscale serve --bg --https={{ tailnet_port }} https+insecure://127.0.0.1:{{ api_port }} >/dev/null
      printf '%-46s %s\n' "$name_url" "by name — trusted certificate"
    fi
    printf '%-46s %s\n' "$ip_url" "by IP — accept the warning once (iOS)"
    echo
    echo "Your tailnet only. Never 'tailscale funnel' this — see ADR 0020."
    echo "Check it:  just smoke \"$ip_url\""
    echo "Stop it:   just tailnet-off"

# Removes both the HTTPS and the TCP entry, and leaves every other serve entry on
# this node alone. Either may already be off; that is not an error.
[doc("Take it off the tailnet.")]
tailnet-off:
    -tailscale serve --https={{ tailnet_port }} off
    -tailscale serve --tcp={{ tailnet_tcp_port }} off

# Everything this node serves, so you can see what a port collides with.
tailnet-status:
    @tailscale serve status

# The by-name URL `just tailnet` would publish at, without publishing anything.
tailnet-url:
    @node scripts/tailnet-url.mjs --port {{ tailnet_port }}

# The by-IP URL. The one to use from iOS, where MagicDNS is unreliable.
tailnet-ip:
    @node scripts/tailnet-url.mjs --ip --port {{ tailnet_tcp_port }}

# Kill a wrangler that outlived its terminal. `workerd` is a child process and
# survives killing the parent, so the next `just serve` fails with
# "Address already in use" and no clue as to what is holding the port.
[doc("Free the API port from a stranded wrangler/workerd.")]
stop:
    -pkill -f 'wrangler dev'
    -pkill -f workerd

# ────────────────────────────────────────────────────────────── checking it ────

# Defaults to the local stack; pass an origin to probe the tailnet one:
#
#   just health "$(just tailnet-url)"
#
# `-k` because the loopback listener's certificate is self-signed. Over the
# tailnet the certificate is real and the flag then hides nothing worth seeing.
[doc("Liveness, then the deep check that queries D1.")]
health base=("https://127.0.0.1:" + api_port):
    #!/usr/bin/env bash
    set -uo pipefail
    for path in /api/health /api/health/deep; do
      code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 "{{ base }}$path" || echo '---')"
      printf '%s  %s\n' "$code" "{{ base }}$path"
    done

# The interesting assertions are the last two. Every state-changing endpoint sits
# behind a same-origin check, and putting the app on a new hostname is exactly
# what breaks it — so a smoke test that only GETs /api/health passes happily on a
# stack where nobody can start a game. Mints one game row in the local D1.
[doc("Prove the stack is usable from an origin, not merely up.")]
smoke base=("https://127.0.0.1:" + api_port):
    #!/usr/bin/env bash
    set -uo pipefail
    fail=0
    probe() { curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "$@" || echo '---'; }

    code="$(probe "{{ base }}/api/health")"
    [ "$code" = "200" ] || { echo "FAIL  liveness: got $code"; fail=1; }

    code="$(probe "{{ base }}/")"
    [ "$code" = "200" ] || { echo "FAIL  the app itself: got $code"; fail=1; }

    code="$(probe -X POST "{{ base }}/api/games" -H 'content-type: application/json' \
      -H 'Origin: {{ base }}' -d '{"memorizeMs":5000}')"
    [ "$code" = "201" ] || { echo "FAIL  same-origin POST from {{ base }}: got $code"; fail=1; }

    code="$(probe -X POST "{{ base }}/api/games" -H 'content-type: application/json' \
      -H 'Origin: https://not-this-site.example' -d '{"memorizeMs":5000}')"
    [ "$code" = "403" ] || { echo "FAIL  cross-origin POST should be 403: got $code"; fail=1; }

    [ "$fail" = "0" ] && echo "ok    {{ base }}"
    exit "$fail"
