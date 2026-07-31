# SafeSecret — Design & Implementation Plan

A one-time secret sharing service. Paste a secret, get a link, the link works once.

## 1. Constraints & the storage decision

**Cloudflare Workers have no filesystem.** No `fs`, no disk, no local SQLite file. The
closest thing to "just SQLite" is **D1**, Cloudflare's managed SQLite:

- Real SQLite dialect, real `.sql` migrations.
- `wrangler dev` runs D1 **locally against an on-disk SQLite file** in `.wrangler/state/`.
  So local dev genuinely is "local fs + sqlite", and prod is the same SQL against D1.
- Free tier is generous and secrets are tiny + short-lived.

Alternatives considered:

| Option | Verdict |
|---|---|
| **D1** | **Chosen.** SQLite, migrations, cheap, extends to users/sessions later. |
| Durable Objects (SQLite-backed) | Stronger single-key serialization, but one DO per secret is overkill; D1 gives atomic burn already (§5). |
| Workers KV | Eventually consistent — a burned secret could stay readable at another PoP for seconds. Disqualifying. |
| R2 | No atomic read-and-delete. No. |

## 2. Portability — not locked to Cloudflare

Routing uses **Hono**, which is built on standard `Request`/`Response`. The same handler code
runs on Workers, on Node via `@hono/node-server`, and on Bun/Deno. (Express would work too,
but it's Node-only with its own `req`/`res` shape, so an Express port would be a rewrite
rather than a config swap. Hono makes the question moot.)

Storage sits behind a small `SecretStore` interface with two implementations:

| Runtime | Server | Store | Command |
|---|---|---|---|
| Cloudflare | Workers | D1 | `npm run dev` (wrangler) |
| Node 22 | `@hono/node-server` | `better-sqlite3` → `./data/secrets.sqlite` | `npm run dev:node` |

Identical SQL, identical migration files, one set of route handlers. The Node mode is the
literal "local fs + SQLite" setup, available as a first-class target rather than a fallback.
WebCrypto (`globalThis.crypto.subtle`) exists in both runtimes, so server-side crypto (§3.2)
is portable too.

## 3. Security model

### 3.1 Default: end-to-end, zero-knowledge

The server never sees plaintext. A deliberate upgrade over onetimesecret.com, which encrypts
server-side and therefore *can* read your secret.

**Create (all in the browser):**
1. Generate a random 256-bit key via `crypto.getRandomValues`.
2. `AES-256-GCM` encrypt with a random 96-bit IV.
3. `POST` only `{ciphertext, iv}`.
4. Server returns an opaque `id`.
5. Link: `https://host/s/<id>#<base64url(key)>`.
   The fragment is **never sent in an HTTP request** — server, logs, and every proxy in
   between never see the key.

**Optional passphrase:** derive a wrapping key with `PBKDF2-SHA256` (600k iterations, random
16-byte salt) and wrap the data key with it. Salt is stored; the passphrase is not. Without
it the fragment key alone is useless.

**Accepted consequences:**
- Recipient needs JavaScript.
- A lost link is unrecoverable. That is the point; the UI says so.
- **Out of scope:** a compromised server serving malicious JS can exfiltrate the key at
  reveal time. No browser-based E2E system solves this. Mitigated with a strict CSP and zero
  third-party scripts, and stated plainly on the FAQ.

### 3.2 The seam: server-side mode, for accounts later

Every secret carries a `mode` column. The storage layer is identical for both — it always
holds an opaque `{ciphertext, iv, salt?}` envelope and never knows the difference.

```
mode = 'e2e'     key lives in the URL fragment; browser encrypts and decrypts.
                 wrapped_key IS NULL. The server is a dumb blob store.

mode = 'server'  worker encrypts and decrypts. The data key is wrapped by a key derived
                 from a Worker Secret (SECRET_MASTER_KEY) via HKDF, and later mixed with a
                 per-account key. wrapped_key holds the wrapped data key.
```

Concretely, both the client and the worker implement the same two-function interface:

```ts
interface EnvelopeCodec {
  seal(plaintext: string, opts): Promise<Envelope & { keyMaterial?: Uint8Array }>;
  open(envelope: Envelope, keyMaterial?: Uint8Array): Promise<string>;
}
```

In `e2e` mode the worker's codec is the **identity function** — it stores and returns the
envelope untouched. In `server` mode the worker's codec does real AES-GCM and the client's is
the identity function. Nothing else in the API, the schema, the burn logic, or the UI changes
between modes.

