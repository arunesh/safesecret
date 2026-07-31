import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { createApp } from "../server/app.js";
import { createSqliteStore } from "../server/store/sqlite.js";
import { sealSecret, openSecret } from "../src/lib/crypto.js";
import type { CreateSecretResponse, SecretMetaResponse } from "../shared/types.js";

const migration = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "0001_init.sql");

let store: ReturnType<typeof createSqliteStore>;
let app: Hono;

beforeEach(() => {
  store = createSqliteStore(":memory:", [migration]);
  app = createApp(store);
});

afterEach(() => store.close());

const body = (overrides: Record<string, unknown> = {}) => ({
  ciphertext: "Zm9vYmFy",
  iv: "AAAAAAAAAAAAAAAA", // 16 base64url chars = 12 bytes
  hasPassphrase: false,
  ttlSeconds: 3600,
  ...overrides,
});

const post = (path: string, payload?: unknown) =>
  app.request(path, {
    method: "POST",
    ...(payload === undefined ? {} : { body: JSON.stringify(payload), headers: { "content-type": "application/json" } }),
  });

async function create(overrides: Record<string, unknown> = {}): Promise<CreateSecretResponse> {
  const res = await post("/api/secrets", body(overrides));
  expect(res.status).toBe(201);
  return res.json();
}

