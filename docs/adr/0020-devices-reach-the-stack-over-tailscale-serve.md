# 0020 — Devices reach the dev stack over Tailscale Serve, and only over HTTPS

Date: 2026-08-02 · Status: accepted

## Context

`BACKLOG.md` § 3.4 has been open since the first build: the loupe and the
take-off selection cannot be validated in an emulated viewport, so at some point
a real phone has to play a real game against a real backend. `vite.config.ts`
already binds on all interfaces for this, which suggests the answer is a LAN
address and a port.

It is not, for two reasons that both fail *silently* — which is the worst
possible property for a harness whose whole job is to expose bugs.

**The identity cookie is `Secure`** (`server/http/cookie.ts`). Browsers treat
`http://localhost` as a secure context but `http://192.168.1.20:5173` as an
insecure one, so over a LAN address the browser accepts the page, plays the game,
posts the score — and discards the `Set-Cookie`. The name claim then never
sticks, the board never says `isYou`, and nothing anywhere reports an error. A
real-device pass would be reporting a defect manufactured by its own transport.

**The same-origin check compares against the request's own URL.**
`isSameOrigin` in `server/http/origin.ts` is `origin === new URL(request.url).origin`,
and `request.url` is built from the `Host` header. Any hop that rewrites `Host`
turns every state-changing request into a 403 — the reason `changeOrigin: false`
is load-bearing in `vite.config.ts`. A tunnel is one more hop with an opinion
about `Host`.

Three transports were considered. A LAN address fails the first constraint. A
public tunnel (ngrok, `cloudflared`, `tailscale funnel`) satisfies it, and puts a
stack with a local database, a debug route gated only by a binding, and no
meaningful rate limiting on the public internet. Tailscale Serve satisfies it
without leaving the tailnet.

There is a fourth constraint, and it only shows up on the device: **MagicDNS
resolution is unreliable on iOS.** A transport that depends on the phone
resolving `<machine>.<tailnet>.ts.net` is a transport that intermittently is not
there, and the fallback everyone reaches for — the tailnet IP — cannot be served
over `tailscale serve --https`. An IP literal carries no SNI, so Tailscale's TLS
terminator has no name with which to select a certificate and **aborts the
handshake**: `tlsv1 alert internal error`, not a warning a phone can tap through.

## Decision

**`tailscale serve` over HTTPS, pointed at `wrangler pages dev --local-protocol https`.
Never `tailscale funnel`. Publish a second, address-based way in beside it.**

- **Serve, not Funnel.** The audience is devices already on the tailnet, which is
  exactly the set of devices that should be able to reach a development database.
  Funnel is one word different and publishes to the internet; that is why the
  recipe prints a line saying so.
- **The Worker speaks HTTPS too**, so both halves of the origin comparison agree
  on the scheme without depending on anything undocumented. `wrangler pages dev`
  does today rewrite the incoming `Origin` header's scheme to its own listener's
  protocol (`history/0010`), which would make a plain-HTTP backend work by
  accident. Working by accident is not a property to build a harness on. wrangler
  generates its own self-signed certificate and Tailscale is told to skip
  verifying it (`https+insecure://`); the browser only ever sees Tailscale's real
  certificate.
- **wrangler binds `127.0.0.1`.** Reachability is the explicit `just tailnet`
  step and never a side effect of a `--host` flag, so "who can reach this" has
  exactly one answer and it is in one place.
- **The tailnet serves the built bundle through wrangler, not Vite.** That is the
  production-shaped stack — real `public/_headers`, real CSP, the real bundle —
  and it is the half a phone can tell you something about. It gives up HMR;
  `just watch` is a ~50ms rebuild and a reload instead. It also avoids adding the
  tailnet hostname to `server.allowedHosts`, which is what Vite would need and
  which would put one machine's hostname in a committed config.
- **The hostname is never committed.** `scripts/tailnet-url.mjs` reads
  `Self.DNSName` from `tailscale status --json` — the name the certificate is
  issued for, and the only spelling a browser accepts without a warning.

