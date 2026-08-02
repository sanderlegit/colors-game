# 0009 — A cold docs audit after the backend landed

2026-08-02

The backend, leaderboard, identity, tabs, logging and telemetry were built across
six sessions by different agents, each editing the documentation set from a
snapshot taken when it started. This session ran the audit `README.md` § Auditing
the docs prescribes — a fresh agent, no session context, routed through
`CLAUDE.md` → `docs/README.md`, five questions whose answers live in different
corners — and then re-verified every finding before acting on it.

The routing held up. Four of the five questions were answered correctly in three
files or fewer. What did not hold up was *truth*.

## The failure mode: agents number against a stale read

Two separate collisions, same cause. An agent reads `docs/adr/README.md` at spawn
time, works for twenty minutes, and writes "the next free number" — which is no
longer free, because work merged in between.

- Two ADRs numbered **0010** (`result-in-a-persistent-side-panel`, committed, and
  `server-side-replay-on-workers`, untracked). Two history entries numbered
  **0003**.
- Worse than the collision: the untracked index **overwrote committed rows**. ADR
  0009's `**superseded by 0010**` banner reverted to `accepted`, and the
  side-panel row vanished from the index entirely.

Repaired by renaming the untracked files (backend ADR → 0016, history →
0004/0005), restoring the clobbered rows, and rewriting ~15 references — carefully,
because `ADR 0010` still legitimately means the *side panel* in `TUNING.md`,
`styles.css`, `render.ts` and `reveal.ts`. All ADR and history links now resolve.

**If you are an agent adding an ADR: re-read the index immediately before you
write the file, not at the start of your task.**

## The most dangerous artefact was a rejection that had been adopted

`adr/README.md` § Already rejected carried *"Reserving the reveal panel's height in
the grid — ~300px does not fit on a 664px phone. It is an overlay."* ADR 0010
**adopted** exactly that: the result sits in slots "laid out all along". The
floating card, its `position: fixed` and `.game-result` are gone from `src/`.

An agent obeying the map would have refused to build what was already shipped.

This is the same class of failure the previous audit found in
`research/color-science.md`, where the fix — a banner at the head of the
superseded section — was institutionalised **for research files only**. Nothing
said what happens when a later ADR overtakes a row in the rejected table. That
rule now exists, in the section header: strike it through and say so in place.

## Other things that were false

- `player-guide.md` told players *"the board needs the server to hand out the
  colours"* — the exact misconception ADR 0016 exists to prevent, in
  player-facing copy. The server hands out a *seed*.
- ADR 0016's own H1 read `# 0010 —`.
- `ARCHITECTURE.md`'s type contract block had `scoreGuess` returning
  `RoundResult`; it returns `Score`, and `RoundResult` is `Score & {target, guess}`
  — `main.ts` depends on `.guess` to build the submission body. That block is
  introduced as "the interfaces every delegated task builds against".
- `CLAUDE.md` said two decisions had been reversed. Three have.
- A closed gap (reveal-card occlusion, closed by ADR 0010) still sat in
  `BACKLOG.md` § Known gaps — and SPEC §11 tells agents BACKLOG wins when the two
  disagree, so the stale entry was the one they were told to trust.
- "Seven endpoints" in two places; there are nine.
- `TUNING.md` said *"retuning is safe"*. It was, before the leaderboard. Stored
  `total_score` values do not re-derive, `scoring.test.ts` pins `SCORE_SCALE`, and
  a retune arguably supersedes ADR 0004.

## Two guards added, because a comment is not a guard

- **`tests/shared-constants.node.test.ts`.** `MAX_NAME_LENGTH` is declared twice —
  it must be, since neither side can import the other — and `server/decode.ts`
  carried "Must equal `MAX_NAME_LENGTH` in `src/platform/api.ts`" with nothing
  making it true. In a repo that guards its duplicated CSP and its duplicated
  scoring core with tests, that comment was the odd one out. Note the failure is
  one-directional and silent: a *larger* server limit stores a name the client's
  decoder then rejects as malformed, turning a successful claim into "the server
  sent something this version cannot read", permanently, for that player.
- The test reads source text rather than importing either module, because
  `tests/**` compiles under `tsconfig.node.json` — no `@/` alias, no DOM libs.
  Importing the client adapter there fails with nine unrelated errors. Same reason
  `tests/csp.node.test.ts` reads files.

## The debug-route guard earned its keep immediately

`tests/debug-flag.node.test.ts` failed on an untracked
`functions/debug/__scratch-echo.ts` — a leftover probe that echoed request headers
back, ungated, and would have shipped. Written one session earlier, it caught a
real thing within a day. Deleted.

## What is still not written down

Carried forward rather than fixed, because each is a decision someone should make
deliberately:

- **No route for "I am changing the API contract."** `docs/README.md` routes for
  tuning, colour, the server, tests, ops and the picker. The rules for validating
  a new response field are excellent and live in a module header comment, which is
  exactly the spelunking `CLAUDE.md` tells you not to do.
- **No precedence order for the documents.** `CLAUDE.md` says SPEC + ARCHITECTURE
  are the source of truth; SPEC §11 says BACKLOG beats SPEC; TUNING says the code
  beats TUNING; ADRs are immutable. Three real conflicts in this audit turned on
  it.
- **A submission that fails mid-game is unrecoverable and undocumented.**
  `main.ts` clears `playing` before awaiting, so the `gameId` is gone and nothing
  retries. The player keeps the score and the personal best, and silently loses
  the board entry. `player-guide.md` now says so; nothing retries.
