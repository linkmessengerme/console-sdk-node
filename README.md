# @link-apps/console-sdk

Official Node.js / TypeScript SDK for the **Link Developer Platform** (Console API).
Send OTP codes through the Link bot and read authorized Login/Mini Apps user data.

- Zero runtime dependencies (built on `node:crypto` + the global `fetch`).
- First-class TypeScript types, ESM **and** CommonJS builds.
- OAuth app authentication, automatic idempotency keys and retries for OTP.
- Login/Mini Apps UserInfo with a per-call user access token.
- Typed errors you can branch on.

> Requires **Node.js ≥ 18**.

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

## Idempotency & retries

Every OTP request carries an idempotency key (auto-generated unless you pass one). Because
the request is idempotent, the SDK safely **retries** transient failures — network
errors, timeouts, `408/429/5xx`, and the "request in progress" conflict — with
exponential backoff + jitter. Pass your own `idempotencyKey` to deduplicate across
process restarts.

Tune or disable retries:

```ts
new ConsoleClient({ clientId, privateKey, baseUrl, retry: { maxRetries: 4 } });
new ConsoleClient({ clientId, privateKey, baseUrl, retry: false }); // no OTP retries
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
