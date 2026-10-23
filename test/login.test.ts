import { generateKeyPairSync } from "node:crypto";
import { SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError, IDTokenError, InvalidResponseError, LoginClient, LoginKeySourceError } from "../src/index";

import { ISSUER, NONCE, json, loginFixture } from "./login-fixture";

afterEach(() => vi.useRealTimers());

describe("Login ID token", () => {
  it("verifies real signatures, coalesces key fetches and binds fresh phone to identity", async () => {
    const { f, client, token, fetchImpl } = loginFixture();
    const raw = await token();
    const results = await Promise.all(Array.from({ length: 20 }, () => client.verifyIdToken(raw, { nonce: NONCE })));
    expect(results[0]).toMatchObject({ issuer: ISSUER, sub: "user1", clientId: "ios-client", nonce: NONCE });
    expect(Object.isFrozen(results[0])).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const profile = await client.getUserInfo("user-access", { expectedSub: results[0]!.sub });
    expect(profile.phoneNumber).toBe("+12025550123");
    expect(profile.phoneNumberVerified).toBeUndefined();
    f.profile.sub = "other";
    await expect(client.getUserInfo("user-access", { expectedSub: "user1" })).rejects.toBeInstanceOf(InvalidResponseError);
  });

  it.each([
    { iss: "https://evil.test" }, { aud: "other" }, { aud: ["ios-client", "android-client"] },
    { azp: "android-client" }, { azp: undefined }, { sub: "" }, { sub: undefined },
    { nonce: "x".repeat(43) }, { nonce: undefined }, { token_use: "access" },
    { iat: 1, exp: 2 }, { iat: 9999999999, exp: 10000000000 },
    { exp: undefined }, { iat: 1.5 }, { nbf: 9999999999 },
  ])("rejects bad claims before network: %j", async claims => {
    const { client, token, fetchImpl } = loginFixture();
    await expect(client.verifyIdToken(await token(claims), { nonce: NONCE })).rejects.toBeInstanceOf(IDTokenError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([{ jku: "https://evil.test/keys" }, { jwk: {} }, { crit: [] }, { typ: "at+jwt" }, { kid: "" }])("rejects untrusted headers %j", async header => {
    const { client, token, fetchImpl } = loginFixture();
    await expect(client.verifyIdToken(await token({}, header), { nonce: NONCE })).rejects.toBeInstanceOf(IDTokenError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects wrong signatures and algorithms, rate-limits unknown kids and rotates keys", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { f, client, token, fetchImpl } = loginFixture();
    await client.verifyIdToken(await token(), { nonce: NONCE });
    const pair = generateKeyPairSync("ed25519"); f.privateKey = pair.privateKey;
    await expect(client.verifyIdToken(await token(), { nonce: NONCE })).rejects.toBeInstanceOf(IDTokenError);
    f.jwks.keys = [{ ...pair.publicKey.export({ format: "jwk" }), kid: "key2", alg: "EdDSA", use: "sig" }];
    const rotated = await token({}, { kid: "key2" });
    for (let i = 0; i < 10; i++) await expect(client.verifyIdToken(rotated, { nonce: NONCE })).rejects.toBeInstanceOf(IDTokenError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + 31_000);
    await client.verifyIdToken(rotated, { nonce: NONCE });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    vi.setSystemTime(Date.now() + 301_000); f.response = new Response("unavailable", { status: 503 });
    await expect(client.verifyIdToken(await token({}, { kid: "key2" }), { nonce: NONCE })).rejects.toBeInstanceOf(LoginKeySourceError);
    const hmac = await new SignJWT({}).setProtectedHeader({ alg: "HS256", kid: "key1", typ: "JWT" }).sign(new Uint8Array(32));
    await expect(client.verifyIdToken(hmac, { nonce: NONCE })).rejects.toBeInstanceOf(IDTokenError);
  });

  it.each(["issuer", "jwks", "duplicate", "private", "oversize", "redirect", "malformed", "bad-key"])("rejects bad discovery/JWKS: %s", async mode => {
    const { f, client, token } = loginFixture();
    if (mode === "issuer") f.discovery.issuer = "https://other.test";
    if (mode === "jwks") f.discovery.jwks_uri = "https://other.test/keys";
    if (mode === "duplicate") f.jwks.keys.push(f.jwks.keys[0]!);
    if (mode === "private") Object.assign(f.jwks.keys[0]!, { d: "secret" });
    if (mode === "bad-key") f.jwks.keys[0]!.x = "bad";
    if (mode === "oversize") f.response = json({ ignored: "x".repeat(65536) });
    if (mode === "redirect") f.response = new Response(null, { status: 302, headers: { location: "https://other.test", "content-type": "application/json" } });
    if (mode === "malformed") f.response = new Response("{", { headers: { "content-type": "application/json" } });
    await expect(client.verifyIdToken(await token(), { nonce: NONCE })).rejects.toBeInstanceOf(LoginKeySourceError);
  });

  it("rejects absent nonce, oversized or opaque tokens and aborted requests without HTTP", async () => {
    const { client, token, fetchImpl } = loginFixture();
    for (const raw of ["", "user-access", "a".repeat(8193), "eyJhbGciOiJub25lIn0.e30.eA"])
      await expect(client.verifyIdToken(raw, { nonce: NONCE })).rejects.toBeInstanceOf(IDTokenError);
    await expect(client.verifyIdToken(await token(), { nonce: "" })).rejects.toBeInstanceOf(IDTokenError);
    await expect(client.verifyIdToken(await token(), { nonce: NONCE, signal: AbortSignal.abort() })).rejects.toBeInstanceOf(IDTokenError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["", "http://public.test", "https://user:pass@example.test", `${ISSUER}/path`, `${ISSUER}/`, `${ISSUER}?`])("rejects unsafe config %s", issuer => {
    expect(() => new LoginClient({ issuer, clientIds: ["ios-client"] })).toThrow(ConfigError);
  });
});
