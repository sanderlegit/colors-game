# 0003 — Backend scaffold

2026-08-02 · Cloudflare Pages Functions + D1, skeleton only

What was built: `server/` (router, ports, Repo + Map double, HTTP helpers,
decoders, ids), `functions/api/[[path]].ts`, `migrations/0001_initial.sql`,
`wrangler.toml`, `tsconfig.server.json`, and the second purity-guard block.
The seven handlers are stubs returning 501 — deliberately, a separate task.
Decision and rationale: ADR 0016.

## What the environment did to us

### `wrangler types --path` will not create the directory

`npx wrangler types --path server/worker-configuration.d.ts` fails with "A file
or directory could not be found" if `server/` does not exist yet. It reads as a
problem with the *config*, not with the output path. `mkdir -p server` first.

### A Pages `EventContext` is not an `ExecutionContext`

The obvious adapter,

```ts
export const onRequest: PagesFunction<Env> = (c) => app(c.request, c.env, c);
```

does not type-check if `app`'s third parameter is `ExecutionContext`: the
generated types give `ExecutionContext` an `exports`, `props` and `tracing` that
`EventContext` does not have. The fix is to narrow the parameter to the slice the
app actually uses — `Pick<ExecutionContext, "waitUntil">` — which both satisfy.
The tempting fix is a cast, and CLAUDE.md is right that the cast would be hiding
a real modelling error rather than a type-system limitation.

### D1's `first()` is already narrowed — do not "help" it

`first<T>()` looks like it needs a type argument, and `first<PlayerRow>()` both
compiles and is a lie: nothing verified the shape. Called with no argument it
defaults to `Record<string, unknown>`, which is exactly what you want to hand to
a per-column narrowing helper. Same for `all()`.

### The `@/` alias does survive the wrangler bundle — verified, not assumed

`server/**` uses relative imports into the core (a hard rule — see ADR 0016), but
the core's *own* imports are `@/`-aliased, so esbuild still has to resolve the
alias at bundle time. It does: `npx wrangler pages functions build --outdir /tmp/x`
with a throwaway probe importing `generateTarget` put `ciede2000` and the gamut
bisection in the output. Worth re-running that probe after any tsconfig change,
because the failure mode is a green local build and a broken deploy.

### Writing `\uXXXX` escapes into a source file

The name validator's forbidden-character class is written with escapes, not with
the literal characters. With literals in the file, `grep` classifies the source as
binary and silently reports nothing — which looks exactly like "no matches" while
you are searching for the thing you just wrote.

### SQLite's collation is not JavaScript's `<`

`memoryRepo` sorts names with a code-point comparison rather than `<`, because
SQLite's default TEXT collation is BINARY (UTF-8 byte order = code point order)
and JavaScript compares UTF-16 code units. They disagree for anything above the
BMP against U+E000..U+FFFF, so one emoji in a name is enough to make the double
order the board differently from D1. The test asserts both orders explicitly.

## Two things in the design that are wrong on purpose, and where they will bite

Both are recorded in `../BACKLOG.md` § Known gaps and in `server/db/repo.ts`:

1. **`games.player_id` is NULL until submission**, so the per-player
   "games started since" counter is blind at mint time and cannot rate-limit
   minting. Only `mint_buckets` can.
2. **The board tiebreak is name, not "first to achieve".** The schema has no
   timestamp for a player's best game, and the `players_board` index is
   `(best_score DESC, name)`. Rank and board position must agree or it is a bug
   report, so rank uses the index's order. Changing this is a schema change.

## What was not done

The handlers (4.3), the client wiring (4.4), and the actual D1 database (4.5).
`wrangler.toml` carries a placeholder `database_id`; nothing has ever executed a
statement from `server/db/d1.ts`.
