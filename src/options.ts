import { VERSION } from "./version";

/** Default per-request timeout (milliseconds). */
export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Automatic retry policy. Retries apply **only** to requests that carry an
 * idempotency key (the SDK attaches one automatically) and only to transient
 * failures — network errors, timeouts, 408/429/5xx, and the
 * "request in progress" idempotency conflict.
 */
export interface RetryConfig {
  /** Max retries after the first attempt. `<= 0` disables retries. */
  maxRetries: number;
  /** Initial backoff before the first retry (ms). */
  initialBackoffMs: number;
  /** Upper bound on a single backoff (ms). */
  maxBackoffMs: number;
}

export const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 2,
  initialBackoffMs: 100,
  maxBackoffMs: 2_000,
};

/** A `fetch`-compatible implementation (defaults to the global `fetch`). */
export type FetchLike = typeof fetch;

/** Options shared by every client constructor. */
export interface ClientOptions {
  /** Override the API base URL (e.g. a staging host). */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Default {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Retry policy. Pass `false` to disable retries entirely. */
  retry?: Partial<RetryConfig> | false;
  /** Appended to the default `User-Agent` (e.g. your app name/version). */
  userAgentSuffix?: string;
  /** Inject a custom `fetch` (proxy agent, instrumentation, tests). */
  fetch?: FetchLike;
}

export function resolveUserAgent(suffix?: string): string {
  const base = `link-console-sdk-node/${VERSION}`;
  const trimmed = suffix?.trim();
  return trimmed ? `${base} ${trimmed}` : base;
}

export function resolveRetry(retry: ClientOptions["retry"]): RetryConfig {
  if (retry === false) {
    return { ...DEFAULT_RETRY, maxRetries: -1 };
  }
  if (!retry) {
    return { ...DEFAULT_RETRY };
  }
  return {
    maxRetries: retry.maxRetries ?? DEFAULT_RETRY.maxRetries,
    initialBackoffMs:
      retry.initialBackoffMs && retry.initialBackoffMs > 0
        ? retry.initialBackoffMs
        : DEFAULT_RETRY.initialBackoffMs,
    maxBackoffMs:
      retry.maxBackoffMs && retry.maxBackoffMs > 0
        ? retry.maxBackoffMs
        : DEFAULT_RETRY.maxBackoffMs,
  };
}
