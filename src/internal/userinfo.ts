import {
  ApiError, AuthenticationError, ConfigError, ConnectionError,
  InvalidResponseError, RateLimitError, ValidationError,
} from "../errors";
import type { FetchLike } from "../options";
import type { UserInfoOptions } from "../userinfo/types";

const MAX_BYTES = 64 * 1024;
export type UserInfoProduct = "login" | "miniapps";
export interface UserInfoConfig {
  baseUrl: string;
  fetchImpl: FetchLike;
  timeoutMs: number;
  userAgent: string;
}

function endpoint(base: string, product: UserInfoProduct): string {
  try {
    const url = new URL(base);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (/[\s\\]/.test(base) || url.username || url.password || url.search || url.hash ||
        url.pathname !== "/" || !(url.protocol === "https:" || (url.protocol === "http:" && local))) {
      throw new Error();
    }
    return `${url.origin}/${product === "login" ? "oauth" : "miniapps"}/v1/userinfo`;
  } catch { throw new ConfigError("UserInfo requires a trusted HTTPS API origin (HTTP only on loopback)"); }
}

function validate(token: string, product: UserInfoProduct, expectedSub?: string): void {
  if (typeof token !== "string" || !token || token.length > 8192 ||
      !/^[A-Za-z0-9._~+\/-]+=*$/.test(token) ||
      (product === "miniapps" && !/^ma_[A-Za-z0-9_-]{43}$/.test(token))) {
    throw new ValidationError("a valid user access token is required");
  }
  if (expectedSub !== undefined && (typeof expectedSub !== "string" || !expectedSub || expectedSub.length > 255)) {
    throw new ValidationError("expectedSub must be a non-empty subject");
  }
}

function statusError(statusCode: number): ApiError {
  const init = { statusCode, message: "UserInfo request failed" };
  if (statusCode === 401 || statusCode === 403) {
    return new AuthenticationError({ ...init, code: statusCode === 401 ? "INVALID_TOKEN" : "INSUFFICIENT_SCOPE" });
  }
  if (statusCode === 429) return new RateLimitError({ ...init, code: "TOO_MANY_REQUESTS" });
  return new ApiError(init);
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidResponseError("invalid UserInfo response");
  return value as Record<string, unknown>;
}

export function optionalString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  if (value == null) return undefined;
  if (typeof value !== "string") throw new InvalidResponseError("invalid UserInfo response");
  return value;
}

/** User-supplied bearer only: no app-token source, retries or shared user state. */
export class UserInfoTransport {
  constructor(private readonly config: UserInfoConfig) {}

  async get(product: UserInfoProduct, token: string, options: UserInfoOptions): Promise<Record<string, unknown>> {
    const { expectedSub, signal } = options;
    validate(token, product, expectedSub);
    const url = endpoint(this.config.baseUrl, product);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal?.aborted) throw new ConnectionError("UserInfo request cancelled");
    signal?.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.config.timeoutMs);
    try {
      const request: RequestInit & { cache: "no-store" } = {
        method: "GET", headers: {
          Authorization: `Bearer ${token}`, Accept: "application/json",
          "Cache-Control": "no-store", "User-Agent": this.config.userAgent,
        },
        redirect: "error", credentials: "omit", cache: "no-store", signal: controller.signal,
      };
      const response = await this.config.fetchImpl(url, request);
      if (response.redirected || (response.url && response.url !== url)) throw new InvalidResponseError("unexpected UserInfo response URL");
      if (response.status !== 200) throw statusError(response.status);
      if (response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json" ||
          Number(response.headers.get("content-length")) > MAX_BYTES || !response.body) {
        throw new InvalidResponseError("invalid UserInfo response");
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES) throw new InvalidResponseError("UserInfo response is too large");
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      let parsed: unknown;
      try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { throw new InvalidResponseError("invalid UserInfo response"); }
      const data = object(parsed);
      if (typeof data.sub !== "string" || !data.sub || data.sub.length > 255 ||
          (expectedSub !== undefined && data.sub !== expectedSub)) {
        throw new InvalidResponseError("UserInfo subject is missing or does not match");
      }
      if (controller.signal.aborted) throw new ConnectionError("UserInfo request cancelled");
      return data;
    } catch (error) {
      if (error instanceof ApiError || error instanceof InvalidResponseError || error instanceof ConnectionError) throw error;
      throw new ConnectionError(timedOut ? "UserInfo request timed out" : "UserInfo request failed");
    } finally {
      clearTimeout(timer); signal?.removeEventListener("abort", onAbort); controller.abort();
    }
  }
}
