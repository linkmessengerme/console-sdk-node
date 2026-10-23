import { generateKeyPairSync, verify as cryptoVerify } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ConfigError } from "../src/errors";
import { loadEd25519PrivateKey, signEdDSAJWT } from "../src/internal/jwt";

describe("jwt", () => {
  it("signs an EdDSA JWT verifiable by the matching public key", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

    const key = loadEd25519PrivateKey(pem);
    const jwt = signEdDSAJWT(key, { iss: "lk_client_x", aud: "https://as.example", exp: 9999999999 });

    const [h, p, s] = jwt.split(".");
    expect(h && p && s).toBeTruthy();
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({ alg: "EdDSA", typ: "JWT" });
    expect(JSON.parse(Buffer.from(p!, "base64url").toString()).iss).toBe("lk_client_x");

    // The gateway/console_login verifies exactly this: EdDSA over header.payload.
    const ok = cryptoVerify(null, Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s!, "base64url"));
    expect(ok).toBe(true);
  });

  it("rejects a malformed or non-Ed25519 private key", () => {
    expect(() => loadEd25519PrivateKey("not-a-pem")).toThrow(ConfigError);
    const rsaPem = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    expect(() => loadEd25519PrivateKey(rsaPem)).toThrow(ConfigError);
  });
});
