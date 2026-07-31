import { defineConfig } from "vitest/config";

// Deliberately does not load the cloudflare plugin: tests run against plain Node,
// which has WebCrypto built in, and against the node:sqlite store.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // node:sqlite is behind a flag until Node 24.
    execArgv: ["--experimental-sqlite"],
  },
});
