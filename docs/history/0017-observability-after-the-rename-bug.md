# 0017 — observability, after a bug the logs could not see

2026-08-03. A follow-up to the name-model rework (0016 and the reader flip). The
rename/shared-device bug was fixed in the data model, but the more uncomfortable
finding was that **the logs could not have caught it**, and that is its own
defect. This session addressed the two halves that were cheap and durable.

## Why it was invisible, restated

Three things at once: a rename left no distinct signal (the wide event is built
from the request and response, not from what the handler did); `player.key` was
peppered **per isolate**, so the same device looked like different people across
even a few minutes; and the token that `wrangler login` mints can only *tail*
live logs, not *query* the retained three days. So there was no trail, no way to
group one device, and no way to look back.

## What shipped

- **`player.key` is peppered per deploy** (ADR 0030). `LOG_PEPPER`, a `wrangler
  secret` like `CANONICAL_HOST`, replaces the per-isolate random; absent, it
  falls back to the old per-isolate behaviour, so dev and tests need nothing. The
  key groups a player's requests across isolates for the log's 3-day life. The
  accepted cost — a leaked log now groups a player for the pepper's life, not one
  isolate's — is written down in the ADR, with rotation as the escape hatch.
- **A durable `name_changes_audit`** (ADR 0031, migration `0007`). `setName`
  records each real key change (folded keys, never display names); the rename bug
  is now a query. It is the **first subject-bearing analytics table** — it names a
  `player_id` — so, unlike ADR 0014's subjectless counters, it is deleted with the
  player and bounded by a fifth 90-day sweep pass. Both obligations are pinned by
  tests, and the fixture/drill gained the table.
- **OPERATIONS § 1** now says plainly that reading the past 3 days needs a
  Cloudflare token with *Workers Observability: Read* — the wrangler OAuth token
  does not have it and answers `10000 Authentication error` against the query API.

## Deferred, and why

A `name.changed` / `player.name_changes` field **on the wide event** (a live
signal, in addition to the durable table) was left out. The wide event is
assembled in `server/app.ts` from the request and response only, with no channel
for a handler to report "a name was set here". Adding one is a small but real
architectural change — a mutable log-annotation on the otherwise-immutable
`RequestContext` — and it deserves its own commit rather than riding along.
The durable audit already covers the forensic need; the log field would only add
a same-day live view.
