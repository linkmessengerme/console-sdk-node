/**
 * Error taxonomy.
 *
 * - {@link ConfigError} / {@link ValidationError} — thrown locally, before any
 *   request leaves the process (bad credentials, options, phone, code).
 * - {@link ApiError} and its subclasses — the gateway returned a non-2xx
 *   response. {@link AuthenticationError}, {@link IdempotencyError} and
 *   {@link RateLimitError} are specializations keyed off the error code.
 * - {@link ConnectionError} — the request never produced an HTTP response
 *   (network failure, timeout, abort).
 *
 * All errors extend {@link LinkError}, so `catch (e) { if (e instanceof LinkError) ... }`
 * captures everything this SDK throws.
 */

export type ErrorCode =
  | "INVALID_TOKEN"
  | "INSUFFICIENT_SCOPE"
  | "IDEMPOTENCY_KEY_CONFLICT"
  | "TOO_MANY_REQUESTS"
  // Forward-compatible: the gateway may introduce new codes.
  | (string & {});

/** Base class for every error thrown by the SDK. */
export abstract class LinkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions);
    this.name = new.target.name;
  }
}

/** Invalid credentials or client configuration. */
export class ConfigError extends LinkError {}

/** Invalid request input, including user tokens (thrown before I/O). */
export class ValidationError extends LinkError {}

/** Invalid UserInfo JSON, schema, size or subject; never includes raw response data. */
export class InvalidResponseError extends LinkError {}

export interface ApiErrorInit {
  statusCode: number;
  code?: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  requestId?: string;
}

/** The gateway returned a non-2xx HTTP status. */
export class ApiError extends LinkError {
  readonly statusCode: number;
  readonly code?: ErrorCode;
  readonly details?: Record<string, unknown>;
  /** Value of the `X-Request-Id` response header, when present. */
  readonly requestId?: string;

  constructor(init: ApiErrorInit) {
    super(formatApiMessage(init));
    this.statusCode = init.statusCode;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
  }
}

/** Bearer token rejected (`INVALID_TOKEN`, `INSUFFICIENT_SCOPE`). */
export class AuthenticationError extends ApiError {}

/** Idempotency key reused with a different payload (`IDEMPOTENCY_KEY_CONFLICT`). */
export class IdempotencyError extends ApiError {}

/** Rate limit exceeded (`TOO_MANY_REQUESTS`). */
export class RateLimitError extends ApiError {
  /** Raw `Retry-After` header value, if the gateway provided one. */
  readonly retryAfter?: string;

  constructor(init: ApiErrorInit & { retryAfter?: string }) {
    super(init);
    this.retryAfter = init.retryAfter;
  }
}

/** The request failed before an HTTP response (network error, timeout, abort). */
export class ConnectionError extends LinkError {}

function formatApiMessage(init: ApiErrorInit): string {
  if (!init.code) {
    return `link: API error (${init.statusCode}): ${init.message}`;
  }
  return `link: API error ${init.code} (${init.statusCode}): ${init.message}`;
}

export function isLinkError(err: unknown): err is LinkError {
  return err instanceof LinkError;
}
export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}
export function isAuthenticationError(err: unknown): err is AuthenticationError {
  return err instanceof AuthenticationError;
}
export function isIdempotencyError(err: unknown): err is IdempotencyError {
  return err instanceof IdempotencyError;
}
export function isRateLimitError(err: unknown): err is RateLimitError {
  return err instanceof RateLimitError;
}
export function isConnectionError(err: unknown): err is ConnectionError {
  return err instanceof ConnectionError;
}
export function isValidationError(err: unknown): err is ValidationError {
  return err instanceof ValidationError;
}
