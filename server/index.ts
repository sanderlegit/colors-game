/**
 * The Workers entry point. It holds no decisions — every one of them is in
 * `server/app.ts`, which knows nothing about Cloudflare and is therefore
 * testable without it.
 *
 * The app is built once at module scope rather than per request: an isolate
 * serves many requests, and rebuilding the router on each one would be work
 * repeated for no reason. Nothing here runs at global scope beyond building a
 * route table — the runtime forbids randomness, timers and I/O there, which is
 * why `productionDeps` is lazy about both of its secrets.
 *
 * A real `ExecutionContext` satisfies `AppExecutionContext` (`waitUntil` and
 * nothing else), so `ctx` passes straight through with no cast. Do not widen the
 * app's parameter back to `ExecutionContext`: the narrow type is what lets
 * `app.fixture.ts` drive the whole stack with a context it can inspect.
 *
 * `scheduled` is the second entry point, fed by `[triggers] crons` in
 * `wrangler.toml`. It takes no `ctx`: a scheduled handler's returned promise is
 * awaited by the runtime, so there is nothing to defer past it, and an unused
 * parameter would not compile. Like `fetch`, it holds no decisions — the sweep
 * is `server/sweep.ts`, which is testable without a Worker.
 */

import { createApp } from "./app";
import { createSweep } from "./sweep";

const app = createApp();
const sweep = createSweep();

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> =>
    app(request, env, ctx),
  scheduled: (controller: ScheduledController, env: Env): Promise<void> => sweep(controller, env),
} satisfies ExportedHandler<Env>;
