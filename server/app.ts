import { Hono, type MiddlewareHandler } from "hono";
import { ApiError, errorBody, noStore, securityHeaders } from "./http.js";
import { allowAll, clientIp, type RateLimiter } from "./ratelimit.js";
import { secretsRoutes } from "./routes/secrets.js";
import type { SecretStore } from "./store/index.js";

export interface AppOptions {
  /** Limits the two endpoints that cost something: creating and revealing. */
  limits?: { create: RateLimiter; reveal: RateLimiter };
}

/**
 * The entire API, independent of runtime. worker/index.ts wires this to D1 and
 * the native rate limiting binding on Cloudflare; node/index.ts wires it to
 * node:sqlite and an in-process limiter behind @hono/node-server.
 * Nothing below imports a Cloudflare or Node built-in.
 */
export function createApp(store: SecretStore, options: AppOptions = {}) {
  const limits = options.limits ?? { create: allowAll, reveal: allowAll };
  const app = new Hono();

  app.use("*", securityHeaders);
  app.use("/api/*", noStore);

  app.use("/api/secrets", limited(limits.create, "POST"));
  app.use("/api/secrets/:id/reveal", limited(limits.reveal, "POST"));

  app.get("/api/health", (c) => c.json({ ok: true }));
  app.route("/api/secrets", secretsRoutes(store));

  app.notFound((c) => c.json(errorBody("not_found", "No such endpoint."), 404));

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json(errorBody(err.code, err.message), err.status as 400);
    }
    // Never surface internals from a service that holds secrets.
    console.error("unhandled error", { message: err instanceof Error ? err.message : String(err) });
    return c.json(errorBody("internal", "Something went wrong."), 500);
  });

  return app;
}

function limited(limiter: RateLimiter, method: string): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== method) return next();

    if (!(await limiter.check(clientIp(c.req.raw.headers)))) {
      // Retry-After is advisory here: the window is fixed, so a minute is the
      // longest a caller could still be blocked for.
      c.header("Retry-After", "60");
      throw new ApiError(429, "rate_limited", "Too many requests. Wait a minute and try again.");
    }

    return next();
  };
}
