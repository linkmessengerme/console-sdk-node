import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  ApiError, AuthenticationError, ConfigError, ConnectionError, ConsoleClient,
  InvalidResponseError, RateLimitError, ValidationError,
} from "../src/index";

const BASE = "https://regional-api.example.test";
const MINI_TOKEN = `ma_${"x".repeat(43)}`;
const PEM = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

function client(fetchImpl: typeof fetch, options = {}) {
  return new ConsoleClient({
    clientId: "lk_client_test01", privateKey: PEM, baseUrl: BASE,
    fetch: fetchImpl, ...options,
  });
}

describe("UserInfo", () => {
  it("uses the configured origin and user bearer, maps both products without an app-token request", async () => {
    const fetchImpl = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(json({ sub: "u1", name: "Alex", preferred_username: "alex", picture: "https://img.example.test/a", phone_number: "+12025550123", phone_number_verified: false }))
      .mockResolvedValueOnce(json({ sub: "u1", profile: { name: "Alex", username: "alex", avatar_url: "https://img.example.test/a" }, phone_number: "+12025550123" }));
    const sdk = client(fetchImpl);
    const login = await sdk.login.getUserInfo("user-access-token", { expectedSub: "u1" });
    const mini = await sdk.miniApps.getUserInfo(MINI_TOKEN, { expectedSub: "u1" });
    expect(login).toMatchObject({ sub: "u1", name: "Alex", preferredUsername: "alex", picture: "https://img.example.test/a", phoneNumber: "+12025550123", phoneNumberVerified: false });
    expect(mini).toMatchObject({ sub: "u1", profile: { name: "Alex", username: "alex", avatarUrl: "https://img.example.test/a" }, phoneNumber: "+12025550123" });
    expect(mini.phoneNumberVerified).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [i, [url, init]] of fetchImpl.mock.calls.entries()) {
      expect(url).toBe(`${BASE}/${i === 0 ? "oauth" : "miniapps"}/v1/userinfo`);
      expect(init).toMatchObject({ method: "GET", redirect: "error", credentials: "omit", cache: "no-store" });
      const headers = new Headers(init?.headers as HeadersInit);
      expect(headers.get("authorization")).toBe(`Bearer ${i === 0 ? "user-access-token" : MINI_TOKEN}`);
      expect(headers.get("cache-control")).toBe("no-store");
      expect(headers.get("cookie")).toBeNull();
      expect(init?.body).toBeUndefined();
    }
  });

  it("does not cache phone data or infer verification after scope removal", async () => {
    const fetchImpl = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(json({ sub: "u1", phone_number: "+12025550123", phone_number_verified: true }))
      .mockResolvedValueOnce(json({ sub: "u1", phone_number_verified: true }));
    const sdk = client(fetchImpl);
    expect((await sdk.login.getUserInfo("token")).phoneNumberVerified).toBe(true);
    const fresh = await sdk.login.getUserInfo("token");
    expect(fresh.phoneNumber).toBeUndefined();
    expect(fresh.phoneNumberVerified).toBeUndefined();
    expect(fresh.name).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("isolates concurrent users on one client and leaves the OTP token cache intact", async () => {
    const fetchImpl = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      const bearer = new Headers(init?.headers as HeadersInit).get("authorization");
      if (path === "/oauth/v1/token") return json({ access_token: "app-token", token_type: "Bearer", expires_in: 900 });
      if (path === "/sdk/v1/otp/send") {
        expect(bearer).toBe("Bearer app-token");
        return json({ request_id: "r1", phone: "+12025550123", status: "queued" });
      }
      await Promise.resolve();
      return json({ sub: bearer?.slice(7) });
    });
    const sdk = client(fetchImpl);
    await sdk.otp.send({ phone: "+12025550123", code: "123456" });
    const results = await Promise.all(["alice", "bob"].map(token => sdk.login.getUserInfo(token, { expectedSub: token })));
    expect(results.map(info => info.sub)).toEqual(["alice", "bob"]);
    await sdk.otp.send({ phone: "+12025550123", code: "123456" });
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/token"))).toHaveLength(1);
  });

  it.each([[401, AuthenticationError], [403, AuthenticationError], [429, RateLimitError], [503, ApiError], [302, ApiError]] as const)(
    "returns a sanitized %i error without retrying or obtaining an app token", async (status, ErrorType) => {
      const fetchImpl = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(new Response("secret-token +12025550123", {
        status, headers: { location: "https://elsewhere.example.test" },
      }));
      const error = await client(fetchImpl).login.getUserInfo("secret-token").catch(e => e);
      expect(error).toBeInstanceOf(ErrorType);
      expect(error.statusCode).toBe(status);
      expect(String(error)).not.toContain("secret-token");
      expect(String(error)).not.toContain("+12025550123");
      expect(error.cause).toBeUndefined();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    {}, { sub: 123 }, { sub: "different-user" }, { sub: "u1", phone_number: 123 },
    { sub: "u1", phone_number: "12025550123" }, { sub: "u1", phone_number_verified: "true" },
    { sub: "u1", name: {} }, [], null,
  ])("rejects invalid Login data or a different subject (%j)", async body => {
    const sdk = client(vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(json(body)));
    await expect(sdk.login.getUserInfo("token", { expectedSub: "u1" })).rejects.toBeInstanceOf(InvalidResponseError);
  });

  it.each([{ profile: [] }, { profile: { avatar_url: 123 } }])("validates Mini App profile (%j)", async data => {
    const sdk = client(vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(json({ sub: "u1", ...data })));
    await expect(sdk.miniApps.getUserInfo(MINI_TOKEN)).rejects.toBeInstanceOf(InvalidResponseError);
  });

  it.each([
    new Response("not json", { headers: { "content-type": "application/json" } }),
    new Response('{"sub":"u1"}', { headers: { "content-type": "text/html" } }),
    new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }),
    json({ sub: "u1", extra: "x".repeat(64 * 1024) }),
    new Response('{"sub":"u1"}', { headers: { "content-type": "application/json", "content-length": "65537" } }),
  ])("rejects malformed or oversized response bytes", async response => {
    await expect(client(vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(response)).login.getUserInfo("token")).rejects.toBeInstanceOf(InvalidResponseError);
  });

  it.each(["http://api.example.test", "https://user:password@api.example.test", `${BASE}/prefix`, `${BASE}?key=secret`, `${BASE}#fragment`])(
    "rejects unsafe API configuration before I/O: %s", async baseUrl => {
      const fetchImpl = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
      await expect(Promise.resolve().then(() => client(fetchImpl, { baseUrl }).login.getUserInfo("token"))).rejects.toBeInstanceOf(ConfigError);
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("validates token and expected subject before I/O", async () => {
    const fetchImpl = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
    const sdk = client(fetchImpl);
    for (const token of ["", "Bearer token", "token\r\nHeader: value", "x".repeat(8193)]) {
      await expect(sdk.login.getUserInfo(token)).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(sdk.login.getUserInfo("token", { expectedSub: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(sdk.miniApps.getUserInfo("oauth-token")).rejects.toBeInstanceOf(ValidationError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sanitizes network errors", async () => {
    const fetchImpl = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockRejectedValue(new Error("secret-token +12025550123"));
    const error = await client(fetchImpl).login.getUserInfo("secret-token").catch(e => e);
    expect(error).toBeInstanceOf(ConnectionError);
    expect(String(error)).not.toContain("secret-token");
    expect(error.cause).toBeUndefined();
  });

  it("keeps the original expected subject when callers reuse their options", async () => {
    const options = { expectedSub: "alice" };
    const fetchImpl = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation(async () => {
      options.expectedSub = "bob";
      return json({ sub: "bob" });
    });
    await expect(client(fetchImpl).login.getUserInfo("token", options)).rejects.toBeInstanceOf(InvalidResponseError);
  });

  it("supports timeout and caller cancellation", async () => {
    const fetchImpl = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation(async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    await expect(client(fetchImpl, { timeoutMs: 5 }).login.getUserInfo("token")).rejects.toThrow("timed out");
    const controller = new AbortController();
    const pending = client(fetchImpl).login.getUserInfo("token", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ConnectionError);
    await expect(client(fetchImpl).login.getUserInfo("token", { signal: controller.signal })).rejects.toThrow("cancelled");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
