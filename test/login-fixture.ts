import { generateKeyPairSync, sign } from "node:crypto";
import type { JWTPayload } from "jose";
import { expect, vi } from "vitest";
import { LoginClient } from "../src/index";

export const ISSUER = "https://issuer.example.test", BASE = "https://region.example.test";
export const NONCE = "n".repeat(43);
export const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

export function loginFixture() {
  const pair = generateKeyPairSync("ed25519");
  const f = {
    privateKey: pair.privateKey,
    discovery: { issuer: ISSUER, jwks_uri: `${BASE}/oauth/v1/jwks.json`, id_token_signing_alg_values_supported: ["EdDSA"] },
    jwks: { keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "key1", alg: "EdDSA", use: "sig" }] },
    profile: { sub: "user1", name: "Test", phone_number: "+12025550123" } as Record<string, unknown>,
    response: undefined as Response | undefined,
  };
  const fetchImpl = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation(async (url, init) => {
    const headers = new Headers(init?.headers as HeadersInit);
    expect(init).toMatchObject({ redirect: "error", credentials: "omit" });
    expect(headers.get("cookie")).toBeNull();
    if (String(url).endsWith("/userinfo")) {
      expect(String(url)).toBe(`${BASE}/oauth/v1/userinfo`);
      expect(headers.get("authorization")).toBe("Bearer user-access");
      return json(f.profile);
    }
    expect(headers.get("authorization")).toBeNull();
    if (f.response) return f.response.clone();
    if (url === `${BASE}/.well-known/openid-configuration`) return json(f.discovery);
    expect(url).toBe(`${BASE}/oauth/v1/jwks.json`);
    return json(f.jwks);
  });
  const client = new LoginClient({ issuer: ISSUER, apiBaseUrl: BASE, clientIds: ["ios-client", "android-client"], fetch: fetchImpl });
  const token = async (claims: JWTPayload = {}, header: Record<string, unknown> = {}) => {
    const payload = { iss: ISSUER, sub: "user1", aud: ["ios-client"], azp: "ios-client", nonce: NONCE,
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, ...claims };
    const encoded = [ { alg: "EdDSA", typ: "JWT", kid: "key1", ...header }, payload ]
      .map(p => Buffer.from(JSON.stringify(p)).toString("base64url")).join(".");
    return `${encoded}.${sign(null, Buffer.from(encoded), f.privateKey).toString("base64url")}`;
  };
  return { f, fetchImpl, client, token };
}
