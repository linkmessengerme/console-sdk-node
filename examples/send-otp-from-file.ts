/**
 * Load credentials from a downloaded key file. Run with:
 *   npx tsx examples/send-otp-from-file.ts ./link-key.json +12025550123
 */
import { ConsoleClient } from "@link-apps/console-sdk";

async function main(): Promise<void> {
  const keyFile = process.argv[2] ?? "./link-key.json";
  const phone = process.argv[3] ?? "+12025550123";

  const client = ConsoleClient.fromKeyFile(keyFile, { timeoutMs: 8000 });

  const res = await client.otp.send(
    { phone, code: "424242" },
    { idempotencyKey: `welcome-${phone}` },
  );

  console.log("sent:", res);
}

void main();
