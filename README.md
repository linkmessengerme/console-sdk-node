# @link-apps/console-sdk

Official Node.js / TypeScript SDK for the **Link Developer Platform** (Console API).
Send OTP codes, read authorized Login/Mini Apps user data and manage Mini App merchant payments.

- HTTP uses the global `fetch`; Login token verification uses `jose`.
- First-class TypeScript types, ESM **and** CommonJS builds.
- OAuth app authentication, automatic idempotency keys and retries for OTP.
- Login/Mini Apps UserInfo with a per-call user access token.
- Mini Apps merchant payments with a separate `payments` OAuth scope.
- Typed errors you can branch on.

> Requires **Node.js ≥ 24.22.1**. For local development, run `nvm install` and
> `nvm use` in this repository to select the version in `.nvmrc`.

## Install

```bash
npm install @link-apps/console-sdk
```

## Quickstart

Download an OAuth-client JSON key file from the Developer Console and load it —
the SDK reads your credentials and API endpoint (`api_base_url`) from the key:

```ts
import { ConsoleClient } from "@link-apps/console-sdk";

const client = ConsoleClient.fromKeyFile("./link-oauth-client.json");
// or: ConsoleClient.fromCredentialsJSON(jsonStringOrObject)

const res = await client.otp.send({
  phone: "+12025550123",
  code: "123456",
});

console.log(res.requestId, res.status);
```

OTP authentication uses OAuth2 `client_credentials` with an Ed25519
`private_key_jwt` assertion. The SDK mints and caches short-lived app tokens,
and re-mints after a `401`. The project is resolved from the client server-side.

### Without a key file

If you provide the credentials directly, also pass `baseUrl` — `api_base_url` from your
key. The SDK has **no built-in default endpoint**, so requests always go where your
key points:

```ts
const client = new ConsoleClient({
  clientId: process.env.LINK_CLIENT_ID!,
  privateKey: process.env.LINK_PRIVATE_KEY!, // PKCS#8 Ed25519 PEM
  baseUrl: process.env.LINK_API_BASE_URL!,
});
```

## Sending OTP

```ts
await client.otp.send(
  {
    phone: "+12025550123",
    code: "482913",
    locale: "ru", // optional; auto-detected from the phone otherwise
    templateId: "tpl_abc123", // optional; project default used otherwise
    variables: { name: "Alex" }, // optional template variables ({{code}} is automatic)
  },
  {
    idempotencyKey: "order-42-otp", // optional; auto-generated (UUID v4) otherwise
    signal: AbortSignal.timeout(5000), // optional per-call cancellation
  },
);
```

`Locale` constants are exported for convenience: `Locale.Russian`, `Locale.English`,
`Locale.Kazakh`, `Locale.Uzbek`. Any ISO 639-1 string the platform supports is also
accepted; omit `locale` to auto-detect from the phone.

## Login and Mini Apps UserInfo

For Login with your own backend, use the standalone `LoginClient` below; it does
not need the OTP client's key file.

Use the same client with a **user access token** supplied per call:

```ts
// Login: access token from the user's completed Login authorization flow.
const user = await client.login.getUserInfo(loginAccessToken, {
  expectedSub: verifiedSession.sub, // optional session binding
  signal: AbortSignal.timeout(5000), // optional cancellation
});
if (user.phoneNumber !== undefined) {
  // Use the number for the authorized operation; do not log it.
}

// Mini Apps: accessToken from LinkMiniApp.init() (the ma_ token).
const miniUser = await client.miniApps.getUserInfo(miniAppAccessToken, {
  expectedSub: verifiedMiniAppSession.sub,
});
```

Only the access token is required. Do not pass a user ID, a scope list, an ID
token, or an app `client_credentials` token. Request `phone` during Login
authorization or enable it in Mini Apps Permissions; the project must have the
scope approved and the user must consent. The API returns currently authorized
fields. `phoneNumber` is `undefined` when unavailable. `phoneNumberVerified` is
optional and currently omitted by Link; absence does not mean `false` or proof
of ownership. Login also returns `name`, `preferredUsername`, `picture`; Mini
Apps returns optional `profile` (`name`, `username`, `avatarUrl`).

If the frontend obtained the token, send it to your backend through your own
authenticated HTTPS API. `expectedSub` compares against `sub` from your already
verified Login/Mini App session; this method does not verify an ID token or
establish a backend session itself.

