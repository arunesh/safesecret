import { Hono } from "hono";
import {
  MAX_BODY_BYTES,
  MAX_TTL_SECONDS,
  MIN_TTL_SECONDS,
  type CreateSecretRequest,
  type CreateSecretResponse,
  type RevealResponse,
  type SecretMetaResponse,
} from "../../shared/types.js";
import { codecFor } from "../codec.js";
import { ApiError, gone, readJson } from "../http.js";
import { isBase64Url, newBurnToken, newSecretId, sha256Hex } from "../ids.js";
import type { SecretStore } from "../store/index.js";

/** base64url lengths for the fixed-size fields: 12-byte IV, 16-byte PBKDF2 salt. */
const IV_LENGTH = 16;
const SALT_LENGTH = 22;
const ID_LENGTH = 22;

const nowSeconds = () => Math.floor(Date.now() / 1000);

function validateCreate(body: unknown): Required<Pick<CreateSecretRequest, "ciphertext" | "iv" | "hasPassphrase" | "ttlSeconds">> & {
  salt: string | null;
} {
  if (typeof body !== "object" || body === null) {
    throw new ApiError(400, "bad_request", "Expected a JSON object.");
  }
  const { ciphertext, iv, salt, hasPassphrase, ttlSeconds, mode } = body as CreateSecretRequest;

  // Only e2e exists today. Accepting 'server' silently would be worse than a clear
  // refusal, because the caller would believe the operator cannot read the secret.
  if (mode !== undefined && mode !== "e2e") {
    throw new ApiError(400, "unsupported_mode", "Only end-to-end encrypted secrets are supported.");
  }
  if (!isBase64Url(ciphertext, MAX_BODY_BYTES)) {
    throw new ApiError(400, "bad_ciphertext", "Missing or malformed ciphertext.");
  }
  if (!isBase64Url(iv, IV_LENGTH) || iv.length !== IV_LENGTH) {
    throw new ApiError(400, "bad_iv", "Missing or malformed IV.");
  }
  if (typeof hasPassphrase !== "boolean") {
    throw new ApiError(400, "bad_request", "hasPassphrase must be a boolean.");
  }
  // A passphrase without a salt (or vice versa) means the client is confused; the
  // resulting secret would be undecryptable, so refuse it now rather than at reveal.
  if (hasPassphrase !== (salt !== undefined)) {
    throw new ApiError(400, "bad_salt", "A salt is required exactly when a passphrase is used.");
  }
  if (salt !== undefined && (!isBase64Url(salt, SALT_LENGTH) || salt.length !== SALT_LENGTH)) {
    throw new ApiError(400, "bad_salt", "Malformed salt.");
  }
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < MIN_TTL_SECONDS || ttlSeconds > MAX_TTL_SECONDS) {
    throw new ApiError(400, "bad_ttl", "Expiry must be between 1 minute and 7 days.");
  }

  return { ciphertext, iv, salt: salt ?? null, hasPassphrase, ttlSeconds };
}

function validId(id: string | undefined): string {
  if (!id || !isBase64Url(id, ID_LENGTH) || id.length !== ID_LENGTH) throw gone();
  return id;
}

export function secretsRoutes(store: SecretStore) {
  const routes = new Hono();

  routes.post("/", async (c) => {
    const input = validateCreate(await readJson<unknown>(c));
    const codec = codecFor("e2e");
    const sealed = await codec.seal({
      ciphertext: input.ciphertext,
      iv: input.iv,
      ...(input.salt ? { salt: input.salt } : {}),
    });

    const burnToken = newBurnToken();
    const createdAt = nowSeconds();
    const expiresAt = createdAt + input.ttlSeconds;
    const id = newSecretId();

    await store.create({
      id,
      mode: "e2e",
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      salt: sealed.salt,
      wrappedKey: sealed.wrappedKey,
      hasPassphrase: input.hasPassphrase,
      ownerId: null,
      createdAt,
      expiresAt,
      burnTokenHash: await sha256Hex(burnToken),
    });

    return c.json<CreateSecretResponse>({ id, expiresAt, burnToken }, 201);
  });

  // Metadata only, and deliberately so: link previewers, mail scanners and
  // prefetchers all issue GETs. Nothing here consumes the secret.
  routes.get("/:id", async (c) => {
    const meta = await store.meta(validId(c.req.param("id")), nowSeconds());
    if (!meta) throw gone();
    return c.json<SecretMetaResponse>(meta);
  });

  // The only endpoint that returns the envelope, and it destroys it in the same
  // atomic statement. POST, so it takes a deliberate human action to trigger.
  routes.post("/:id/reveal", async (c) => {
    const burned = await store.burn(validId(c.req.param("id")), nowSeconds());
    if (!burned) throw gone();
    const envelope = await codecFor(burned.mode).open(burned);
    return c.json<RevealResponse>(envelope);
  });

  routes.delete("/:id", async (c) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new ApiError(401, "unauthorized", "A burn token is required.");
    // The stored value is a hash, and the comparison happens inside SQLite over a
    // 64-char hex digest, so a timing signal here reveals nothing about the token.
    const revoked = await store.revoke(validId(c.req.param("id")), await sha256Hex(token));
    if (!revoked) throw gone();
    return c.body(null, 204);
  });

  return routes;
}
