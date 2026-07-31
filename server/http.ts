import type { Context, MiddlewareHandler } from "hono";
import type { ApiErrorBody } from "../shared/types.js";

/**
 * A failure we are willing to describe to the caller. Anything else becomes a
 * generic 500 — we never leak internals from a service that holds secrets.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Missing, already burned, and expired are indistinguishable by design. Telling
 * them apart would give an attacker an oracle for which ids have ever existed.
 */
export const gone = () => new ApiError(404, "not_found", "This secret is not available.");

export const errorBody = (code: string, message: string): ApiErrorBody => ({
  error: { code, message },
});

/** Security headers applied to every response, asset or API. */
export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  c.header(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "object-src 'none'",
    ].join("; "),
  );
};

/** Nothing this service returns should ever sit in a cache. */
export const noStore: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store, max-age=0");
  c.header("X-Robots-Tag", "noindex, nofollow");
};

export function readJson<T>(c: Context): Promise<T> {
  const length = Number(c.req.header("content-length") ?? 0);
  if (length > 0 && length > MAX_BODY) {
    throw new ApiError(413, "too_large", "That secret is too large.");
  }
  return c.req.json<T>().catch(() => {
    throw new ApiError(400, "bad_json", "Request body must be valid JSON.");
  });
}

const MAX_BODY = 128 * 1024;