### The second way in: by IP, over a TCP forward

`just tailnet` also publishes `tailscale serve --tcp=<port> tcp://127.0.0.1:<api>`,
reachable at `https://<tailnet-ip>:<port>`.

A **raw TCP forward**, not a second HTTPS handler, and that distinction is the
whole design. Tailscale forwards bytes and terminates nothing, so no certificate
has to be selected and **no SNI is required** — which is exactly what the IP path
could not satisfy. The TLS the phone negotiates is wrangler's own self-signed
certificate (`CN=localhost`), so the browser shows a warning and the user taps
through once. That is acceptable *here* and would not be anywhere else: the
alternative is not "a trusted certificate", it is "no access from an iPhone".

Both entries proxy to the same loopback wrangler, so this adds a port and changes
nothing about what is bound to a network interface. Binding wrangler to the
tailnet IP directly was the other option and was rejected: it moves the exposure
decision from one explicit command into a `--ip` flag, and it breaks
`just health` and `just tailnet` on loopback.

**Use the IP, not the name, on the TCP port.** HSTS is not port-scoped, so once
a browser has seen the app on `<name>:7443` it will refuse the self-signed
certificate on `<name>:7444` *with no way to click through* — HSTS's stated
purpose is to remove that escape hatch. RFC 6797 § 8.1.1 requires a UA to ignore
an HSTS header whose host is an IP literal, which is what keeps the address-based
path working on the second visit.

## Consequences

- **This teaches your browser HSTS for your own machine's tailnet name, for two
  years.** `public/_headers` sends `Strict-Transport-Security: max-age=63072000;
  includeSubDomains`, correctly, and it is now sent from
  `<machine>.<tailnet>.ts.net`. **HSTS is not port-scoped.** Any *other* service
  you serve from that same host name over plain HTTP — a different port is not a
  different host — becomes unreachable in that browser until the entry expires.
  This is accepted, not overlooked: the alternative is stripping a production
  security header in the one environment built to check production behaviour.
  **How you would detect it:** a service on the same tailnet name that fails with
  a TLS error in the browser you tested from and works fine under `curl`, on
  another machine, or via the short MagicDNS name. The remedy is to delete the
  entry at `chrome://net-internals/#hsts`, and the avoidance is to serve the game
  from a machine whose tailnet name hosts nothing else over plain HTTP.
- **"It is up" and "it is usable from this origin" are different claims**, and
  only the second one is interesting here, because a new hostname is precisely
  what breaks an origin check. `just smoke` asserts a same-origin POST returns
  201 *and* a cross-origin POST returns 403; a health check alone passes happily
  on a stack where nobody can start a game.
- **The real database is on your laptop**, so a phone playing over the tailnet
  writes to the same local D1 as `just serve`. It is not wiped between runs, which
  means `e2e/backend.spec.ts` — written against a freshly reset database — should
  not be pointed at a long-lived `just serve`; it will find two `Ada Lovelace`
  rows and fail on the ambiguity rather than on a defect.
- **Nothing here is required to develop the game.** Without Tailscale, `just serve`
  is the local stack and everything else is unchanged.
- **Two ports on the node are consumed while serving** (`tailnet_port` 7443 and
  `tailnet_tcp_port` 7444 in the `justfile`). They cannot be one port: the two
  entries differ in whether Tailscale terminates TLS. `just tailnet-status`
  shows what a node already serves, because a collision otherwise presents as
  the wrong app answering.
- **The by-IP path shows a certificate warning every time the exception is
  cleared**, and it is the path most likely to be used, so the warning is not an
  edge case — it is the normal first screen on a new device. `just tailnet`
  prints it as expected rather than leaving it to look like a fault.
- **The `Secure` cookie survives a tapped-through certificate**, which is the
  claim the whole IP path rests on. Verified, not assumed: `e2e/backend.spec.ts`
  against `https://<tailnet-ip>:7444` with `ignoreHTTPSErrors` — the automated
  equivalent of the tap — plays a full game, claims a name and gets its own row
  back marked `isYou`. None of that is reachable without the cookie.
