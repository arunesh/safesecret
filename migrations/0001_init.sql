-- SafeSecret initial schema.
--
-- Deliberately absent: recipient IP, user agent, referrer, plaintext, key material.
-- There is no per-secret access log.
--
-- `mode`, `wrapped_key` and `owner_id` exist from day one so that adding accounts
-- later is a new table plus a codec body, not a migration of live secret data.

-- Envelope columns are base64url TEXT rather than BLOB: D1 and better-sqlite3
-- round-trip BLOBs differently (ArrayBuffer vs Buffer vs number[]), and the values
-- are already base64url on the wire. TEXT makes the store a pure pass-through with
-- no driver-specific conversion, for ~33% size on rows that are a few hundred bytes.

CREATE TABLE IF NOT EXISTS secrets (
  id              TEXT PRIMARY KEY,   -- 22-char base64url, 128 bits of entropy
  mode            TEXT NOT NULL DEFAULT 'e2e' CHECK (mode IN ('e2e', 'server')),
  ciphertext      TEXT NOT NULL,      -- base64url
  iv              TEXT NOT NULL,      -- base64url
  salt            TEXT,               -- base64url; non-null iff passphrase protected
  wrapped_key     TEXT,               -- base64url; non-null iff mode = 'server'
  has_passphrase  INTEGER NOT NULL DEFAULT 0,
  owner_id        TEXT,               -- NULL for anonymous secrets
  created_at      INTEGER NOT NULL,   -- unix seconds
  expires_at      INTEGER NOT NULL,   -- unix seconds
  burn_token_hash TEXT                -- sha256 of the sender's burn token
);

CREATE INDEX IF NOT EXISTS idx_secrets_expires_at ON secrets (expires_at);
CREATE INDEX IF NOT EXISTS idx_secrets_owner_id ON secrets (owner_id) WHERE owner_id IS NOT NULL;
