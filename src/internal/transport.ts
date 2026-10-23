import {
  ApiError,
  AuthenticationError,
  ConnectionError,
  IdempotencyError,
  RateLimitError,
  type ApiErrorInit,
  type ErrorCode,
} from "../errors";
import type { FetchLike, RetryConfig } from "../options";
import { TokenSource } from "./token";

const HEADER_IDEMPOTENCY = "Idempotency-Key";

/** Cap on the response body we read, mirroring the Go SDK (1 MiB). */
const MAX_RESPONSE_BYTES = 1 << 20;

export interface TransportConfig {
  baseUrl: string;
  tokenUrl: string;
  clientId: string;
  issuer: string;
  privateKeyPem: string;
  scope: string;
  userAgent: string;
  timeoutMs: number;
  retry: RetryConfig;
  fetchImpl: FetchLike;
  /** Unix-seconds clock (injectable for tests). */
  now?: () => number;
}

export interface RequestParams {
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export class HttpTransport {
  private readonly baseUrl: string;
  private readonly tokens: TokenSource;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly retry: RetryConfig;
  private readonly fetchImpl: FetchLike;

  constructor(cfg: TransportConfig) {
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.userAgent = cfg.userAgent;
    this.timeoutMs = cfg.timeoutMs;
    this.retry = cfg.retry;
    this.fetchImpl = cfg.fetchImpl;
    this.tokens = new TokenSource({
      tokenUrl: cfg.tokenUrl,
      clientId: cfg.clientId,
      issuer: cfg.issuer,
      privateKeyPem: cfg.privateKeyPem,
      scope: cfg.scope,
      userAgent: cfg.userAgent,
      timeoutMs: cfg.timeoutMs,
      fetchImpl: cfg.fetchImpl,
      now: cfg.now,
    });
  }

  async doJSON<T>(
    method: string,
    path: string,
    body: unknown,
    params: RequestParams,
  ): Promise<T> {
    const bodyText = JSON.stringify(body ?? {});

    let attempts = 1;
    if (params.idempotencyKey && this.retry.maxRetries > 0) {
      attempts += this.retry.maxRetries;
    }

    let lastErr: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) {
        await sleep(this.backoff(attempt), params.signal);
      }
      try {
        return await this.doOnce<T>(method, path, bodyText, params);
      } catch (err) {
        lastErr = err;
        if (!isRetryable(err)) throw err;
      }
    }
    throw lastErr;
  }

  private async doOnce<T>(
    method: string,
    path: string,
    bodyText: string,
    params: RequestParams,
  ): Promise<T> {
    const token = await this.tokens.getToken(params.signal);
    let resp = await this.send(method, path, bodyText, token, params);

    // The token may have expired/been revoked between the proactive refresh and
    // use — re-mint once (Firebase model: re-sign with the on-backend private key).
    if (resp.status === 401) {
      this.tokens.invalidate();
      const fresh = await this.tokens.getToken(params.signal);
      if (fresh !== token) {
        await resp.body?.cancel().catch(() => {});
        resp = await this.send(method, path, bodyText, fresh, params);
      }
    }

    const text = await readBody(resp);
    if (!resp.ok) {
      throw decodeApiError(resp, text);
    }
    if (!text) {
      return undefined as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      throw new ConnectionError("failed to decode response body", { cause: err });
    }
  }

  private async send(
    method: string,
    path: string,
    bodyText: string,
    token: string,
    params: RequestParams,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": this.userAgent,
      Authorization: `Bearer ${token}`,
    };
    if (params.idempotencyKey) {
      headers[HEADER_IDEMPOTENCY] = params.idempotencyKey;
    }
    return this.fetchWithTimeout(
      this.buildUrl(path),
      { method, headers, body: bodyText },
      params.signal,
    );
  }

  private buildUrl(path: string): string {
    const url = new URL(this.baseUrl);
    url.pathname = joinPath(url.pathname, path);
    return url.toString();
  }

  /** Exponential backoff with full jitter on the upper half, matching the Go SDK. */
  private backoff(attempt: number): number {
    const base = this.retry.initialBackoffMs > 0 ? this.retry.initialBackoffMs : 100;
    const max = this.retry.maxBackoffMs > 0 ? this.retry.maxBackoffMs : 2_000;
    let delayMs = base * 2 ** (attempt - 1);
    if (delayMs > max || delayMs <= 0) delayMs = max;
    const half = delayMs / 2;
    return Math.floor(half + Math.random() * half);
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    externalSignal: AbortSignal | undefined,
  ): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const onExternalAbort = () => controller.abort(externalSignal?.reason);
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    if (externalSignal) {
      if (externalSignal.aborted) controller.abort(externalSignal.reason);
      else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }

    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (timedOut) {
        throw new ConnectionError(`request timed out after ${this.timeoutMs}ms`, { cause: err });
      }
      if (externalSignal?.aborted) {
        throw new ConnectionError("request was aborted", { cause: err });
      }
      throw new ConnectionError("network request failed", { cause: err });
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof ConnectionError) return true;
  if (err instanceof ApiError) {
    switch (err.statusCode) {
      case 408:
      case 429:
      case 500:
      case 502:
      case 503:
      case 504:
        return true;
      case 409:
        return (
          err.code === "IDEMPOTENCY_KEY_CONFLICT" &&
          err.details?.["reason"] === "request_in_progress"
        );
      default:
        return false;
    }
  }
  return false;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

function decodeApiError(resp: Response, text: string): ApiError {
  const requestId = resp.headers.get("x-request-id") ?? undefined;
  let code: ErrorCode | undefined;
  let message = resp.statusText || `HTTP ${resp.status}`;
  let details: Record<string, unknown> | undefined;

  if (text) {
    try {
      const env = JSON.parse(text) as ErrorEnvelope;
      if (env.error?.code) {
        code = env.error.code;
        message = env.error.message ?? message;
        details = env.error.details;
      }
    } catch {
      // Non-JSON error body — keep the HTTP status text.
    }
  }

  const init: ApiErrorInit = { statusCode: resp.status, code, message, details, requestId };
  switch (code) {
    case "INVALID_TOKEN":
    case "INSUFFICIENT_SCOPE":
      return new AuthenticationError(init);
    case "IDEMPOTENCY_KEY_CONFLICT":
      return new IdempotencyError(init);
    case "TOO_MANY_REQUESTS":
      return new RateLimitError({ ...init, retryAfter: resp.headers.get("retry-after") ?? undefined });
    default:
      return new ApiError(init);
  }
}

async function readBody(resp: Response): Promise<string> {
  try {
    const text = await resp.text();
    return text.length > MAX_RESPONSE_BYTES ? text.slice(0, MAX_RESPONSE_BYTES) : text;
  } catch (err) {
    throw new ConnectionError("failed to read response body", { cause: err });
  }
}

function joinPath(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = `/${path.replace(/^\/+/, "")}`;
  return b ? b + p : p;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new ConnectionError("request was aborted", { cause: signal?.reason }));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(new ConnectionError("request was aborted", { cause: signal.reason }));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
