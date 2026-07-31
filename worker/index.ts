import { createApp } from "../server/app.js";
import { createD1Store } from "../server/store/d1.js";

/**
 * Cloudflare entry point. Static assets are served by the assets binding; only
 * /api/* reaches this Worker (see run_worker_first in wrangler.jsonc).
 */
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return createApp(createD1Store(env.DB)).fetch(request, env, ctx);
  },

  async scheduled(_controller: ScheduledController, env: Env) {
    const deleted = await createD1Store(env.DB).sweep(Math.floor(Date.now() / 1000));
    console.log(JSON.stringify({ event: "sweep", deleted }));
  },
} satisfies ExportedHandler<Env>;
