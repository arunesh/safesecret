import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createApp } from "../server/app.js";
import { memoryRateLimiter } from "../server/ratelimit.js";
import { createSqliteStore } from "../server/store/sqlite.js";
import { sweepExpired } from "../server/sweep.js";

/**
 * Self-hosted entry point: plain Node, a SQLite file on the local filesystem, and
 * the exact same Hono app the Worker runs.
 *
 *   npm run build && npm run start:node
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrations = join(root, "migrations");
const dbPath = process.env.SAFESECRET_DB ?? join(root, "data", "secrets.sqlite");
const port = Number(process.env.PORT ?? 8787);

const store = createSqliteStore(
  dbPath,
  readdirSync(migrations)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(migrations, f)),
);

// In-process limits: they protect this instance only. Behind a load balancer,
// put the real limiting at the proxy.
const app = createApp(store, {
  limits: { create: memoryRateLimiter(10, 60), reveal: memoryRateLimiter(30, 60) },
});

// Serve the built SPA, falling back to index.html for client-side routes.
app.use("/assets/*", serveStatic({ root: "./dist/client" }));
app.get("*", serveStatic({ path: "./dist/client/index.html" }));

// Expiry is enforced on every read, so this sweep is hygiene, not correctness.
const sweep = setInterval(
  () => {
    void sweepExpired(store);
  },
  60 * 60 * 1000,
);
sweep.unref();

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`SafeSecret on http://localhost:${info.port}  (sqlite: ${dbPath})`);
});
