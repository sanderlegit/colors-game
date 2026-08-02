/**
 * The two `Env` members `wrangler types` does not generate, because both are
 * deliberately absent from `wrangler.toml`.
 *
 * `Env` is declared by `worker-configuration.d.ts` as an interface, so this
 * merges into it rather than replacing it.
 */
interface Env {
  /**
   * Enables `server/debug/**`, the workerd half of the ADR 0016 engine-agreement
   * gate. It is supplied by `wrangler dev --var DEBUG_REPLAY:1` in the
   * real-backend e2e run and by nothing else — not by `wrangler.toml`, not by any
   * deployed environment — so the route answers 404 everywhere it could ship to.
   *
   * Declaring it here rather than in `[vars]` is the whole point: a value in
   * `wrangler.toml` is a value that deploys. `tests/debug-flag.node.test.ts`
   * fails the build if one appears.
   */
  readonly DEBUG_REPLAY?: string;

  /**
   * The one hostname this site answers on. Unset everywhere except the deployed
   * Worker, where it is set with `wrangler secret put CANONICAL_HOST` rather than
   * in `wrangler.toml` — a value in the config file is a value that also applies
   * to `wrangler dev`, which would redirect localhost into production.
   *
   * Absent disables the check (ADR 0021). That is what keeps `localhost`, the
   * e2e proxy on `127.0.0.1:5174` and a `ts.net` phone address all working.
   */
  readonly CANONICAL_HOST?: string;
}