UserInfo calls `GET /oauth/v1/userinfo` or `GET /miniapps/v1/userinfo` at the
configured `baseUrl`. Use a trusted HTTPS API origin with no path prefix, query,
credentials or fragment (HTTP on loopback is allowed for development).
These calls send only the user bearer, omit cookies, follow no redirects, and
never mint an app token, retry, or cache user data. JSON responses are limited
to 64 KiB; `InvalidResponseError` covers invalid data or subject mismatch.
UserInfo errors omit raw response bodies and transport causes.

Handle `AuthenticationError` by obtaining a fresh token through the original
authorization/session flow. Mini App tokens last 60 seconds; the host reissues
an expired one as a new launch, and the frontend can obtain the current token from `init()` and pass it to
the backend. The server SDK does not refresh either kind of user token.

## Verify a Login ID token on your backend

```ts
import { LoginClient } from "@link-apps/console-sdk";

// Reuse one client. All configuration comes from your Console configuration.
const login = new LoginClient({
  issuer: "https://api-sdk.linkmessenger.me",
  apiBaseUrl: "https://api-sdk-fr.linkmessenger.me", // optional regional origin
  clientIds: ["YOUR_IOS_LOGIN_CLIENT_ID", "YOUR_ANDROID_LOGIN_CLIENT_ID"],
});
// savedChallenge was created by YOUR backend before native signIn, and consumed once.
const identity = await login.verifyIdToken(idToken, { nonce: savedChallenge.nonce });
const profile = await login.getUserInfo(loginAccessToken, { expectedSub: identity.sub });
// Map (identity.issuer, identity.sub) to your account; apply your phone requirement.
// Your own session service issues your application's access/refresh tokens.
```

`verifyIdToken` checks EdDSA signature, `kid`, exact issuer, one configured audience,
matching `azp`, subject, `iat`/`exp`/optional `nbf` (30 seconds clock tolerance),
and the required expected nonce. It rejects access tokens and refreshed ID tokens
without that nonce. Returns immutable `issuer`, `sub`, `clientId`, `nonce`,
`issuedAt`, `expiresAt` (Unix seconds). Optional `signal` cancels a call.

This is the Link Login token profile, not a generic verifier for Mini App tokens.
Discovery/JWKS are fetched only from the configured API origin, without
credentials/redirects. The shared five-minute key cache coalesces loads and limits
unknown-`kid` refreshes to once per 30 seconds. Failed fetches can retry after one
second; each load has a five-second timeout. Reuse the client across requests.
`IDTokenError` means invalid identity; `LoginKeySourceError` means keys could not
be loaded. These errors do not contain token data or raw network responses.

Nonce must be 32–256 base64url characters generated securely by your backend
(32 random bytes recommended). Save it in a short-lived, one-use challenge before
login; never use a nonce read from the incoming JWT as the expected value. The
verifier compares nonce but does not store/consume challenges. It does not query
revocation or issue an app session. Call UserInfo with the verified subject to
read currently authorized profile/phone. No app private key is required.

See the [runnable own-backend example](examples/own-backend/README.md) for
Swift/Kotlin nonce passing, challenge consumption, phone handling, and your own
access/refresh token rotation and logout.

## Mini Apps merchant payments

Use `client.payments`; all request/response types and enums are exported from the
package root. Methods use camelCase (`createOrder`, `getOrder`,
`getOrderByMerchantReference`, `cancelOrder`, `recordFulfillment`).

```ts
import { ConsoleClient, CreateOrderResultCode, ProductKind, TestOutcome } from "@link-apps/console-sdk";

const client = ConsoleClient.fromKeyFile("link-test-key.json");
// IDs and buyerSub come from persisted, authenticated backend state.
const created = await client.payments.createOrder({
  appId, operationId: savedCreateOperationId, merchantOrderId, buyerSub: verifiedBuyerSub,
  product: { sku: "coins-100", version: "1", name: "100 coins", kind: ProductKind.Consumable },
  // currency and method: the values your Mini App is enabled for in Link Console.
  payment: { amountMinor: "1250", currency, method },
  testOutcome: TestOutcome.Success,
});
if (created.result !== CreateOrderResultCode.OK || !created.checkout) {
  throw new Error(`create result: ${created.result}`);
}
const orderId = created.checkout.order.orderId;
const current = await client.payments.getOrder({ appId, orderId });
const found = await client.payments.getOrderByMerchantReference({ appId, merchantOrderId });
// A separate operation, if you want to cancel:
const cancelled = await client.payments.cancelOrder({ appId, orderId, operationId: savedCancelOperationId });
```