Why `server` mode has to exist for accounts: a persistent "my secrets" vault that survives
across devices can't have its only key in a URL fragment the user threw away. That is a
genuinely different security posture — the operator can read those secrets — so it will be
opt-in, per-secret, and labeled as such in the UI. Anonymous one-time links stay `e2e` forever.

**Built now:** `e2e` end to end, plus the `mode` column, the codec seam, and the identity
implementations. **Deferred:** the `server` codec body and the accounts that justify it.

## 4. Anti-preview / anti-prefetch

The most common way one-time links die in practice: Slack, Outlook, and corporate link
scanners fetch the URL to build a preview and burn the secret before the human clicks.

**`GET` never burns:**
- `GET /api/secrets/:id` returns metadata only: `{exists, hasPassphrase, expiresAt}`.
- `POST /api/secrets/:id/reveal` is the only thing returning the envelope, and it deletes.
- `/s/:id` renders a "Reveal secret" button — burning requires a deliberate human click.
- `X-Robots-Tag: noindex, nofollow`, no OpenGraph tags on secret routes.

## 5. Atomic burn

The one-time guarantee lives or dies here. SQLite gives it in one statement:

```sql
DELETE FROM secrets WHERE id = ?1 AND expires_at > ?2
RETURNING ciphertext, iv, salt, mode, wrapped_key;
```

`DELETE ... RETURNING` is atomic. Two concurrent reveals: exactly one gets rows, the other
gets zero. No transaction, no read-then-delete race, no application-level locking. Works
identically on D1 and `better-sqlite3`.

## 6. Schema

```sql
-- migrations/0001_init.sql
CREATE TABLE secrets (
  id              TEXT PRIMARY KEY,   -- 22-char base64url, 128 bits of entropy
  mode            TEXT NOT NULL DEFAULT 'e2e' CHECK (mode IN ('e2e','server')),
  ciphertext      BLOB NOT NULL,
  iv              BLOB NOT NULL,
  salt            BLOB,               -- non-null iff passphrase protected
  wrapped_key     BLOB,               -- non-null iff mode='server'
  has_passphrase  INTEGER NOT NULL DEFAULT 0,
  owner_id        TEXT,               -- NULL for anonymous; FK to users(id) later
  created_at      INTEGER NOT NULL,   -- unix seconds
  expires_at      INTEGER NOT NULL,
  burn_token_hash TEXT                -- sha256(sender's burn token); early revoke
);
CREATE INDEX idx_secrets_expires_at ON secrets(expires_at);
CREATE INDEX idx_secrets_owner_id   ON secrets(owner_id) WHERE owner_id IS NOT NULL;
```

Deliberately absent: recipient IP, user agent, referrer, any plaintext, any key material.
No per-secret access log.

`mode`, `wrapped_key`, and `owner_id` are added now precisely so the accounts feature is a
`users` table plus a codec body, not a migration of live secret data.

## 7. Limits

| Thing | Limit | Why |
|---|---|---|
| Plaintext | 64 KiB | Generous for creds/keys/configs; keeps D1 rows small. |
| Request body | 128 KiB | Base64 + GCM tag headroom. |
| TTL choices | 5m, 1h, 24h, 3d, 7d | Default 24h, 7d hard max. |
| Create rate | 20 / 10 min / IP | Cloudflare Rate Limiting binding. |
| Reveal rate | 60 / 10 min / IP | Blunts enumeration; 128-bit ids make it hopeless anyway. |

## 8. API

```
POST   /api/secrets            {ciphertext, iv, salt?, hasPassphrase, ttlSeconds, mode?}
                            -> {id, expiresAt, burnToken}
GET    /api/secrets/:id     -> {exists, hasPassphrase, expiresAt}      # never burns
POST   /api/secrets/:id/reveal
                            -> {ciphertext, iv, salt?} and deletes     # atomic, once
DELETE /api/secrets/:id        Authorization: Bearer <burnToken>       # sender revokes early
GET    /api/health          -> {ok: true}
```

JSON bodies; binary fields are base64url strings. Errors are `{error: {code, message}}`.
Missing, burned, and expired all return the **same** `404` shape — no oracle telling an
attacker which it was.

## 9. Frontend

- **Vite + React 19 + TypeScript.** No Next.js, no SSR — SSR buys nothing here and adds a
  path where the fragment key could leak into a server render.
- **Routing:** `react-router`. Routes: `/`, `/s/:id`, `/faq`.
- **Styling:** hand-written CSS with custom properties in one `theme.css`. Light theme, no
  Tailwind, no component library. Calm near-white background, one restrained accent,
  generous whitespace, real typographic hierarchy — deliberately *not* a neon-gradient
  security aesthetic. The visual message is "boring and trustworthy."