describe("health", () => {
  it("responds", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("security headers", () => {
  it("sets a strict CSP and no-store on API responses", async () => {
    const res = await app.request("/api/health");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
  });
});

describe("create", () => {
  it("returns an id, an expiry and a burn token", async () => {
    const created = await create();
    expect(created.id).toHaveLength(22);
    expect(created.burnToken).toHaveLength(43);
    expect(created.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("issues a distinct id per secret", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 25; i++) ids.add((await create()).id);
    expect(ids.size).toBe(25);
  });

  it.each([
    ["malformed ciphertext", { ciphertext: "not base64url!!" }],
    ["a wrong-length IV", { iv: "AAAA" }],
    ["a ttl below the minimum", { ttlSeconds: 5 }],
    ["a ttl above the maximum", { ttlSeconds: 60 * 60 * 24 * 30 }],
    ["a non-integer ttl", { ttlSeconds: 3600.5 }],
    ["a passphrase flag with no salt", { hasPassphrase: true }],
    ["a salt with no passphrase flag", { salt: "A".repeat(22) }],
  ])("rejects %s", async (_label, overrides) => {
    const res = await post("/api/secrets", body(overrides));
    expect(res.status).toBe(400);
  });

  it("refuses server-side mode while it is unimplemented", async () => {
    const res = await post("/api/secrets", body({ mode: "server" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("unsupported_mode");
  });

  it("rejects a non-JSON body", async () => {
    const res = await app.request("/api/secrets", {
      method: "POST",
      body: "{{{",
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
  });
});

describe("metadata", () => {
  it("does not burn the secret", async () => {
    const { id } = await create();

    for (let i = 0; i < 3; i++) {
      const res = await app.request(`/api/secrets/${id}`);
      expect(res.status).toBe(200);
      const meta: SecretMetaResponse = await res.json();
      expect(meta.hasPassphrase).toBe(false);
    }

    // Still revealable after all those GETs — this is the anti-prefetch guarantee.
    expect((await post(`/api/secrets/${id}/reveal`)).status).toBe(200);
  });

  it("reports whether a passphrase is required", async () => {
    const { id } = await create({ hasPassphrase: true, salt: "A".repeat(22) });
    const meta: SecretMetaResponse = await (await app.request(`/api/secrets/${id}`)).json();
    expect(meta.hasPassphrase).toBe(true);
  });

  it("404s for an unknown id", async () => {
    expect((await app.request(`/api/secrets/${"a".repeat(22)}`)).status).toBe(404);
  });

  it("404s for a malformed id without distinguishing it from a missing one", async () => {
    const missing = await app.request(`/api/secrets/${"a".repeat(22)}`);
    const malformed = await app.request("/api/secrets/short");
    expect(malformed.status).toBe(missing.status);
    expect(await malformed.json()).toEqual(await missing.json());
  });
});

describe("reveal", () => {
  it("returns the envelope exactly as it was stored", async () => {
    const { envelope, linkKey } = await sealSecret("attack at dawn");
    const res = await post("/api/secrets", { ...envelope, hasPassphrase: false, ttlSeconds: 3600 });
    const { id }: CreateSecretResponse = await res.json();

    const revealed = await (await post(`/api/secrets/${id}/reveal`)).json();
    expect(await openSecret(revealed, linkKey)).toBe("attack at dawn");
  });

  it("works exactly once", async () => {
    const { id } = await create();
    expect((await post(`/api/secrets/${id}/reveal`)).status).toBe(200);

    const second = await post(`/api/secrets/${id}/reveal`);
    expect(second.status).toBe(404);
    expect((await second.json()).error.code).toBe("not_found");
  });

  it("gives exactly one winner under concurrent reveals", async () => {
    const { id } = await create();
    const results = await Promise.all(Array.from({ length: 8 }, () => post(`/api/secrets/${id}/reveal`)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 404)).toHaveLength(7);
  });

  it("is indistinguishable from missing once burned", async () => {
    const { id } = await create();
    await post(`/api/secrets/${id}/reveal`);
    const burned = await app.request(`/api/secrets/${id}`);
    const missing = await app.request(`/api/secrets/${"z".repeat(22)}`);
    expect(burned.status).toBe(missing.status);
    expect(await burned.json()).toEqual(await missing.json());
  });
});

describe("expiry", () => {
  it("hides an expired secret from metadata and reveal", async () => {
    const { id } = await create({ ttlSeconds: 60 });
    // Rather than sleeping, age the row directly.
    await store.create({
      id: `${id.slice(0, 21)}X`,
      mode: "e2e",
      ciphertext: "Zm9v",
      iv: "AAAAAAAAAAAAAAAA",
      salt: null,
      wrappedKey: null,
      hasPassphrase: false,
      ownerId: null,
      createdAt: 1000,
      expiresAt: 2000, // long past
      burnTokenHash: "x",
    });
    const expiredId = `${id.slice(0, 21)}X`;
    expect((await app.request(`/api/secrets/${expiredId}`)).status).toBe(404);
    expect((await post(`/api/secrets/${expiredId}/reveal`)).status).toBe(404);
  });

  it("sweeps expired rows and leaves live ones", async () => {
    const live = await create({ ttlSeconds: 3600 });
    await store.create({
      id: "b".repeat(22),
      mode: "e2e",
      ciphertext: "Zm9v",
      iv: "AAAAAAAAAAAAAAAA",
      salt: null,
      wrappedKey: null,
      hasPassphrase: false,
      ownerId: null,
      createdAt: 1000,
      expiresAt: 2000,
      burnTokenHash: "x",
    });

    expect(await store.sweep(Math.floor(Date.now() / 1000))).toBe(1);
    expect((await app.request(`/api/secrets/${live.id}`)).status).toBe(200);
  });
});

describe("sender revoke", () => {
  it("burns the secret with a valid token", async () => {
    const { id, burnToken } = await create();
    const res = await app.request(`/api/secrets/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${burnToken}` },
    });
    expect(res.status).toBe(204);
    expect((await post(`/api/secrets/${id}/reveal`)).status).toBe(404);
  });

  it("refuses a wrong token and leaves the secret readable", async () => {
    const { id } = await create();
    const res = await app.request(`/api/secrets/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${"n".repeat(43)}` },
    });
    expect(res.status).toBe(404);
    expect((await post(`/api/secrets/${id}/reveal`)).status).toBe(200);
  });

  it("requires an authorization header", async () => {
    const { id } = await create();
    expect((await app.request(`/api/secrets/${id}`, { method: "DELETE" })).status).toBe(401);
  });
});
