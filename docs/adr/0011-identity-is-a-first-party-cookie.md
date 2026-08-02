# 0011 — Identity is a server-issued first-party cookie

Date: 2026-08-02 · Status: accepted

## Context

A leaderboard needs a name, and names have to survive a reload or they are just
decoration. The game has no login and is not getting one — an account system for a
five-round colour game is more product than the game is.

The proposal on the table was "remember players by browser fingerprint **and**
cookie", the fingerprint covering the case where the cookie is gone. That is worth
taking seriously, and it is wrong on three independent grounds.

**It does not work.** The widely-quoted uniqueness figures come from
privacy-enthusiast samples; Eckersley disclaimed his own as *"somewhat meaningless
to extrapolate"*. Measured on a general-audience population (2M fingerprints,
Gómez-Boix et al. 2018, via Laperdrix, ACM TWEB 14(2)), mobile uniqueness is
**18.5%** — read the other way, an **81.5% collision rate**. This game will skew
mobile. Two players on similar iPhones would share an identity and silently
overwrite each other's name. Stability is no better: 45.5% of fingerprints change
within a single day (FP-Stalker, IEEE S&P 2018), Chrome ships a fingerprint-
perturbing version every four weeks, and Brave randomises every session.

**It is the only component that would need a consent banner.** ePrivacy Art 5(3)
is technology-neutral and covers *"the gaining of access to information already
stored"*, so storing nothing does not exempt you — EDPB Guidelines 02/2023 name
fingerprinting explicitly, and WP29 Opinion 9/2014 §7.4 says recognising a
returning user this way is *not* "strictly necessary" and requires consent. A
cookie holding a name the user typed is the paradigm *exempt* case (WP194 §3.1;
PECR Sch. A1 para 4(2)(e)(ii)). The intuition is inverted: the technique that
stores nothing is the one that needs permission.

**The vendors' own numbers do not support it.** Fingerprint Pro markets accuracy
*"even when cookies are cleared"*; a grey-box study (Luo et al., ACM Web Conf 2026)
found that persisting its cookies *"overrules any and all individual modifications
to browser attributes"* — the durability comes from a one-year cookie.

## Decision

Identity is a 32-byte random token in a first-party cookie:

```
Set-Cookie: colors_id=<43-char base64url>; Path=/; Max-Age=...; HttpOnly; Secure; SameSite=Strict
```

No `Domain`, so it is host-only. Stored **only** as SHA-256 hex in
`players.token_hash`, so a database dump hands out no identities.

**Minted on first successful submission**, never on page load. A drive-by visitor
gets no cookie and no row. `GET /api/me` is read-only and answers 204 without one.

No fingerprinting. No recovery code. No email. No passkeys.

## Consequences

- **Lose the cookie, lose the name.** Cleared storage, a private window, or a
  second device all mean a fresh identity. Accepted deliberately: this is a casual
  game where the name is cosmetic, and every alternative that fixes it costs more
  than it is worth here. A recovery code was designed and cut for the same reason.
- **The client cannot read its own identity**, so every identity-touching response
  must echo the canonical `name`. This is a real constraint on the API, not an
  implementation detail — an endpoint that forgets to echo leaves the UI unable to
  say who you are.
- **Names auto-suffix on collision** (`ada` → `ada-2`) with the unique index as
  arbiter, never a check-then-write, which is racy. Reject-and-retry was rejected:
  it has the same race and costs a round trip *after* a successful submission.
- **Claiming a name requires a completed game.** That makes bulk squatting cost a
  full ~28-second playthrough each, which is the cheapest control available that
  needs no CAPTCHA and no accounts.
- **"Forget me" is a real `DELETE` with cascade**, not a soft delete. A forget that
  keeps the row is a lie, and there is nothing here worth keeping.
- Orphaned names will accumulate from abandoned cookies. Sweep `players` with
  `games_played = 0` after 7 days, and release names idle over 12 months.
- Compliance is one line of notice plus a working "forget me" — no banner.

## How we would know this was wrong

If players report losing their name often enough to complain, the fix is a
recovery code (128-bit, Crockford Base32, shown once, hashed server-side), **not**
a fingerprint. That option stays open; fingerprinting does not.
