/**
 * Official Node.js / TypeScript SDK for the Link Developer Platform (Console API).
 *
 * @example
 * ```ts
 * import { ConsoleClient } from "@link-apps/console-sdk";
 *
 * const client = ConsoleClient.fromKeyFile("link-oauth-client.json");
 * const res = await client.otp.send({ phone: "+12025550123", code: "123456" });
 * console.log(res.requestId, res.status);
 * ```
 */

export { ConsoleClient } from "./client";
export type { ClientConfig } from "./client";

export { DEFAULT_RETRY, DEFAULT_TIMEOUT_MS } from "./options";
export type { ClientOptions, FetchLike, RetryConfig } from "./options";

export { OtpService } from "./otp/service";
export type { SendOptions } from "./otp/service";
export { Locale } from "./otp/types";
export type { SendRequest, SendResponse } from "./otp/types";
export { PaymentsService } from "./payments/service";
export type { PaymentOptions } from "./payments/service";
export * from "./payments/types";
export { LoginService, MiniAppsService } from "./userinfo/service";
export type { UserInfo, LoginUserInfo, MiniAppUserInfo, MiniAppProfile, UserInfoOptions } from "./userinfo/types";
export { LoginClient, IDTokenError, LoginKeySourceError } from "./login";
export type { LoginConfig, IDTokenClaims, VerifyIDTokenOptions } from "./login";

export { newIdempotencyKey } from "./internal/idempotency";
export { VERSION } from "./version";

export type { Credentials, CredentialsFile } from "./credentials";

export {
  ApiError,
  AuthenticationError,
  ConfigError,
  ConnectionError,
  IdempotencyError,
  InvalidResponseError,
  LinkError,
  RateLimitError,
  ValidationError,
  isApiError,
  isAuthenticationError,
  isConnectionError,
  isIdempotencyError,
  isLinkError,
  isRateLimitError,
  isValidationError,
} from "./errors";
export type { ErrorCode } from "./errors";
