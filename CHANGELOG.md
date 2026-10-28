# Changelog

## 0.4.0 — 2026-10-29

- **Breaking:** raised the minimum supported Node.js version to 24.22.1 LTS
  for the October 2026 security fixes. Builds target Node.js 24; local development
  and release automation use `.nvmrc`, and CI tests the minimum and latest 24.x.
- Added Mini Apps merchant payments: create, read, lookup by merchant reference,
  cancel and record fulfillment, with typed requests, responses and contract enums.
- Added a separate lazily minted `payments` token cache, preserving OTP scope behavior.
- Added lossless ProtoJSON int64 handling, durable operation-ID retries and support
  for gateway ProtoJSON errors alongside the existing OTP error format.
- Added Test merchant examples and contract fixtures covering business refusals,
  token scope isolation, refresh and unchanged retry bodies.

## 0.3.0 — 2026-10-24

- Added standalone `LoginClient.verifyIdToken` and UserInfo without a private key:
  EdDSA signature, trusted issuer/client/azp/time validation and required backend
  nonce, bounded concurrent JWKS cache/rotation. Uses the `jose` runtime dependency.
- Added a runnable own-backend example: server challenge, nonce, subject-bound
  profile/phone, opaque app access/refresh tokens, rotation/reuse revocation/logout.

- `client.login.getUserInfo(accessToken)` and `client.miniApps.getUserInfo(accessToken)`
  return typed profile/phone data. Optional `expectedSub` binds to a verified session.
- UserInfo uses a per-call user bearer without app-token exchange, retries,
  redirects or data caching; bounded JSON, cancellation and sanitized errors.

## 0.2.0 — 2026-06-05

- OAuth2 `client_credentials` via `private_key_jwt` (Ed25519) replaces HMAC
  authentication for OTP; credentials use `clientId`, `privateKey`, `baseUrl`.

## 0.1.0

- Initial release.
- `ConsoleClient` with `otp.send(...)`; construct from a key pair, a key file, or key JSON.
- HMAC-signed requests (byte-identical wire contract to the Go SDK), automatic
  idempotency keys, and transparent retries with exponential backoff + jitter.
- Typed error hierarchy: `ApiError`, `AuthenticationError`, `IdempotencyError`,
  `RateLimitError`, `ConnectionError`, `ValidationError`, `ConfigError`.
- ESM + CommonJS builds, first-class TypeScript types, zero runtime dependencies,
  Node.js ≥ 18.
