# 0030 — `player.key` is peppered per deploy, not per isolate

Status: accepted — **revises the per-isolate trade in 0015**

## Context

Every wide request event carries `player.key`: the first 12 hex of
`SHA-256(token ‖ pepper)` (`server/log.ts` `playerKey`), the only handle in the
log store for "the same person, across requests". Until now the pepper was minted
per **isolate** (`makeLogPepper`), a property inherited from the mint salt's
reasoning (ADR 0015): non-reversible, and deliberately narrow so a key means
nothing outside the log store.

That narrowness has a cost we just paid. A bug where one device renamed itself
repeatedly was impossible to reconstruct from logs partly because `player.key`
was **not stable**: two requests served by different isolates — the normal case
across even a few minutes — carried different keys for the same person. The one
field whose job is "follow this player" could not.

## Decision

Pepper `player.key` with a **deploy-scoped secret**, `LOG_PEPPER`, read from
`env` (`server/env.d.ts`), set with `wrangler secret put LOG_PEPPER` and kept out
of `wrangler.toml` for the same reason as `CANONICAL_HOST` (a value in the config
also applies to `wrangler dev`; `tests/wrangler-config.node.test.ts` fails the
build if it appears there). The construction is unchanged, so the key is still a
one-way hash and still never the DB `token_hash`. When the secret is absent — dev
and every test — it falls back to a per-isolate random, i.e. exactly the old
behaviour, so nothing local has to know the secret.

It is bound to `env` (like `repo`), because a secret only exists there. It does
not rotate on a clock: a key that changed at midnight would break the
investigation it exists for. Rotating the secret by hand re-anonymises the log
store, which is the intended escape hatch.

## Consequences

- A player's requests now group under one `player.key` across isolates for the
  log's **3-day** retention. That is the whole point, and it is what would have
  made the rename bug legible.
- **Accepted, and where to look if it bites:** a deploy-scoped pepper widens the
  blast radius of a *leaked log*. Under the per-isolate pepper, a stolen log line
  grouped a player only within one isolate's lifetime; now it groups them for the
  pepper's life (a deploy, up to the 3-day window). It is still not the token and
  still not a cross-service identifier — the key is meaningless anywhere but the
  log store, and the store already excludes the token, the IP and the path
  (OPERATIONS § 1). If log access is ever broadened, or a key is ever seen
  outside the store, rotate `LOG_PEPPER` and treat the window as burned.
- The pepper stays **distinct from the `token_hash` pepper** (`keyFor` in
  `server/app.ts` insists on it): the log key must never be a value that unlocks
  a `players` row.
- Absent the secret, grouping is per-isolate as before — so a forgotten
  `wrangler secret put LOG_PEPPER` degrades to the old, weaker-but-safe
  behaviour, not to a broken log. The symptom is a player whose key changes
  between requests; the fix is to set the secret.
