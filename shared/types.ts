/** Types shared by the React client and the Hono server. */

/**
 * Who holds the key.
 *
 * - `e2e`    — the key lives in the URL fragment; the browser encrypts and decrypts
 *              and the server is a dumb blob store. This is the only mode built today.
 * - `server` — the server encrypts and decrypts with a key derived from a Worker
 *              Secret. Reserved for logged-in, persistent secrets. See PLAN.md §3.2.
 */
export type SecretMode = "e2e" | "server";

/** The opaque encrypted payload. All binary fields are base64url strings. */
export interface Envelope {
  ciphertext: string;
  iv: string;
  /** PBKDF2 salt; present iff the secret is passphrase protected. */
  salt?: string;
}

export interface CreateSecretRequest extends Envelope {
  hasPassphrase: boolean;
  ttlSeconds: number;
  mode?: SecretMode;
}

export interface CreateSecretResponse {
  id: string;
  expiresAt: number;
  /** Lets the sender revoke the secret before it is read. Shown once, never stored. */
  burnToken: string;
}

export interface SecretMetaResponse {
  hasPassphrase: boolean;
  expiresAt: number;
}

export type RevealResponse = Envelope;

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export const TTL_OPTIONS = [
  { label: "5 minutes", seconds: 300 },
  { label: "1 hour", seconds: 3600 },
  { label: "24 hours", seconds: 86_400 },
  { label: "3 days", seconds: 259_200 },
  { label: "7 days", seconds: 604_800 },
] as const;

export const DEFAULT_TTL_SECONDS = 86_400;
export const MAX_TTL_SECONDS = 604_800;
export const MIN_TTL_SECONDS = 60;

/** Plaintext cap enforced client-side; the body cap below is the server's backstop. */
export const MAX_PLAINTEXT_BYTES = 64 * 1024;
export const MAX_BODY_BYTES = 128 * 1024;
