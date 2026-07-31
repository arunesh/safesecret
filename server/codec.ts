import type { Envelope, SecretMode } from "../shared/types.js";
import type { StoredSecret } from "./store/index.js";

/**
 * The crypto seam described in PLAN.md §3.2.
 *
 * In `e2e` mode — the only mode built today — the server's codec is the identity
 * function: the browser has already encrypted, and the server stores and returns
 * the envelope untouched. It cannot read what it holds.
 *
 * In `server` mode the same two functions do real AES-GCM with a key derived from
 * a Worker Secret, so that a logged-in user can read a stored secret from a device
 * that never had the URL fragment. Nothing else in the API, schema, burn logic or
 * UI differs between the two.
 */
export interface ServerCodec {
  seal(envelope: Envelope): Promise<{ ciphertext: string; iv: string; salt: string | null; wrappedKey: string | null }>;
  open(stored: StoredSecret): Promise<Envelope>;
}

export const identityCodec: ServerCodec = {
  async seal(envelope) {
    return {
      ciphertext: envelope.ciphertext,
      iv: envelope.iv,
      salt: envelope.salt ?? null,
      wrappedKey: null,
    };
  },

  async open(stored) {
    return {
      ciphertext: stored.ciphertext,
      iv: stored.iv,
      ...(stored.salt ? { salt: stored.salt } : {}),
    };
  },
};

export function codecFor(mode: SecretMode): ServerCodec {
  if (mode === "e2e") return identityCodec;
  // Deliberately unimplemented. Turning this on is the accounts feature, not a
  // toggle: it makes the operator able to read stored secrets, so it ships with
  // authentication, per-account key derivation, and explicit UI labelling.
  throw new Error("server-side mode is not implemented yet — see PLAN.md §3.2");
}
