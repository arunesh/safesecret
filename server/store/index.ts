import type { SecretMode } from "../../shared/types.js";

/** A row as it exists in SQLite. Every payload field is base64url text. */
export interface StoredSecret {
  id: string;
  mode: SecretMode;
  ciphertext: string;
  iv: string;
  salt: string | null;
  wrappedKey: string | null;
  hasPassphrase: boolean;
  expiresAt: number;
}

export interface NewSecret {
  id: string;
  mode: SecretMode;
  ciphertext: string;
  iv: string;
  salt: string | null;
  wrappedKey: string | null;
  hasPassphrase: boolean;
  ownerId: string | null;
  createdAt: number;
  expiresAt: number;
  burnTokenHash: string;
}

/**
 * The storage seam. Two implementations — D1 on Cloudflare, better-sqlite3 on Node —
 * running byte-identical SQL against the same migrations.
 */
export interface SecretStore {
  create(secret: NewSecret): Promise<void>;

  /** Metadata only. Never burns, so link previewers and scanners are harmless. */
  meta(id: string, now: number): Promise<Pick<StoredSecret, "hasPassphrase" | "expiresAt"> | null>;

  /**
   * Atomically return and delete. This is the whole one-time guarantee: it must be
   * a single `DELETE ... RETURNING`, never a read followed by a delete. Under two
   * concurrent reveals exactly one caller gets a row and the other gets null.
   */
  burn(id: string, now: number): Promise<StoredSecret | null>;

  /** Sender-initiated revoke. Returns false if the token does not match. */
  revoke(id: string, burnTokenHash: string): Promise<boolean>;

  /** Hourly hygiene. Expiry is enforced on read regardless of when this runs. */
  sweep(now: number): Promise<number>;
}

export const SQL = {
  insert: `INSERT INTO secrets
    (id, mode, ciphertext, iv, salt, wrapped_key, has_passphrase, owner_id, created_at, expires_at, burn_token_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

  meta: `SELECT has_passphrase, expires_at FROM secrets WHERE id = ? AND expires_at > ?`,

  burn: `DELETE FROM secrets WHERE id = ? AND expires_at > ?
    RETURNING id, mode, ciphertext, iv, salt, wrapped_key, has_passphrase, expires_at`,

  revoke: `DELETE FROM secrets WHERE id = ? AND burn_token_hash = ?`,

  sweep: `DELETE FROM secrets WHERE expires_at <= ?`,
} as const;

/** Shape of a raw row, shared by both drivers. */
export interface RawRow {
  id: string;
  mode: string;
  ciphertext: string;
  iv: string;
  salt: string | null;
  wrapped_key: string | null;
  has_passphrase: number;
  expires_at: number;
}

export function toStored(row: RawRow): StoredSecret {
  return {
    id: row.id,
    mode: row.mode as SecretMode,
    ciphertext: row.ciphertext,
    iv: row.iv,
    salt: row.salt,
    wrappedKey: row.wrapped_key,
    hasPassphrase: row.has_passphrase === 1,
    expiresAt: row.expires_at,
  };
}

export function insertArgs(s: NewSecret) {
  return [
    s.id,
    s.mode,
    s.ciphertext,
    s.iv,
    s.salt,
    s.wrappedKey,
    s.hasPassphrase ? 1 : 0,
    s.ownerId,
    s.createdAt,
    s.expiresAt,
    s.burnTokenHash,
  ] as const;
}
