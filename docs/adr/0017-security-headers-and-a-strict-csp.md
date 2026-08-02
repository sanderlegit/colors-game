# 0017 — Security headers, and a CSP with no inline escape hatch

Date: 2026-08-02 · Status: accepted

## Context

The app ships as a static bundle on Pages with an API on the same origin. It has
no third-party script, no analytics tag, no font CDN, no embedded content, and
no user-generated HTML — the one string a player supplies is a display name, and
it is rendered as text. That is an unusually small attack surface, and it is
exactly the moment to lock it down: every directive below is free today and
expensive to add once something depends on being allowed.

Two facts shape the decision. Pages applies `public/_headers` to the *static*
responses it serves and **not** to Pages Functions responses, so any policy has
to exist in two places. And a CSP does not fail loudly: get `connect-src` wrong
and the board and the error beacon simply stop working, in production, for the
people who visited.

## Decision

Every response — static and API — carries:

```
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self';
  img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none';
  frame-ancestors 'none'; form-action 'self'
Strict-Transport-Security: max-age=63072000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=(), usb=()
```

Four choices inside that are deliberate rather than default:

1. **`default-src 'none'` first**, so a directive nobody thought to add is a
   refusal rather than an allowance. Everything after it is an opening, which
   makes the policy readable as a list of what this app actually does.
2. **No `'unsafe-inline'`, no nonce, no hash.** There is no inline `<script>` and
   no inline `style` attribute. Colour goes through the `--fill-color` custom
   property via the CSSOM, which CSP does not govern at all — note the trap:
   `element.setAttribute("style", …)` *is* governed and would be blocked.
3. **No `preload` on HSTS.** Two years of `max-age` is a commitment we can keep;
   the preload list takes months to get out of and reaches users on their own
   schedule. Adding it later is one word. Removing it is not.
4. **Neither `X-XSS-Protection` nor `X-Frame-Options`.** The first is deprecated
   and its filter has been a vulnerability in its own right; the second is
   superseded by `frame-ancestors`, which browsers actually consult.

The Worker's copy is applied in `server/app.ts`, not per handler — the same
reasoning as the CSRF check. The 404s, the 405s and the 500s are exactly the
responses no handler owns and exactly where a per-handler approach leaks.

## Consequences

- **The app can never gain an inline script or an inline style attribute without
  changing this ADR.** `tests/csp.node.test.ts` fails the build on either, and on
  a `@font-face`, an `@import` or an absolute `url()` in the CSS — all three are
  refused by `default-src 'none'`.
- **The two copies cannot drift.** The same test parses the directive list out of
  `server/http/security.ts` and out of `public/_headers` and compares them.
  Without it, "change one, change the other" is a comment.
- **`connect-src 'self'` is the one that would hurt.** It gates every call in
  `src/platform/api.ts` and the beacon in `src/platform/errors.ts`. Both are
  same-origin today; a future third-party endpoint is a code change *and* a
  policy change, and forgetting the second half fails silently.
- The picker's canvas needs no directive — it is an in-memory JS API under
  `script-src`. This is worth writing down because it looks like it should.
- `Permissions-Policy` denies five features the game does not use. It is not
  defence in depth so much as a statement: if a future change wants the camera,
  it has to say so here first.
- Adding a Cloudflare Web Analytics beacon, a Sentry SDK, or any hosted script
  now requires editing this policy in two files and updating this ADR. That is
  the intended cost.
