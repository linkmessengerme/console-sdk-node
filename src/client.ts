import { readFileSync } from "node:fs";

import {
  fromClientKey,
  parseCredentials,
  type Credentials,
  type CredentialsFile,
} from "./credentials";
import { ConfigError } from "./errors";
import { HttpTransport } from "./internal/transport";
import {
  DEFAULT_TIMEOUT_MS,
  resolveRetry,
  resolveUserAgent,
  type ClientOptions,
} from "./options";
import { OtpService } from "./otp/service";
import { UserInfoTransport } from "./internal/userinfo";
import { LoginService, MiniAppsService } from "./userinfo/service";

// App tokens serve OTP. UserInfo receives its own user token per call.
const SCOPE_OTP = "otp";

export interface ClientConfig extends ClientOptions {
  /** OAuth client id from your key-file, e.g. `lk_client_xxxxxxxx`. */
  clientId: string;
  /** PEM (PKCS#8 Ed25519) private key — your key-file's `private_key`. */
  privateKey: string;
  /**
   * API base URL — the `api_base_url` from your key. Required here;
   * `fromKeyFile` / `fromCredentialsJSON` read it from the key for you.
   */
  baseUrl: string;
  /** Token endpoint. Defaults to `${baseUrl}/oauth/v1/token`. */
  tokenUrl?: string;
  /** client_assertion audience (Authorization Server issuer). Defaults to `baseUrl`. */
  issuer?: string;
}

/**
 * Entry point for the Link Console API.
 *
 * ```ts
 * const client = ConsoleClient.fromKeyFile("link-oauth-client.json");
 * await client.otp.send({ phone: "+12025550123", code: "123456" });
 * ```
 */
export class ConsoleClient {
  /** OTP delivery API. */
  readonly otp: OtpService;
  readonly login: LoginService;
  readonly miniApps: MiniAppsService;

  constructor(config: ClientConfig) {
    const baseUrl = normalizeBaseUrl(config.baseUrl);
    if (!baseUrl) {
      throw new ConfigError(
        "baseUrl is required — use ConsoleClient.fromKeyFile / fromCredentialsJSON, " +
          "or pass the api_base_url from your key",
      );
    }
    const creds = fromClientKey(config.clientId, config.privateKey, baseUrl);
    if (config.tokenUrl) creds.tokenUrl = config.tokenUrl.trim();
    if (config.issuer) creds.issuer = config.issuer.trim();
    this.otp = new OtpService(buildTransport(creds, config));
    const users = new UserInfoTransport({
      baseUrl, fetchImpl: config.fetch ?? globalThis.fetch,
      timeoutMs: config.timeoutMs && config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_TIMEOUT_MS,
      userAgent: resolveUserAgent(config.userAgentSuffix),
    });
    this.login = new LoginService(users);
    this.miniApps = new MiniAppsService(users);
  }

  /** Loads credentials from a downloaded key file (`*.json`). */
  static fromKeyFile(path: string, options: ClientOptions = {}): ConsoleClient {
    let data: string;
    try {
      data = readFileSync(path, "utf8");
    } catch (err) {
      throw new ConfigError(`failed to read credentials file: ${path}`, { cause: err });
    }
    return ConsoleClient.fromCredentialsJSON(data, options);
  }

  /** Builds a client from key-file JSON (string or already-parsed object). */
  static fromCredentialsJSON(
    data: string | CredentialsFile,
    options: ClientOptions = {},
  ): ConsoleClient {
    const creds = parseCredentials(data);
    const override = normalizeBaseUrl(options.baseUrl);
    const baseUrl = override ?? creds.apiBaseUrl;
    // An override changes where requests go (api_base_url + token_url); the
    // issuer (token audience = AS identity) stays from the key-file.
    const tokenUrl = override ? `${baseUrl}/oauth/v1/token` : creds.tokenUrl;
    return new ConsoleClient({
      ...options,
      clientId: creds.clientId,
      privateKey: creds.privateKeyPem,
      baseUrl,
      tokenUrl,
      issuer: creds.issuer,
    });
  }
}

function buildTransport(creds: Credentials, options: ClientOptions): HttpTransport {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new ConfigError(
      "global fetch is unavailable — pass options.fetch or run on Node >= 18",
    );
  }
  const timeoutMs =
    options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS;

  return new HttpTransport({
    baseUrl: creds.apiBaseUrl,
    tokenUrl: creds.tokenUrl,
    clientId: creds.clientId,
    issuer: creds.issuer,
    privateKeyPem: creds.privateKeyPem,
    scope: SCOPE_OTP,
    userAgent: resolveUserAgent(options.userAgentSuffix),
    timeoutMs,
    retry: resolveRetry(options.retry),
    fetchImpl,
  });
}

function normalizeBaseUrl(url: string | undefined): string | undefined {
  const trimmed = url?.trim().replace(/\/+$/, "");
  return trimmed ? trimmed : undefined;
}
