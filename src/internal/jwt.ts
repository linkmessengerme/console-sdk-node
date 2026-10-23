import { createPrivateKey, randomBytes, sign as cryptoSign, type KeyObject } from "node:crypto";

import { ConfigError } from "../errors";

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** Parses + validates a PEM Ed25519 private key (throws ConfigError otherwise). */
export function loadEd25519PrivateKey(pem: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: pem, format: "pem" });
  } catch (err) {
    throw new ConfigError("credentials private_key is not valid PEM", { cause: err });
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw new ConfigError("credentials private_key must be an Ed25519 key");
  }
  return key;
}

/** Fail-fast validation at credential load (does not retain the key). */
export function assertEd25519PrivateKey(pem: string): void {
  loadEd25519PrivateKey(pem);
}

/**
 * Signs a compact EdDSA JWT (no `kid` — the client_assertion is verified against
 * the client's registered public key). Zero-dep: manual header.payload.signature
 * via node:crypto rather than an external JWT library.
 */
export function signEdDSAJWT(key: KeyObject, claims: Record<string, unknown>): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT" })));
  const payload = b64url(Buffer.from(JSON.stringify(claims)));
  const signingInput = `${header}.${payload}`;
  // Ed25519 requires the digest algorithm argument to be null.
  const sig = cryptoSign(null, Buffer.from(signingInput), key);
  return `${signingInput}.${b64url(sig)}`;
}

export function randomJti(): string {
  return b64url(randomBytes(16));
}
