import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SQL, insertArgs, toStored, type NewSecret, type RawRow, type SecretStore } from "./index.js";

/**
 * Node / self-hosted store: a real SQLite file on the local filesystem, running the
 * same SQL and the same migration files as D1.
 *
 * Uses the built-in `node:sqlite` rather than better-sqlite3, so the self-hosted
 * path has no native dependency to compile or to break against a Node ABI bump.
 * Node 22 needs `--experimental-sqlite`; on Node 24+ it is stable and flagless.
 *
 * Pass `:memory:` for tests.
 */
export function createSqliteStore(path: string, migrationPaths: string[]): SecretStore & { close(): void } {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  for (const migration of migrationPaths) db.exec(readFileSync(migration, "utf8"));

  const statements = {
    insert: db.prepare(SQL.insert),
    meta: db.prepare(SQL.meta),
    burn: db.prepare(SQL.burn),
    revoke: db.prepare(SQL.revoke),
    sweep: db.prepare(SQL.sweep),
  };

  return {
    async create(secret: NewSecret) {
      statements.insert.run(...insertArgs(secret));
    },

    async meta(id, now) {
      const row = statements.meta.get(id, now) as { has_passphrase: number; expires_at: number } | undefined;
      if (!row) return null;
      return { hasPassphrase: row.has_passphrase === 1, expiresAt: row.expires_at };
    },

    async burn(id, now) {
      // node:sqlite is synchronous, so DELETE ... RETURNING is atomic here for free:
      // no other statement can interleave between the delete and the read.
      const row = statements.burn.get(id, now) as RawRow | undefined;
      return row ? toStored(row) : null;
    },

    async revoke(id, burnTokenHash) {
      return Number(statements.revoke.run(id, burnTokenHash).changes) > 0;
    },

    async sweep(now) {
      return Number(statements.sweep.run(now).changes);
    },

    close() {
      db.close();
    },
  };
}
