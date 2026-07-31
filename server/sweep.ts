import type { SecretStore } from "./store/index.js";

/**
 * The body of the hourly cron job, extracted so it is reachable from a test.
 *
 * Reads already filter on expires_at, so an expired secret is unreachable the
 * moment it expires regardless of when this runs. Deleting the rows is hygiene —
 * it bounds storage and means an expired secret's ciphertext does not sit around
 * indefinitely.
 */
export async function sweepExpired(store: SecretStore, nowMs: number = Date.now()): Promise<number> {
  const deleted = await store.sweep(Math.floor(nowMs / 1000));
  console.log(JSON.stringify({ event: "sweep", deleted }));
  return deleted;
}