All int64 values (`amountMinor`, product/offer versions, `productVersion`, `revision`)
are **decimal strings** (`PaymentInt64`) in both requests and responses. Numbers
and bigint inputs are rejected; use strings directly, never `String(unsafeNumber)`.
Amounts are positive minor currency units, never floating point. Timestamps remain
ProtoJSON RFC 3339 strings, preserving nanoseconds; absent `paidAt` is `undefined`.
Each method accepts an optional second `{ signal: AbortSignal }` argument.

```ts
import { RecordFulfillmentResultCode } from "@link-apps/console-sdk";

// Separate from cancellation: only after PAID and your durable grant/receipt commit.
const ack = await client.payments.recordFulfillment({
  appId, orderId: paidOrder.orderId, operationId: savedFulfillmentOperationId,
  receiptId: committedReceiptId, sku: paidOrder.product.sku,
  productVersion: paidOrder.product.version, buyerSub: paidOrder.buyerSub,
});
if (ack.result !== RecordFulfillmentResultCode.OK) {
  throw new Error(`fulfillment result: ${ack.result}`);
}
```

The same server OAuth key can serve OTP and payments. Payment methods lazily
request **only `scope=payments`**; OTP continues requesting `scope=otp`. Each scope
has a separate token cache and refresh, so enabling this API does not require
payments permission for OTP-only clients. The OAuth client must allow the requested
scope. Mini App payment access is a separate per-app **Test/Live grant** in the
payments database; a scope alone does not grant access. Both environments require
their own active grant. Environment, project and workspace come from the server
token and cannot be supplied in a payment request.

The backend obtains `buyer_sub` from its authenticated, verified Mini App session
and computes the product snapshot and price itself. Do not trust a buyer identity
or price supplied by Mini App JavaScript. The merchant API does not accept internal
user IDs, phone numbers or OTP codes. Native checkout (`StartAttempt`, OTP,
`ConfirmAttempt`) belongs to the Link host through the native checkout API and requires
the user's Link session. Merchant OAuth cannot replace that session.

All five methods send POST with `Content-Type` and `Accept: application/json`,
using the gateway's ProtoJSON contract (snake_case fields and full enum names):

| Operation | Path suffix after `/sdk/v1/miniapps/payments/orders` |
| --- | --- |
| CreateOrder | empty suffix |
| GetOrder | `/get` |
| GetOrderByMerchantReference | `/by-merchant-reference` |
| CancelOrder | `/cancel` |
| RecordFulfillment | `/fulfillment` |

Persist the complete mutation request **before** sending it, including a nonzero
UUID `operation_id`. Use a distinct UUID for each create, cancel or fulfillment
operation; reuse the same UUID and identical body after timeouts, lost responses
or process restarts. The SDK does not generate this business key. Payments use
body-level idempotency, not the OTP `Idempotency-Key` header. Reads and mutations
with a validated operation UUID use the configured transient retry policy; 401
refreshes only the payment token. Business refusals are never retried automatically.

HTTP 200 means the request was processed, not that the purchase succeeded. Inspect
`result`: create can return access-not-approved/revoked, method-not-available or
idempotency-conflict; cancel can return order-expired, already-paid,
attempt-in-progress, cancelled or idempotency-conflict; fulfillment can return
fulfillment-conflict or idempotency-conflict. The exported result enums preserve
the exact `*_RESULT_CODE_*` wire values. `checkout` can be absent on a create
refusal; `order` can be absent on a cancel/fulfillment idempotency conflict.

Non-2xx ProtoJSON `ApiError` responses use the existing SDK error classes, preserving
`ERROR_CODE_*`, request ID and details (`trace_id`, `field_violations`, `rate_limit`).
401/403 map to authentication errors; 429 maps to rate-limit errors. A missing order
is HTTP 404. OTP's existing error envelope remains supported.

