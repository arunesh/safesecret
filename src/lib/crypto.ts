import { MAX_PLAINTEXT_BYTES, type Envelope } from "../../shared/types.js";

/**
 * Browser-side encryption. The server never receives any of the key material
 * produced here.
 *
 * Key schedule:
 *
 *   linkKey     32 random bytes, base64url-encoded into the URL fragment. A
 *               fragment is never transmitted in an HTTP request, so neither the
 *               server nor any proxy between the two ever observes it.
 *
 *   passKey     optional. PBKDF2-SHA256(passphrase, salt, 600k). The salt is
 *               stored server-side; the passphrase is not, and never leaves the
 *               two humans who know it.
 *
 *   aesKey      HKDF-SHA256(ikm = linkKey ‖ passKey, salt, info) → AES-256-GCM.
 *
 * Deriving from the concatenation, rather than wrapping a data key, means a
 * passphrase-protected secret genuinely requires both factors: possessing the link
 * alone yields nothing to attack offline except AES-GCM itself.
 */

const HKDF_INFO = new TextEncoder().encode("safesecret/v1/aes-gcm");
const PBKDF2_ITERATIONS = 600_000;
const IV_BYTES = 12;
const SALT_BYTES = 16;
const LINK_KEY_BYTES = 32;

/** Decryption failed: wrong link, wrong passphrase, or tampered ciphertext. */
export class DecryptionError extends Error {
  constructor(message = "Unable to decrypt this secret.") {
    super(message);
    this.name = "DecryptionError";
  }
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function passphraseBytes(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    256,
  );
  return new Uint8Array(bits);
}

async function deriveAesKey(
  linkKey: Uint8Array,
  passphrase: string | null,
  salt: Uint8Array | null,
): Promise<CryptoKey> {
  let ikm = linkKey;
  if (passphrase !== null) {
    if (salt === null) throw new DecryptionError("A passphrase was supplied but this secret has no salt.");
    const passKey = await passphraseBytes(passphrase, salt);
    ikm = new Uint8Array(linkKey.length + passKey.length);
    ikm.set(linkKey, 0);
    ikm.set(passKey, linkKey.length);
  }

  const hkdfKey = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: (salt ?? new Uint8Array(0)) as BufferSource, info: HKDF_INFO as BufferSource },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface SealedSecret {
  envelope: Envelope;
  /** base64url link key. Belongs in the URL fragment and nowhere else. */
  linkKey: string;
}

export async function sealSecret(plaintext: string, passphrase?: string): Promise<SealedSecret> {
  const encoded = new TextEncoder().encode(plaintext);
  if (encoded.byteLength > MAX_PLAINTEXT_BYTES) {
    throw new Error(`Secret is too large (max ${MAX_PLAINTEXT_BYTES / 1024} KiB).`);
  }

  const linkKey = crypto.getRandomValues(new Uint8Array(LINK_KEY_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const salt = passphrase ? crypto.getRandomValues(new Uint8Array(SALT_BYTES)) : null;

  const key = await deriveAesKey(linkKey, passphrase ?? null, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, encoded as BufferSource);

  return {
    envelope: {
      ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
      iv: base64UrlEncode(iv),
      ...(salt ? { salt: base64UrlEncode(salt) } : {}),
    },
    linkKey: base64UrlEncode(linkKey),
  };
}

export async function openSecret(envelope: Envelope, linkKey: string, passphrase?: string): Promise<string> {
  let decrypted: ArrayBuffer;
  try {
    const salt = envelope.salt ? base64UrlDecode(envelope.salt) : null;
    const key = await deriveAesKey(base64UrlDecode(linkKey), passphrase ?? null, salt);
    decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlDecode(envelope.iv) as BufferSource },
      key,
      base64UrlDecode(envelope.ciphertext) as BufferSource,
    );
  } catch {
    // AES-GCM authenticates, so a wrong key, a wrong passphrase and a modified
    // ciphertext are one failure mode. Never guess which for the user.
    throw new DecryptionError();
  }
  return new TextDecoder().decode(decrypted);
}