Screens:
1. **Create** — textarea, TTL select, optional passphrase, "Create link". Below the form and
   above the footer, a persistent reassurance band stating the E2E guarantee (see wording
   note below).
2. **Created** — the link, copy button, expiry, an unmissable "this works only once"
   warning, and "Burn now" via the burn token.
3. **Reveal** — "Someone shared a secret with you" + Reveal button; passphrase prompt when
   required. Post-reveal shows plaintext, a copy button, and a clear "this is gone now" state.
4. **Gone** — expired / already viewed / never existed, one screen, no distinction.
5. **FAQ** — how it works, threat model, what we store.

**Wording of the E2E claim.** The band on the home page must be true as written, because a
security product that overstates its guarantee is worse than one that doesn't claim it.
"Nothing is stored in the cloud" is not accurate — the *ciphertext* is stored in D1; that is
what makes the link work. What is true and just as strong:

> **End-to-end encrypted.** Your secret is encrypted in your browser before it's sent. We
> store only ciphertext we can't read — the key lives in the link, never on our servers.

Same reassurance, survives scrutiny, and matches the FAQ and §3.1 exactly.

## 10. Operations

- **Expiry sweep:** cron `0 * * * *` → `DELETE FROM secrets WHERE expires_at <= ?`. Reads
  also filter on `expires_at`, so expiry is enforced on read regardless of sweep timing. The
  sweep is hygiene, not correctness.
- **Metrics:** counts only — created, revealed, expired-unviewed. No identifiers.
- **Headers everywhere:** strict `Content-Security-Policy` (`default-src 'self'`, no
  `unsafe-inline`), `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`,
  `Cache-Control: no-store` on `/api/*` and `/s/*`.

## 11. Repo layout

```
safesecret/
├── src/                    # React app
│   ├── main.tsx, App.tsx
│   ├── routes/             # CreatePage, RevealPage, FaqPage
│   ├── components/         # SecretForm, LinkResult, RevealPanel, CopyButton
│   ├── lib/crypto.ts       # WebCrypto: seal/open, PBKDF2, base64url
│   ├── lib/api.ts          # typed fetch client
│   └── styles/theme.css
├── server/
│   ├── app.ts              # Hono app — runtime-agnostic, the whole API
│   ├── routes/secrets.ts
│   ├── store/index.ts      # SecretStore interface
│   ├── store/d1.ts         # Cloudflare
│   ├── store/sqlite.ts     # better-sqlite3
│   ├── codec.ts            # EnvelopeCodec seam (§3.2)
│   └── http.ts             # JSON helpers, security headers, errors
├── worker/index.ts         # Workers entry: fetch + scheduled, wires D1 store
├── node/index.ts           # Node entry: @hono/node-server, wires sqlite store
├── shared/types.ts         # request/response types shared by client and server
├── migrations/0001_init.sql
├── test/                   # vitest: crypto round-trip, API, burn-once concurrency
├── wrangler.jsonc
└── vite.config.ts
```

On Cloudflare, one Worker serves both: static assets via the `assets` binding, `/api/*` in
code. Single deploy, single origin, no CORS.

## 12. Build order

| Phase | Deliverable | Done when |
|---|---|---|
| 0 | Scaffold: Vite, TS, Hono, wrangler.jsonc, D1 binding, migration | `wrangler dev` serves a page and `/api/health` |
| 1 | `lib/crypto.ts` + vitest | Round-trip and passphrase tests pass; wrong key fails closed |
| 2 | Hono API + both stores | All §8 endpoints; burn-once concurrency test passes on both stores |
| 3 | React UI, all 5 screens | Full create → share → reveal → gone loop works locally |
| 4 | Hardening: rate limits, cron, CSP, a11y, mobile | Lighthouse a11y ≥95; headers verified |
| 5 | Deploy | `wrangler deploy`, remote D1 migrated, smoke-tested |

**Building now: phases 0–3.** Phases 1 and 2 carry the real risk and are independently
testable; the UI is mechanical after that.

## 13. Deferred (designed for, not built)

- **Accounts** — `users`/`sessions` tables, `owner_id` wired up, WebAuthn or email
  magic-link, a "my secrets" dashboard, and the `server` codec body from §3.2.
- Notify-on-reveal webhook/email.
- File attachments (needs R2 + presigned uploads).
- Custom expiry, multi-view counts, recipient email gating.
