import { describe, expect, it } from "vitest";
import { DecryptionError, base64UrlDecode, base64UrlEncode, openSecret, sealSecret } from "../src/lib/crypto.js";

describe("base64url", () => {
  it("round-trips arbitrary bytes without padding characters", () => {
    for (let length = 0; length < 40; length++) {
      const bytes = crypto.getRandomValues(new Uint8Array(length));
      const encoded = base64UrlEncode(bytes);
      expect(encoded).not.toMatch(/[+/=]/);
      expect([...base64UrlDecode(encoded)]).toEqual([...bytes]);
    }
  });
});

describe("sealSecret / openSecret", () => {
  it("round-trips a secret", async () => {
    const { envelope, linkKey } = await sealSecret("correct horse battery staple");
    expect(await openSecret(envelope, linkKey)).toBe("correct horse battery staple");
  });

  it("round-trips unicode and newlines intact", async () => {
    const plaintext = "line one\nline two\t🔐 café — ünïcode";
    const { envelope, linkKey } = await sealSecret(plaintext);
    expect(await openSecret(envelope, linkKey)).toBe(plaintext);
  });

  it("produces a fresh key and IV for identical plaintext", async () => {
    const a = await sealSecret("same");
    const b = await sealSecret("same");
    expect(a.linkKey).not.toBe(b.linkKey);
    expect(a.envelope.iv).not.toBe(b.envelope.iv);
    expect(a.envelope.ciphertext).not.toBe(b.envelope.ciphertext);
  });

  it("omits the salt when there is no passphrase", async () => {
    const { envelope } = await sealSecret("no passphrase");
    expect(envelope.salt).toBeUndefined();
  });

  it("fails closed on the wrong link key", async () => {
    const { envelope } = await sealSecret("secret");
    const wrongKey = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
    await expect(openSecret(envelope, wrongKey)).rejects.toThrow(DecryptionError);
  });

  it("fails closed on tampered ciphertext", async () => {
    const { envelope, linkKey } = await sealSecret("secret");
    const bytes = base64UrlDecode(envelope.ciphertext);
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    const tampered = { ...envelope, ciphertext: base64UrlEncode(bytes) };
    await expect(openSecret(tampered, linkKey)).rejects.toThrow(DecryptionError);
  });

  it("fails closed on a tampered IV", async () => {
    const { envelope, linkKey } = await sealSecret("secret");
    const iv = base64UrlDecode(envelope.iv);
    iv[0] = (iv[0] ?? 0) ^ 0xff;
    await expect(openSecret({ ...envelope, iv: base64UrlEncode(iv) }, linkKey)).rejects.toThrow(DecryptionError);
  });
});

describe("passphrase protection", () => {
  it("round-trips with the correct passphrase", async () => {
    const { envelope, linkKey } = await sealSecret("vault code 1234", "hunter2");
    expect(envelope.salt).toBeTypeOf("string");
    expect(await openSecret(envelope, linkKey, "hunter2")).toBe("vault code 1234");
  });

  it("requires the passphrase even with the correct link key", async () => {
    const { envelope, linkKey } = await sealSecret("vault code 1234", "hunter2");
    await expect(openSecret(envelope, linkKey)).rejects.toThrow(DecryptionError);
    await expect(openSecret(envelope, linkKey, "wrong")).rejects.toThrow(DecryptionError);
  });

  it("requires the link key even with the correct passphrase", async () => {
    const { envelope } = await sealSecret("vault code 1234", "hunter2");
    const wrongKey = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
    await expect(openSecret(envelope, wrongKey, "hunter2")).rejects.toThrow(DecryptionError);
  });
});
