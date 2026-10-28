// Build first (`npm run build`), then: node examples/payments-test.mjs
// Test-only merchant lifecycle; does not run native checkout or grant goods.
import { readFileSync } from "node:fs";
import { ConsoleClient, CreateOrderResultCode, ProductKind, TestOutcome } from "@link-apps/console-sdk";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`set ${name} before running`);
  return value;
}
const key = JSON.parse(readFileSync(required("LINK_TEST_KEY_FILE"), "utf8"));
if (key.environment !== "test") throw new Error("this example requires Test credentials");
const client = ConsoleClient.fromCredentialsJSON(key);
// Persist these operation UUIDs and this entire request before the first call.
// Reuse them unchanged when rerunning after a lost response.
const request = {
  appId: required("LINK_APP_ID"), operationId: required("LINK_CREATE_OPERATION_ID"),
  merchantOrderId: required("LINK_MERCHANT_ORDER_ID"),
  // From your authenticated Mini App backend session, not an arbitrary JS identity.
  buyerSub: required("LINK_VERIFIED_BUYER_SUB"),
  product: { sku: "coins-100", version: "1", name: "100 coins", kind: ProductKind.Consumable },
  payment: { amountMinor: "1250", currency: required("LINK_PAYMENT_CURRENCY"), method: required("LINK_PAYMENT_METHOD") },
  testOutcome: TestOutcome.Success,
};
const cancelOperationId = required("LINK_CANCEL_OPERATION_ID");
if (cancelOperationId === request.operationId) throw new Error("use distinct persisted UUIDs for create and cancel");
const created = await client.payments.createOrder(request);
if (created.result !== CreateOrderResultCode.OK) throw new Error(`business result: ${created.result}`);
const orderId = created.checkout.order.orderId;
const current = await client.payments.getOrder({ appId: request.appId, orderId });
const found = await client.payments.getOrderByMerchantReference({
  appId: request.appId, merchantOrderId: request.merchantOrderId,
});
if (found.order.orderId !== orderId) throw new Error("merchant reference mismatch");
const cancelled = await client.payments.cancelOrder({
  appId: request.appId, orderId, operationId: cancelOperationId,
});
console.log({ orderId, status: current.order.status, cancelResult: cancelled.result });
// RecordFulfillment is demonstrated in README.md: only after PAID and an
// idempotent item grant + durable receipt committed in your own database.
