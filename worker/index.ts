import { createApp } from "../server/app.js";
import { bindingRateLimiter } from "../server/ratelimit.js";
import { createD1Store } from "../server/store/d1.js";
import { sweepExpired } from "../server/sweep.js";

/**
 * Cloudflare entry point. Static assets are served by the assets binding; only
 * /api/* reaches this Worker (see run_worker_first in wrangler.jsonc).
 */
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const app = createApp(createD1Store(env.DB), {
      limits: {
        create: bindingRateLimiter(env.CREATE_LIMITER),
        reveal: bindingRateLimiter(env.REVEAL_LIMITER),
      },
    });
    return app.fetch(request, env, ctx);
  },

  async scheduled(_controller: ScheduledController, env: Env) {
    await sweepExpired(createD1Store(env.DB));
  },
} satisfies ExportedHandler<Env>;
