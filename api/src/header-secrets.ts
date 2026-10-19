import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "./config.js";

function getKey() {
  if (!config.secretsKey || !/^[0-9a-fA-F]{64}$/.test(config.secretsKey)) {
    throw new Error(
      "SECRETS_KEY must be a 32-byte key encoded as 64 hex characters.",
    );
  }
  return Buffer.from(config.secretsKey, "hex");
}

export function encryptHeaderValue(value: string): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), nonce);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);

  // Binary format: version byte (1), 12-byte nonce, 16-byte tag, ciphertext.
  return Buffer.concat([
    Buffer.from([1]),
    nonce,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}

export function decryptHeaderValue(value: Buffer): string {
  if (value.length < 29 || value[0] !== 1) {
    throw new Error("Unsupported encrypted header format.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getKey(),
    value.subarray(1, 13),
  );
  decipher.setAuthTag(value.subarray(13, 29));
  return Buffer.concat([
    decipher.update(value.subarray(29)),
    decipher.final(),
  ]).toString("utf8");
}
