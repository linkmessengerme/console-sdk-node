import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { fromClientKey, parseCredentials } from "../src/credentials";
import { ConfigError } from "../src/errors";

function testKeyPem(): string {
  const { privateKey } = generateKeyPairSync("ed25519");
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

const PEM = testKeyPem();

function validFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "link_oauth_client",
    client_id: "lk_client_test01",
    private_key: PEM,
    api_base_url: "https://api-sdk.example.test",
    token_url: "https://api-sdk.example.test/oauth/v1/token",
    issuer: "https://api-sdk.example.test",
    environment: "live",
    project_id: "11111111-1111-1111-1111-111111111111",
    ...overrides,
  };
}

describe("fromClientKey", () => {
  it("accepts a valid client + key and derives token_url/issuer", () => {
    const c = fromClientKey("lk_client_test01", PEM, "https://api-sdk.example.test");
    expect(c.clientId).toBe("lk_client_test01");
    expect(c.tokenUrl).toBe("https://api-sdk.example.test/oauth/v1/token");
    expect(c.issuer).toBe("https://api-sdk.example.test");
  });

  it("rejects a malformed private key or URL", () => {
    expect(() => fromClientKey("lk_client_test01", "not-a-pem", "https://api-sdk.example.test")).toThrow(
      ConfigError,
    );
    expect(() => fromClientKey("lk_client_test01", PEM, "ftp://x")).toThrow(ConfigError);
    expect(() => fromClientKey("", PEM, "https://api-sdk.example.test")).toThrow(ConfigError);
  });
});

describe("parseCredentials", () => {
  it("parses a valid key file (string or object)", () => {
    expect(parseCredentials(validFile()).clientId).toBe("lk_client_test01");
    expect(parseCredentials(JSON.stringify(validFile())).issuer).toBe("https://api-sdk.example.test");
  });

  it("derives token_url and issuer from api_base_url when absent", () => {
    const c = parseCredentials(validFile({ token_url: undefined, issuer: undefined }));
    expect(c.tokenUrl).toBe("https://api-sdk.example.test/oauth/v1/token");
    expect(c.issuer).toBe("https://api-sdk.example.test");
  });

  it("enforces required fields", () => {
    expect(() => parseCredentials(validFile({ type: "service_key" }))).toThrow(ConfigError);
    expect(() => parseCredentials(validFile({ client_id: "" }))).toThrow(ConfigError);
    expect(() =>
      parseCredentials(validFile({ api_base_url: undefined, token_url: undefined, issuer: undefined })),
    ).toThrow(ConfigError);
    expect(() => parseCredentials("{ not json")).toThrow(ConfigError);
  });

  it("does not leak private key material in errors", () => {
    const bad = "totally-not-a-pem-private-key";
    try {
      parseCredentials(validFile({ private_key: bad }));
      throw new Error("expected ConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).not.toContain(bad);
    }
  });
});