Order states are only `OPEN`, `PROCESSING`, `PAID`, `CANCELLED`, `EXPIRED` (plus the
proto `UNSPECIFIED` value). Fulfillment states are `NOT_REQUESTED`, `PENDING`,
`FULFILLED` (plus `UNSPECIFIED`). Poll the merchant order for authoritative state;
a successful create or native UI callback is not proof of payment. Cancellation is
not a refund. After observing `PAID`, commit your item grant and durable receipt
idempotently in your own database, then record that receipt with `RecordFulfillment`.
That method records an existing grant; it does not grant the item. On a conflict,
reconcile the receipt and returned order rather than granting again.

The [Test merchant example](examples/payments-test.mjs) creates, reads, looks up and cancels an
order. It refuses a key file whose environment is not `test`. Set `LINK_TEST_KEY_FILE`,
`LINK_APP_ID`, `LINK_VERIFIED_BUYER_SUB`, `LINK_MERCHANT_ORDER_ID`, `LINK_PAYMENT_CURRENCY`,
`LINK_PAYMENT_METHOD`, and distinct persisted
`LINK_CREATE_OPERATION_ID` / `LINK_CANCEL_OPERATION_ID` UUIDs, then run `npm run build && node examples/payments-test.mjs`.
The app needs a Test grant. `test_outcome` can be SUCCESS, INSUFFICIENT or DELAYED in
Test only; omit it (or use UNSPECIFIED) for Live. Creating a Test order alone does
not execute the native payment flow. The example does not confirm payments or grant
items. Fulfillment requires a separately completed PAID purchase and durable receipt.

## Idempotency & retries

Every OTP request carries an idempotency key (auto-generated unless you pass one). Because
the request is idempotent, the SDK safely **retries** transient failures — network
errors, timeouts, `408/429/5xx`, and the "request in progress" conflict — with
exponential backoff + jitter. Pass your own `idempotencyKey` to deduplicate across
process restarts.

Tune or disable retries:

```ts
new ConsoleClient({ clientId, privateKey, baseUrl, retry: { maxRetries: 4 } });
new ConsoleClient({ clientId, privateKey, baseUrl, retry: false }); // no transient retries
```

## Error handling

Every error extends `LinkError`. Branch with `instanceof` or the exported guards:

```ts
import {
  ConsoleClient,
  RateLimitError,
  AuthenticationError,
  isApiError,
} from "@link-apps/console-sdk";

try {
  await client.otp.send({ phone, code });
} catch (err) {
  if (err instanceof RateLimitError) {
    console.warn("retry after", err.retryAfter);
  } else if (err instanceof AuthenticationError) {
    console.error("bad credentials / token");
  } else if (isApiError(err)) {
    console.error(err.code, err.statusCode, err.requestId);
  } else {
    throw err; // ConnectionError / ValidationError / ConfigError
  }
}
```

| Error | When |
|---|---|
| `ValidationError` | Bad phone, code or idempotency key (thrown before any request) |
| `ConfigError` | Invalid credentials or client options |
| `AuthenticationError` | `INVALID_TOKEN` / `INSUFFICIENT_SCOPE`, or rejected client assertion |
| `InvalidResponseError` | Invalid UserInfo data or subject mismatch |
| `IdempotencyError` | `IDEMPOTENCY_KEY_CONFLICT` (same key, different payload) |
| `RateLimitError` | `TOO_MANY_REQUESTS` (`retryAfter` may be absent) |
| `ApiError` | Any other non-2xx (`statusCode`, `code`, `details`, `requestId`) |
| `ConnectionError` | Network failure, timeout, or abort |

## Configuration

| Option | Default | Description |
|---|---|---|
| `clientId`, `privateKey` | — | OAuth client id and PKCS#8 Ed25519 private key |
| `baseUrl` | from key | API endpoint (`api_base_url`). Required for the direct constructor; read from the key by `fromKeyFile` / `fromCredentialsJSON` |
| `tokenUrl`, `issuer` | derived from `baseUrl` | OTP token endpoint / client assertion audience |
| `timeoutMs` | `10000` | Per-request timeout |
| `retry` | `{ maxRetries: 2, initialBackoffMs: 100, maxBackoffMs: 2000 }` | OTP retry policy, or `false` |
| `userAgentSuffix` | — | Appended to the `User-Agent` |
| `fetch` | global `fetch` | Custom fetch (proxy agent, instrumentation, tests) |

## License

MIT
