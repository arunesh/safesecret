import { Hono } from "hono";
import { ApiError, errorBody, noStore, securityHeaders } from "./http.js";
import { secretsRoutes } from "./routes/secrets.js";
import type { SecretStore } from "./store/index.js";

/**
 * The entire API, independent of runtime. worker/index.ts wires this to D1 on
 * Cloudflare; node/index.ts wires it to better-sqlite3 behind @hono/node-server.
 * Nothing below imports a Cloudflare or Node built-in.
 */
export function createApp(store: SecretStore) {
  const app = new Hono();

  app.use("*", securityHeaders);
  app.use("/api/*", noStore);

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
