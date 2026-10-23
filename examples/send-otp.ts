/**
 * Minimal OTP send. Prefer ConsoleClient.fromKeyFile (see send-otp-from-file.ts);
 * this shows programmatic construction. Run with:
 *   LINK_CLIENT_ID=lk_client_… LINK_PRIVATE_KEY="$(cat key.pem)" \
 *   LINK_API_BASE_URL=https://api-sdk.linkmessenger.me \
 *     npx tsx examples/send-otp.ts +12025550123
 */
import {
  ConsoleClient,
  RateLimitError,
  AuthenticationError,
  isApiError,
} from "@link-apps/console-sdk";

async function main(): Promise<void> {
  const clientId = required("LINK_CLIENT_ID");
  const privateKey = required("LINK_PRIVATE_KEY"); // PEM from your key-file's private_key
  const baseUrl = required("LINK_API_BASE_URL"); // the api_base_url from your key
  const phone = process.argv[2] ?? "+12025550123";

  const client = new ConsoleClient({ clientId, privateKey, baseUrl });

  // In production the code comes from your own generator/store.
  const code = String(Math.floor(100000 + Math.random() * 900000));

  try {
    const res = await client.otp.send({ phone, code, locale: "en" });
    console.log("sent:", { requestId: res.requestId, status: res.status });
  } catch (err) {
    if (err instanceof RateLimitError) {
      console.error("rate limited; retry after", err.retryAfter);
    } else if (err instanceof AuthenticationError) {
      console.error("authentication failed — check your client_id / private key");
    } else if (isApiError(err)) {
      console.error(`api error ${err.code} (${err.statusCode}); request ${err.requestId}`);
    } else {
      console.error("send failed:", err);
    }
    process.exitCode = 1;
  }
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

void main();
