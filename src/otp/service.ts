import { ValidationError } from "../errors";
import { isValidIdempotencyKey, newIdempotencyKey } from "../internal/idempotency";
import type { HttpTransport, RequestParams } from "../internal/transport";
import { normalizePhone, validateCode } from "../validation";
import type { SendRequest, SendResponse } from "./types";

const SEND_PATH = "/sdk/v1/otp/send";

export interface SendOptions {
  /**
   * Idempotency key for safe retries. Auto-generated (UUID v4) when omitted —
   * pass your own to deduplicate across process restarts.
   */
  idempotencyKey?: string;
  /** Abort signal to cancel the request (and any in-flight retry backoff). */
  signal?: AbortSignal;
}

// Wire DTOs (snake_case) — kept internal; the public API is camelCase.
interface WireSendRequest {
  phone: string;
  code: string;
  locale?: string;
  template_id?: string;
  variables?: Record<string, string>;
}
interface WireSendResponse {
  request_id?: string;
  phone?: string;
  status?: string;
  template_used?: string;
  locale_used?: string;
}

/** OTP delivery API (`client.otp`). */
export class OtpService {
  constructor(private readonly transport: HttpTransport) {}

  /**
   * Sends an OTP code to a phone via the Link bot.
   *
   * @throws {@link ValidationError} for an invalid phone, code or idempotency key.
   * @throws {@link AuthenticationError} when the API key/signature is rejected.
   * @throws {@link RateLimitError} when rate-limited.
   * @throws {@link ApiError} for other non-2xx responses.
   * @throws {@link ConnectionError} on network failure, timeout or abort.
   */
  async send(request: SendRequest, options: SendOptions = {}): Promise<SendResponse> {
    const phone = normalizePhone(request.phone);
    const code = validateCode(request.code);
    const idempotencyKey = resolveIdempotencyKey(options.idempotencyKey);

    const body: WireSendRequest = { phone, code };
    const locale = request.locale?.trim();
    if (locale) body.locale = locale;
    const templateId = request.templateId?.trim();
    if (templateId) body.template_id = templateId;
    if (request.variables && Object.keys(request.variables).length > 0) {
      body.variables = request.variables;
    }

    const params: RequestParams = { idempotencyKey, signal: options.signal };
    const wire = await this.transport.doJSON<WireSendResponse>("POST", SEND_PATH, body, params);

    return {
      requestId: wire.request_id ?? "",
      phone: wire.phone || phone,
      status: wire.status ?? "",
      templateUsed: wire.template_used,
      localeUsed: wire.locale_used,
    };
  }
}

function resolveIdempotencyKey(key: string | undefined): string {
  const trimmed = key?.trim();
  if (!trimmed) return newIdempotencyKey();
  if (!isValidIdempotencyKey(trimmed)) {
    throw new ValidationError(
      "idempotency key must be 1-255 characters of letters, digits, underscore, dash or colon",
    );
  }
  return trimmed;
}
