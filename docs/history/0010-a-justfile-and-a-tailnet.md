# 0010 — A justfile, and the stack on a tailnet

2026-08-02

Task: document and script serving and checking the server, plus a
Tailscale-reachable setup. Outcome: a `justfile` (ADR 0019), `just tailnet` over
Tailscale Serve (ADR 0020), `scripts/tailnet-url.mjs`, and `OPERATIONS.md` § 5.

Nothing in `src/` or `server/` changed. Every finding below came from probing the
running stack, because none of it is visible in the code.

## The cookie decides the transport

The obvious answer to "play it on a phone" is the LAN address `vite.config.ts`
already binds for. It does not work, and it fails in the worst possible way: the
identity cookie is `Secure`, browsers treat `http://localhost` as a secure
context but a LAN IP as an insecure one, so the browser plays the whole game and
throws the `Set-Cookie` away. The name claim never sticks and nothing reports an
error. A real-device pass would have spent an afternoon on a defect
manufactured by its own harness.

That single attribute is what forced HTTPS, which forced Tailscale Serve, which
is most of ADR 0020.

## `wrangler pages dev` rewrites the `Origin` header

Chasing the second constraint — `isSameOrigin` compares `Origin` against
`new URL(request.url).origin` — produced a result that made no sense: through
`wrangler pages dev`, **both** `http://` and `https://` spellings of the right
host passed, while a wrong host and a wrong port were correctly refused. The
function is scheme-sensitive; a one-off vitest against it confirmed that in
isolation.

A throwaway Pages Function echoing `context.request.url` and the headers settled
it. Sending `Origin: https://example.test:1234` to a listener on `http` gets the
Worker `Origin: http://example.test:1234`. **wrangler's dev proxy rewrites the
scheme of the incoming `Origin` to its own listener's protocol.**

Two consequences:

1. A plain-HTTP wrangler behind an HTTPS proxy passes the origin check *by
   accident*. It was tested end to end and it works. `just serve` runs
   `--local-protocol https` anyway, so both halves of the comparison agree
   without depending on undocumented proxy behaviour.
2. **You cannot test the origin guard's scheme handling through
   `wrangler pages dev`.** It is unit-tested in `server/http/origin.test.ts`, and
   that is now the only place it is real.

## Tailscale Serve preserves `Host`, including the port

The load-bearing assumption of the whole setup, and it holds:
`tailscale serve --https=7443 https+insecure://127.0.0.1:8788` leaves `Host` as
`enge.tempel-lungfish.ts.net:7443`, so the Worker builds the same origin the
browser used. `https+insecure://` is what lets it proxy to wrangler's self-signed
certificate without a flag on the browser side.

Verified with the real thing rather than by assertion: `e2e/backend.spec.ts`
against the tailnet URL at the iPhone 14 viewport played a full game, submitted
it, and **claimed a name** — which only works if the `Secure` cookie was set and
came back. (It then failed on the leaderboard assertion, because the local D1 had
an `Ada Lovelace` row from an earlier run and the row locator matched two
elements. The spec assumes the reset its own config performs; ADR 0020 and
`OPERATIONS.md` § 5.4 record not to point it at a long-lived `just serve`.)

## MagicDNS is unreliable on iOS, and the obvious repair does not work

Reported from the device, after the above was written: the name-based path is no
good on an iPhone, because the phone does not reliably resolve the MagicDNS name.
The natural fix — hit the tailnet IP instead — fails, and fails in a way worth
recording because it looks like it should be a certificate warning:

```
* Connected to 100.111.185.11 port 7443
* TLS handshake, Client hello (1):
* tlsv1 alert internal error
```

An IP literal cannot appear in SNI, so Tailscale's TLS terminator has no name
with which to select a certificate and **aborts the handshake**. There is nothing
to tap through. The same is true of `--tls-terminated-tcp`.

What works is a **raw TCP forward** — `tailscale serve --tcp=7444
tcp://127.0.0.1:8788` — which terminates no TLS and therefore needs no name. The
phone then negotiates TLS with *wrangler's* self-signed certificate
(`CN=localhost`), gets one warning, taps through, and everything works. wrangler
stays on loopback; nothing is bound to a network interface.

Binding wrangler to the tailnet IP directly was the other candidate. Rejected:
it moves the exposure decision out of an explicit command and into a `--ip` flag,
and it breaks `just health` and the name-based path, which both go via loopback.

The claim the whole path rests on — that a `Secure` cookie survives a
tapped-through certificate — was verified rather than reasoned about:
`e2e/backend.spec.ts` against `https://100.111.185.11:7444` with
`ignoreHTTPSErrors: true` (the automated equivalent of the tap) played a full
game, claimed a name and got its own row back marked `isYou`, on a freshly reset
D1. **1 passed.**

One trap that follows from it: HSTS is not port-scoped, so a browser that has
loaded the app from `<name>:7443` will refuse the self-signed certificate on
`<name>:7444` with no click-through available. Use the *IP* on the TCP port —
RFC 6797 § 8.1.1 requires an HSTS header to be ignored for an IP literal, which
is exactly what keeps that path usable.

## Vite refuses a foreign `Host`

`server.host: true` is not enough to reach Vite by hostname. Vite 8 answers
`Blocked request. This host (…) is not allowed.` for anything not localhost or a
bare IP, and there is no CLI flag — it wants `server.allowedHosts` in the config.
That would have put one machine's hostname in a committed file, and was one of
two reasons the tailnet path serves the built bundle through wrangler instead.
The other is better: through wrangler you get the real `public/_headers` and the
real CSP, which is the half of the stack a phone can actually tell you about.

## Smaller things

- `just --list` shows only the **last** line of a multi-line comment block, which
  silently turns a good description into a sentence fragment. Recipes whose
  comment is a paragraph carry an explicit `[doc("…")]` attribute.
- `just` parses `base="x" + var:` as two parameters. Defaults built from an
  expression need parentheses: `base=("x" + var)`.
- HSTS is not port-scoped, so serving the app from a machine's tailnet name makes
  *every* plain-HTTP service on that name unreachable in that browser for two
  years. Accepted with a detection story in ADR 0020 rather than by stripping a
  production header in the environment that exists to check production behaviour.
- `workerd` survives `pkill -f "wrangler pages dev"`: it is a child process, and
  it keeps port 8788. The next `just serve` then fails with `Address already in
  use` and no indication of what is holding it. `just stop` exists for this.
