import { SQL, insertArgs, toStored, type NewSecret, type RawRow, type SecretStore } from "./index.js";

/**
 * Structural subset of D1Database. Declared here rather than imported from
 * @cloudflare/workers-types so that everything under server/ stays free of
 * Cloudflare types and compiles for the Node target too. A real D1Database
 * satisfies this interface.
 */
export interface D1Like {
  prepare(query: string): D1PreparedLike;
}

export interface D1PreparedLike {
  bind(...values: unknown[]): D1PreparedLike;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
}

export function createD1Store(db: D1Like): SecretStore {
  return {
    async create(secret: NewSecret) {
      await db
        .prepare(SQL.insert)
        .bind(...insertArgs(secret))
        .run();
    },

    async meta(id, now) {
      const row = await db
        .prepare(SQL.meta)
        .bind(id, now)
        .first<{ has_passphrase: number; expires_at: number }>();
      if (!row) return null;
      return { hasPassphrase: row.has_passphrase === 1, expiresAt: row.expires_at };
    },

    async burn(id, now) {
      const row = await db.prepare(SQL.burn).bind(id, now).first<RawRow>();
      return row ? toStored(row) : null;
    },

    async revoke(id, burnTokenHash) {
      const result = await db.prepare(SQL.revoke).bind(id, burnTokenHash).run();
      return result.meta.changes > 0;
    },

    async sweep(now) {
      const result = await db.prepare(SQL.sweep).bind(now).run();
      return result.meta.changes;
    },
  };
}
