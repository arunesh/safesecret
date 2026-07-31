/**
 * Rate limiting seam, kept portable the same way storage is.
 *
 * On Cloudflare this delegates to the native rate limiting binding, which counts
 * at the edge across colos. On Node it is an in-process window, which is honest
 * about its scope: it protects a single self-hosted instance, not a fleet.
 */
export interface RateLimiter {
  /** Resolves true when the request is within budget, false when it is over. */
  check(key: string): Promise<boolean>;
}

/** Used wherever limiting is not configured — tests, and the default Node path. */
export const allowAll: RateLimiter = {
  async check() {
    return true;
  },
};

/**
 * Structural subset of Cloudflare's RateLimit binding, declared here so that
 * server/ stays free of Cloudflare types. A real binding satisfies it.
 */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export const bindingRateLimiter = (binding: RateLimitBinding): RateLimiter => ({
  async check(key) {
    return (await binding.limit({ key })).success;
  },
});

/**
 * Fixed-window counter for the Node target and for tests.
 *
 * Deliberately not used on Workers: module-level mutable state is per-isolate
 * there, so it would enforce nothing consistent across colos while looking like
 * it did. The binding is the only correct choice on Cloudflare.
 */
export function memoryRateLimiter(limit: number, periodSeconds: number, now = () => Date.now()): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();

  return {
    async check(key) {
      const timestamp = now();

      // Opportunistic prune so a long-running process cannot grow unbounded on
      // a stream of distinct keys.
      if (windows.size > 10_000) {
        for (const [existing, window] of windows) {
          if (window.resetAt <= timestamp) windows.delete(existing);
        }
      }

      const window = windows.get(key);
      if (!window || window.resetAt <= timestamp) {
        windows.set(key, { count: 1, resetAt: timestamp + periodSeconds * 1000 });
        return true;
      }

      window.count += 1;
      return window.count <= limit;
    },
  };
}

/**
 * Cloudflare always sets CF-Connecting-IP. The forwarded-for fallback is for the
 * self-hosted path; behind an untrusted proxy it is spoofable, which is why the
 * README tells self-hosters to terminate at a proxy that sets it themselves.
 */
export function clientIp(headers: { get(name: string): string | null | undefined }): string {
  const direct = headers.get("cf-connecting-ip");
  if (direct) return direct;
  const forwarded = headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}
