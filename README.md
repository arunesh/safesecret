# SafeSecret

Web portal code to store and share one-time secrets.

Share a password or private note through a link that works exactly once. Your browser
encrypts the secret before anything is sent; the server stores ciphertext it cannot read,
because the key travels in the URL fragment, which browsers never put on the wire.

See [PLAN.md](./PLAN.md) for the full design and the reasoning behind it.

## Stack

| Piece | Choice |
|---|---|
| UI | React 19 + Vite, no SSR |
| API | Hono — runs unchanged on Workers and on Node |
| Storage | D1 (SQLite) on Cloudflare; `node:sqlite` file when self-hosted |
| Crypto | WebCrypto — AES-256-GCM, HKDF, PBKDF2 |

## Running it

```bash
npm install
npm run db:migrate:local     # creates the local D1 SQLite file
npm run dev                  # http://localhost:5173
```

`vite dev` runs the real Worker in workerd against a real local D1 database, so the dev
environment matches production rather than approximating it.

```bash
npm test           # 37 tests: crypto, API, burn-once concurrency, expiry
npm run typecheck  # checks the Node/DOM target and the Workers target separately
npm run build
```

### If `npm install` leaves Vite broken

On npm 10.x you may see `Cannot find native binding` from Vite or Vitest. That is
[npm/cli#4828](https://github.com/npm/cli/issues/4828) — npm silently skips the optional
platform binary that Rolldown (Vite 8's bundler) needs. It is not fixed by reinstalling.
Install the binding for your platform without saving it:

```bash
npm i --no-save @rolldown/binding-darwin-arm64    # or -darwin-x64, -linux-x64-gnu, …
```

It is deliberately not in `package.json`: a hard dependency on one platform's binary breaks
`npm install` everywhere else. Upgrading to Node 22.12+ (which Vite 8 requires anyway, and
which ships a newer npm) is the real fix.

### Self-hosted, without Cloudflare

The same Hono app runs on plain Node against a SQLite file on the local filesystem:

```bash
npm run build
npm run start:node        # http://localhost:8787, data/secrets.sqlite
```

Set `SAFESECRET_DB` to move the database file. `node:sqlite` needs `--experimental-sqlite`
on Node 22 (already in the script); on Node 24+ it is stable.

## Deploying to Cloudflare

Deploys run from CI on push to `main` (Cloudflare Workers Builds). Set the project's
**deploy command** to:

```
npm run deploy:ci
```

That applies pending migrations before publishing, so the schema can never lag behind the
code that expects it. `wrangler d1 migrations apply` records what it has run in a
`d1_migrations` table and skips those, so it is safe on every build.

The Workers Builds token needs **D1:Edit** as well as Workers permissions; without it the
migration step fails and the deploy stops before publishing — which is the behaviour you
want, rather than shipping code against a stale schema.

To deploy by hand instead:

```bash
npm run db:migrate:remote
npm run deploy
```

Setting up a fresh account from scratch (already done for this one):

```bash
npx wrangler login
npx wrangler d1 create safesecret   # put the id in wrangler.jsonc's DB binding
```

## Notes for anyone changing this

- **`GET /api/secrets/:id` must never consume a secret.** Mail scanners and chat clients
  fetch links to build previews; a GET that burns is how one-time links die in practice.
  Only `POST .../reveal` destroys, and only from a deliberate click.
- **The burn must stay a single `DELETE ... RETURNING`.** Splitting it into a read then a
  delete reintroduces the race the one-time guarantee depends on.
- **Missing, expired and already-burned all return the same 404 body.** Distinguishing them
  hands an attacker an oracle for which ids ever existed.
- **No inline styles.** The CSP sets `style-src 'self'`, so a `style={{...}}` prop silently
  fails to apply. Everything lives in `src/styles/theme.css`.
- **`public/_headers` is not decoration.** Static assets bypass the Worker entirely, so the
  HTML document gets its CSP from that file and nowhere else.
- The reveal page keeps the envelope in memory after burning so a mistyped passphrase can be
  retried. Re-fetching would 404 and lose the secret to a typo.
- **Rate limiting is a seam, not a binding.** On Workers it delegates to the native binding,
  which counts across colos. The Node limiter is in-process and protects one instance only;
  behind a load balancer, limit at the proxy instead.
- **The cron body lives in `sweepExpired()`, not inline in `scheduled()`,** so it can be
  tested. `wrangler dev --test-scheduled` cannot reach `/__scheduled` here — the SPA asset
  router answers it before the Worker sees it.

## Known gaps

The cron trigger has not been exercised against remote D1 — its body is unit-tested and the
schedule is declared, but nothing has watched it fire in production. Check the dashboard
after the first hour. Accounts and server-side mode are designed for but not built
(PLAN.md §3.2).
